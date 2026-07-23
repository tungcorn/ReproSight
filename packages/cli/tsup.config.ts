import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  bundle: true,
  splitting: false,
  noExternal: ["@reprosight/core"],
  external: [
    "playwright",
    "@axe-core/playwright",
    "execa",
    "pngjs",
    "pixelmatch",
    "diff",
    "parse-diff",
    "minimatch",
    "zod",
    "commander",
  ],
  outDir: "dist",
});
