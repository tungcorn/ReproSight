import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";
import type { Plugin, Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Serve generated run artifacts from the monorepo `.reprosight/runs` directory
 * so the dashboard does not require manual file copies.
 */
function reprosightRunsPlugin(): Plugin {
  const runsRoot = path.resolve(__dirname, "../../.reprosight/runs");

  const handler: Connect.NextHandleFunction = (
    req: IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const url = req.url ?? "";
    if (url === "/api/runs" || url.startsWith("/api/runs?")) {
      try {
        if (!fs.existsSync(runsRoot)) {
          res.setHeader("content-type", "application/json");
          res.end("[]");
          return;
        }
        const dirs = fs
          .readdirSync(runsRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
        const runs = [];
        for (const id of dirs) {
          const runPath = path.join(runsRoot, id, "run.json");
          if (!fs.existsSync(runPath)) continue;
          try {
            runs.push(JSON.parse(fs.readFileSync(runPath, "utf8")));
          } catch {
            // skip corrupt
          }
        }
        runs.sort((a: { createdAt?: string }, b: { createdAt?: string }) =>
          String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
        );
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(runs));
        return;
      } catch (err) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }
    }

    if (url.startsWith("/runs/")) {
      const rel = decodeURIComponent(url.slice("/runs/".length).split("?")[0]!);
      const filePath = path.normalize(path.join(runsRoot, rel));
      if (!filePath.startsWith(runsRoot)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const types: Record<string, string> = {
        ".json": "application/json",
        ".png": "image/png",
        ".html": "text/html",
        ".diff": "text/plain",
        ".txt": "text/plain",
        ".zip": "application/zip",
      };
      res.setHeader("content-type", types[ext] ?? "application/octet-stream");
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    next();
  };

  return {
    name: "reprosight-runs",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react(), reprosightRunsPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  publicDir: "public",
  appType: "spa",
});
