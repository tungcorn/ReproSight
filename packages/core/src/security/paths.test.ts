import { describe, expect, it } from "vitest";
import {
  isAbsoluteOrTraversal,
  matchesAnyGlob,
  assertSafeSelector,
} from "./paths.js";

describe("path safety", () => {
  it("detects traversal and absolute paths", () => {
    expect(isAbsoluteOrTraversal("../etc/passwd")).toBe(true);
    expect(isAbsoluteOrTraversal("C:\\\\Windows\\\\system32")).toBe(true);
    expect(isAbsoluteOrTraversal("src/styles.css")).toBe(false);
  });

  it("matches allowed globs", () => {
    expect(matchesAnyGlob("css/style.css", ["css/**/*.css"])).toBe(true);
    expect(matchesAnyGlob(".env", [".env*"])).toBe(true);
  });

  it("rejects javascript selectors", () => {
    expect(() => assertSafeSelector("javascript:alert(1)")).toThrow();
  });
});
