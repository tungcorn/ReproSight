import { describe, expect, it } from "vitest";
import { scoreCandidate } from "./scoring.js";

describe("candidate scoring", () => {
  it("ranks nowrap higher for overflow context", () => {
    const a = scoreCandidate({
      property: "white-space",
      value: "nowrap",
      computedValue: "nowrap",
      selectorText: ".about__highlights strong",
      elementSelector: ".about__highlights strong",
      media: null,
      file: "styles.css",
      defectProperties: ["white-space"],
    });
    const b = scoreCandidate({
      property: "color",
      value: "red",
      computedValue: "red",
      selectorText: "body",
      elementSelector: ".about__highlights strong",
      media: null,
      file: null,
      defectProperties: ["white-space"],
    });
    expect(a).toBeGreaterThan(b);
  });
});
