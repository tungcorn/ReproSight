import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, createTransition } from "./states.js";

describe("pipeline transitions", () => {
  it("allows CREATED → PREPARING", () => {
    expect(canTransition("CREATED", "PREPARING")).toBe(true);
    const t = createTransition("CREATED", "PREPARING", "start");
    expect(t.from).toBe("CREATED");
  });

  it("rejects skipping states", () => {
    expect(() => assertTransition("CREATED", "VERIFIED")).toThrow(/Illegal/);
  });
});
