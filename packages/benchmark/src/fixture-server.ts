import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

/** Start command that does not use npx (CI-safe). */
export function staticServeCommand(port: number, dir = "."): string {
  const script = path.join(repoRoot, "scripts", "static-serve.mjs");
  return `node ${JSON.stringify(script)} ${port} ${JSON.stringify(dir)}`;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Local static file server without `npx serve`.
 * Avoids CI hangs from repeated network package resolution.
 */
export async function startFixtureServer(opts: {
  fixture: string;
  port: number;
}): Promise<{ stop: () => Promise<void>; url: string; cwd: string }> {
  const cwd = path.join(repoRoot, "fixtures", opts.fixture);
  if (!fs.existsSync(cwd)) {
    throw new Error(`Fixture directory not found: ${cwd}`);
  }

  const server = http.createServer((req, res) => {
    try {
      const rawUrl = req.url ?? "/";
      const urlPath = decodeURIComponent(rawUrl.split("?")[0] || "/");
      let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      // prevent path traversal
      const full = path.normalize(path.join(cwd, rel));
      if (!full.startsWith(cwd)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        const index = path.join(full, "index.html");
        if (fs.existsSync(index) && fs.statSync(index).isFile()) {
          rel = path.relative(cwd, index);
        } else {
          res.writeHead(404).end("Not found");
          return;
        }
      }
      const filePath = path.normalize(path.join(cwd, rel));
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500).end(err instanceof Error ? err.message : String(err));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  // readiness probe (should be immediate for in-process server)
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < 5_000) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return {
          url,
          cwd,
          stop: async () =>
            new Promise<void>((resolveStop) => {
              server.close(() => resolveStop());
              // force-close hangers
              setTimeout(() => resolveStop(), 2_000).unref?.();
            }),
        };
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  throw new Error(
    `Fixture server failed for ${opts.fixture}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
