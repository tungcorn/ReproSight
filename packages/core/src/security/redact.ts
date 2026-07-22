const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: "aws-access-key",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "generic-api-key",
    re: /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?([^\s'"]{8,})/gi,
  },
  {
    name: "bearer",
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  },
  {
    name: "private-key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return out;
}

export function redactObject<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactObject(v)) as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|secret|password|token|authorization|cookie/i.test(k)) {
        result[k] = "[REDACTED:field]";
      } else {
        result[k] = redactObject(v);
      }
    }
    return result as T;
  }
  return value;
}
