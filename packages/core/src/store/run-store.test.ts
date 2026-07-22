import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { RunStore } from "./run-store.js";
import { parseConfig } from "../config/schema.js";
import { parseIssue } from "../scenario/issue.js";

describe("run store", () => {
  it("creates run artifacts and transitions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reprosight-store-"));
    const store = new RunStore(root);
    const config = parseConfig({
      project: { name: "t", repoPath: root },
      commands: { start: "echo" },
      server: { readyUrl: "http://127.0.0.1:4173" },
    });
    const issue = parseIssue({
      id: "i1",
      title: "t",
      description: "d",
      state: { viewport: { width: 800, height: 600 } },
    });
    const run = await store.createRun({ issue, config, provider: "mock" });
    expect(run.state).toBe("CREATED");
    const next = await store.transition(run.id, "PREPARING", "go");
    expect(next.state).toBe("PREPARING");
    expect(next.transitions).toHaveLength(1);
    await store.writeArtifactJson(run.id, "evidence.json", { ok: true }, "evidence");
    const loaded = await store.load(run.id);
    expect(loaded.artifacts.find((a) => a.id === "evidence")?.present).toBe(true);
  });
});
