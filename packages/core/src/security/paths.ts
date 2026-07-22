import path from "node:path";
import { minimatch } from "minimatch";

export function isAbsoluteOrTraversal(filePath: string): boolean {
  if (path.isAbsolute(filePath)) return true;
  if (filePath.includes("\0")) return true;
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (normalized.startsWith("../") || normalized === "..") return true;
  if (normalized.startsWith("/")) return true;
  return false;
}

export function toRepoRelative(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const rel = toRepoRelative(filePath);
  return globs.some((g) =>
    minimatch(rel, g, { dot: true, nocase: process.platform === "win32" }),
  );
}

export function assertSafeSelector(selector: string): void {
  if (!selector || selector.length > 500) {
    throw new Error("Selector is empty or excessively long");
  }
  // Block attempts to smuggle JS via selector-like payloads used outside Playwright
  if (/javascript:/i.test(selector)) {
    throw new Error("Selector rejected: javascript: protocol");
  }
}
