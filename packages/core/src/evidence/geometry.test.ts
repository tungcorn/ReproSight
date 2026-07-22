import { describe, expect, it } from "vitest";
import {
  intersectRects,
  overlapRatio,
  extendsBeyondViewport,
  clippingAxes,
} from "./geometry.js";

describe("geometry", () => {
  it("intersects rectangles", () => {
    const i = intersectRects(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    );
    expect(i).toEqual({ x: 50, y: 50, width: 50, height: 50 });
  });

  it("computes overflow past viewport", () => {
    const r = extendsBeyondViewport({ x: 700, y: 0, width: 100, height: 20 }, 768);
    expect(r.overflows).toBe(true);
    expect(r.amount).toBeCloseTo(32);
  });

  it("detects clipping axes", () => {
    expect(
      clippingAxes({
        scrollWidth: 200,
        clientWidth: 100,
        scrollHeight: 40,
        clientHeight: 40,
      }).horizontal,
    ).toBe(true);
  });

  it("overlap ratio", () => {
    const ratio = overlapRatio(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 50, height: 100 },
    );
    expect(ratio).toBeCloseTo(0.5);
  });
});
