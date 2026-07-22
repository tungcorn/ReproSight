#!/usr/bin/env node
/**
 * Minimal static file server for CI/fixtures.
 * Usage: node scripts/static-serve.mjs <port> [directory]
 *
 * Avoids `npx serve`, which can hang on GitHub Actions while resolving packages.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] || 4173);
const root = path.resolve(process.argv[3] || ".");

const MIME = {
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

if (!fs.existsSync(root)) {
  console.error(`static-serve: directory not found: ${root}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  try {
    const raw = req.url ?? "/";
    const urlPath = decodeURIComponent(raw.split("?")[0] || "/");
    let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    let full = path.normalize(path.join(root, rel));
    if (!full.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!fs.existsSync(full)) {
      res.writeHead(404).end("Not found");
      return;
    }
    if (fs.statSync(full).isDirectory()) {
      full = path.join(full, "index.html");
      if (!fs.existsSync(full)) {
        res.writeHead(404).end("Not found");
        return;
      }
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    res.writeHead(500).end(err instanceof Error ? err.message : String(err));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`static-serve listening on http://127.0.0.1:${port} root=${root}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref?.();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
