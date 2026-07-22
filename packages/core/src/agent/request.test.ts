import { describe, expect, it } from "vitest";
import { parseAgentRequest } from "./request.js";

describe("agent request schema", () => {
  it("accepts minimal request", () => {
    const req = parseAgentRequest({
      task: { description: "Mobile header overflows" },
    });
    expect(req.version).toBe(1);
    expect(req.repository.path).toBe(".");
    expect(req.execution.mode).toBe("external-agent-repair");
  });

  it("rejects empty description", () => {
    expect(() =>
      parseAgentRequest({
        task: { description: "" },
      }),
    ).toThrow(/Invalid agent request/);
  });
});
