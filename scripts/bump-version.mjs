import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const targetArg = process.argv[2];
if (!targetArg) {
  console.error("Usage: node scripts/bump-version.mjs <version|patch|minor|major>");
  process.exit(1);
}

const rootPkgPath = path.resolve("package.json");
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
const currentVersion = rootPkg.version;

let nextVersion = targetArg;
if (["patch", "minor", "major"].includes(targetArg)) {
  const parts = currentVersion.split(".").map(Number);
  if (targetArg === "patch") parts[2] += 1;
  else if (targetArg === "minor") { parts[1] += 1; parts[2] = 0; }
  else if (targetArg === "major") { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  nextVersion = parts.join(".");
}

const targetFiles = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/benchmark/package.json",
  "apps/dashboard/package.json",
];

for (const file of targetFiles) {
  const fullPath = path.resolve(file);
  if (fs.existsSync(fullPath)) {
    const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    pkg.version = nextVersion;
    fs.writeFileSync(fullPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`Updated ${file} -> ${nextVersion}`);
  }
}

console.log("Syncing package-lock.json...");
execSync("npm install", { stdio: "inherit" });
console.log(`Successfully bumped monorepo to v${nextVersion}!`);
