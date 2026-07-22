import path from "node:path";
import { isAbsoluteOrTraversal } from "../security/paths.js";
import { redactSecrets } from "../security/redact.js";

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\bmkfs\b/i,
  /\bcurl\b.+\|\s*(ba)?sh/i,
  /\bwget\b.+\|\s*(ba)?sh/i,
];

export function assertSafeRepoPath(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  if (resolved.includes("\0")) {
    throw new Error("UNSAFE_REQUEST: null byte in repository path");
  }
  return resolved;
}

export function assertSafeOptionalPath(
  filePath: string | null | undefined,
  label: string,
): string | null {
  if (!filePath) return null;
  if (isAbsoluteOrTraversal(filePath) && !path.isAbsolute(filePath)) {
    // allow absolute local screenshot paths; still reject traversal
  }
  if (filePath.includes("\0") || filePath.includes("..")) {
    const normalized = path.normalize(filePath);
    if (normalized.split(path.sep).includes("..")) {
      throw new Error(`UNSAFE_REQUEST: traversal in ${label}`);
    }
  }
  if (/(^|[\\/])\.env(\.|$)/i.test(filePath)) {
    throw new Error(`UNSAFE_REQUEST: ${label} must not point at .env files`);
  }
  return path.resolve(filePath);
}

export function assertSafeReadyUrl(url: string | undefined): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("UNSAFE_REQUEST: invalid readyUrl");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(
      "UNSAFE_REQUEST: readyUrl must target localhost or 127.0.0.1",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("UNSAFE_REQUEST: readyUrl protocol must be http(s)");
  }
}

export function assertSafeStartCommand(command: string | undefined): void {
  if (!command) return;
  for (const re of BLOCKED_COMMAND_PATTERNS) {
    if (re.test(command)) {
      throw new Error("UNSAFE_REQUEST: blocked start command pattern");
    }
  }
  // Disallow command chaining that could smuggle extra shell
  if (/[;&|]{2}|`/.test(command) || /\$\(/.test(command)) {
    throw new Error("UNSAFE_REQUEST: shell chaining not allowed in startCommand");
  }
}

export function sanitizeAgentPayload<T>(value: T): T {
  return redactSecrets(
    typeof value === "string" ? value : JSON.stringify(value),
  ) as unknown as T extends string ? T : T;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|secret|password|token|authorization|cookie/i.test(k)) {
        out[k] = "[REDACTED:field]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as T;
  }
  return value;
}
