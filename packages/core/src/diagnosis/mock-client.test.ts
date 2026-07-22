import { describe, expect, it } from "vitest";
import { MockModelClient } from "./mock-client.js";
import { parseConfig } from "../config/schema.js";
import { parseIssue } from "../scenario/issue.js";
import type { EvidencePack } from "../evidence/types.js";

const emptyEvidence = (): EvidencePack => ({
  environment: {
    browserName: "chromium",
    browserVersion: "x",
    userAgent: "x",
    os: "x",
    platform: "win32",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en",
    theme: "dark",
    colorScheme: "dark",
    readyUrl: "http://127.0.0.1:4173",
    capturedAt: new Date().toISOString(),
  },
  detectors: {
    horizontalOverflow: [],
    overlap: [],
    textClipping: [],
    stickyOcclusion: [],
    accessibility: {
      violations: [],
      incomplete: 0,
      passes: 0,
      note: "",
    },
    documentMetrics: {
      clientWidth: 1440,
      scrollWidth: 1500,
      bodyClientWidth: 1440,
      bodyScrollWidth: 1500,
      clientHeight: 900,
      scrollHeight: 900,
    },
  },
  sourceCandidates: [],
  console: [],
  failedRequests: [],
  screenshots: { before: null, beforeAnnotated: null },
  traces: { before: null },
  notes: [],
});

describe("mock model client", () => {
  it("returns a patch for container-stretch", async () => {
    const client = new MockModelClient();
    const result = await client.diagnoseAndProposePatch({
      issue: parseIssue({
        id: "container-stretch",
        title: "t",
        description: "d",
        state: { viewport: { width: 1440, height: 900 } },
      }),
      config: parseConfig({
        project: { name: "d", repoPath: "." },
        commands: { start: "x" },
        server: { readyUrl: "http://127.0.0.1:4173" },
      }),
      evidence: emptyEvidence(),
      sourceSnippets: [],
    });
    expect(result.output.patch.unifiedDiff).toContain("max-width");
    expect(result.output.abstainReason).toBeNull();
  });

  it("abstains for unknown issues", async () => {
    const client = new MockModelClient();
    const result = await client.diagnoseAndProposePatch({
      issue: parseIssue({
        id: "unknown-case",
        title: "t",
        description: "d",
        state: { viewport: { width: 800, height: 600 } },
      }),
      config: parseConfig({
        project: { name: "d", repoPath: "." },
        commands: { start: "x" },
        server: { readyUrl: "http://127.0.0.1:4173" },
      }),
      evidence: emptyEvidence(),
      sourceSnippets: [],
    });
    expect(result.output.patch.unifiedDiff).toBeNull();
    expect(result.output.abstainReason).toBeTruthy();
  });
});
