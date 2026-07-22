import { execa, type ResultPromise } from "execa";
import path from "node:path";
import type { ReproSightConfig } from "../config/schema.js";

export type TargetHandle = {
  stop: () => Promise<void>;
  pid?: number;
  cwd: string;
};

function splitCommand(command: string): { file: string; args: string[] } {
  // Simple Windows-friendly split preserving quoted segments
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [command];
  const parts = matches.map((p) => p.replace(/^"|"$/g, ""));
  const file = parts[0] ?? command;
  const args = parts.slice(1);
  return { file, args };
}

export async function waitForUrl(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchImpl(url, { method: "GET" });
      if (res.ok || res.status < 500) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Server not ready at ${url} within ${timeoutMs}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export async function startTargetProcess(opts: {
  config: ReproSightConfig;
  cwd?: string;
  install?: boolean;
}): Promise<TargetHandle> {
  const cwd = opts.cwd ?? path.resolve(opts.config.project.repoPath);
  if (opts.install) {
    const inst = splitCommand(opts.config.commands.install);
    await execa(inst.file, inst.args, { cwd, stdio: "pipe" });
  }

  const start = splitCommand(opts.config.commands.start);
  const child: ResultPromise = execa(start.file, start.args, {
    cwd,
    stdio: "pipe",
    reject: false,
    env: {
      ...process.env,
      BROWSER: "none",
      FORCE_COLOR: "0",
    },
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.pid) {
      try {
        if (process.platform === "win32") {
          await execa("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            reject: false,
          });
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        // ignore
      }
    }
    try {
      await Promise.race([
        child,
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch {
      // ignore
    }
  };

  try {
    await waitForUrl(opts.config.server.readyUrl, opts.config.server.timeoutMs);
  } catch (err) {
    await stop();
    throw err;
  }

  return { stop, pid: child.pid, cwd };
}

export async function runOptionalCommand(
  command: string | undefined,
  cwd: string,
): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string } | null> {
  if (!command) return null;
  const { file, args } = splitCommand(command);
  const result = await execa(file, args, {
    cwd,
    reject: false,
    all: true,
  });
  return {
    ok: result.exitCode === 0,
    code: result.exitCode ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
