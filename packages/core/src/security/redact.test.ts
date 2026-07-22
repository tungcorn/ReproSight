import { describe, expect, it } from "vitest";
import { redactSecrets, redactObject } from "./redact.js";

describe("redaction", () => {
  it("redacts bearer tokens", () => {
    const out = redactSecrets("Authorization Bearer abcdefghijklmnop");
    expect(out).toContain("[REDACTED:bearer]");
  });

  it("redacts secret-looking object fields", () => {
    const out = redactObject({ apiKey: "supersecret", ok: "yes" });
    expect(out.apiKey).toBe("[REDACTED:field]");
    expect(out.ok).toBe("yes");
  });
});
