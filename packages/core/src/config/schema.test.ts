import { describe, expect, it } from "vitest";
import { parseConfig } from "./schema.js";

describe("config schema", () => {
  it("accepts a minimal valid config with defaults", () => {
    const cfg = parseConfig({
      project: { name: "demo", repoPath: "D:/tmp/demo" },
      commands: { start: "npx serve ." },
      server: { readyUrl: "http://127.0.0.1:4173" },
    });
    expect(cfg.browser.name).toBe("chromium");
    expect(cfg.detectors.horizontalOverflow).toBe(true);
    expect(cfg.patchPolicy.maxFiles).toBe(3);
  });

  it("rejects invalid readyUrl", () => {
    expect(() =>
      parseConfig({
        project: { name: "demo", repoPath: "." },
        commands: { start: "npm start" },
        server: { readyUrl: "not-a-url" },
      }),
    ).toThrow(/Invalid ReproSight config/);
  });

  it("requires selector when locale strategy is selector", () => {
    expect(() =>
      parseConfig({
        project: { name: "demo", repoPath: "." },
        commands: { start: "npm start" },
        server: { readyUrl: "http://127.0.0.1:4173" },
        setup: { locale: { strategy: "selector" } },
      }),
    ).toThrow(/locale.selector/);
  });
});
