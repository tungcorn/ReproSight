import { describe, expect, it } from "vitest";
import { inferScenario } from "./scenario.js";
import { parseAgentRequest } from "./request.js";

describe("scenario inference", () => {
  it("infers mobile viewport and overflow category", () => {
    const req = parseAgentRequest({
      task: {
        description: "Vietnamese navigation overflows on tablet width 768",
      },
    });
    const scenario = inferScenario(req);
    expect(scenario.issue.state.viewport.width).toBe(768);
    expect(scenario.issue.state.locale).toBe("vi");
    expect(scenario.issue.assertions[0]?.type).toBe("noHorizontalOverflow");
  });

  it("uses external state hints when provided", () => {
    const req = parseAgentRequest({
      task: { description: "button covered" },
      stateHints: {
        route: "/checkout",
        viewport: { width: 390, height: 844 },
        theme: "light",
      },
      reproductionHints: {
        category: "overlap",
        suspectedSelectors: [".a", ".b"],
      },
    });
    const scenario = inferScenario(req);
    expect(scenario.issue.route).toBe("/checkout");
    expect(scenario.issue.state.theme).toBe("light");
    expect(scenario.issue.assertions[0]?.type).toBe("noOverlap");
  });
});
