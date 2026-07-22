import { describe, expect, it } from "vitest";
import { parseIssue } from "./issue.js";

describe("issue schema", () => {
  it("parses a valid issue", () => {
    const issue = parseIssue({
      id: "x",
      title: "t",
      description: "d",
      state: { viewport: { width: 768, height: 1024 }, locale: "vi", theme: "dark" },
      actions: [{ type: "scrollIntoView", selector: "#about" }],
      assertions: [{ type: "noHorizontalOverflow" }],
    });
    expect(issue.route).toBe("/");
    expect(issue.actions[0]?.type).toBe("scrollIntoView");
  });

  it("rejects arbitrary action types", () => {
    expect(() =>
      parseIssue({
        id: "x",
        title: "t",
        description: "d",
        state: { viewport: { width: 1, height: 1 } },
        actions: [{ type: "eval", code: "alert(1)" }],
      }),
    ).toThrow(/Invalid issue/);
  });
});
