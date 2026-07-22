import { execa, type ResultPromise } from "execa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

export async function startFixtureServer(opts: {
  fixture: string;
  port: number;
}): Promise<{ stop: () => Promise<void>; url: string; cwd: string }> {
  const cwd = path.join(repoRoot, "fixtures", opts.fixture);
  const child: ResultPromise = execa(
    "npx",
    ["--yes", "serve", "-l", String(opts.port), "."],
    { cwd, reject: false, stdio: "pipe" },
  );
  const url = `http://127.0.0.1:${opts.port}`;
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < 30_000) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return {
          url,
          cwd,
          stop: async () => {
            if (child.pid) {
              if (process.platform === "win32") {
                await execa("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                  reject: false,
                });
              } else {
                child.kill("SIGTERM");
              }
            }
          },
        };
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (child.pid) {
    await execa("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      reject: false,
    }).catch(() => undefined);
  }
  throw new Error(
    `Fixture server failed for ${opts.fixture}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
