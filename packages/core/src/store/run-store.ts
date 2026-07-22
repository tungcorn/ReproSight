import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";
import {
  type PipelineState,
  type Transition,
  createTransition,
} from "../pipeline/states.js";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonAtomic,
  writeAtomic,
} from "./fs.js";

export type ArtifactPresence = {
  id: string;
  path: string;
  present: boolean;
  note?: string;
};

export type HumanDecision = {
  status: "pending" | "approved" | "rejected";
  reason?: string;
  at?: string;
};

export type RunRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  rootDir: string;
  state: PipelineState;
  transitions: Transition[];
  issueId: string;
  projectName: string;
  baseRef: string;
  repoPath: string;
  provider: string;
  finalVerdict: string | null;
  human: HumanDecision;
  artifacts: ArtifactPresence[];
  worktreePath: string | null;
  originalCheckoutHash: string | null;
  error: string | null;
};

export type ExpectedArtifacts = Array<{
  id: string;
  relativePath: string;
  requiredForSuccess?: boolean;
}>;

export const DEFAULT_EXPECTED_ARTIFACTS: ExpectedArtifacts = [
  { id: "run", relativePath: "run.json" },
  { id: "issue", relativePath: "issue.json" },
  { id: "config", relativePath: "config.snapshot.json" },
  { id: "environment", relativePath: "environment.json" },
  { id: "reproduction", relativePath: "reproduction.json" },
  { id: "evidence", relativePath: "evidence.json" },
  { id: "diagnosis", relativePath: "diagnosis.json" },
  { id: "patch", relativePath: "patch.diff" },
  { id: "patch-validation", relativePath: "patch-validation.json" },
  { id: "verification", relativePath: "verification.json" },
  { id: "report", relativePath: "report/index.html" },
  { id: "before", relativePath: "artifacts/before.png" },
  { id: "before-annotated", relativePath: "artifacts/before-annotated.png" },
  { id: "after", relativePath: "artifacts/after.png" },
  { id: "after-annotated", relativePath: "artifacts/after-annotated.png" },
  { id: "diff", relativePath: "artifacts/diff.png" },
  { id: "trace-before", relativePath: "artifacts/trace-before.zip" },
  { id: "trace-after", relativePath: "artifacts/trace-after.zip" },
  { id: "axe-before", relativePath: "artifacts/axe-before.json" },
  { id: "axe-after", relativePath: "artifacts/axe-after.json" },
  { id: "console-before", relativePath: "artifacts/console-before.json" },
  { id: "console-after", relativePath: "artifacts/console-after.json" },
  { id: "source-candidates", relativePath: "artifacts/source-candidates.json" },
];

export class RunStore {
  constructor(private readonly reproRoot: string) {}

  get runsRoot(): string {
    return path.join(this.reproRoot, "runs");
  }

  runDir(runId: string): string {
    return path.join(this.runsRoot, runId);
  }

  async createRun(opts: {
    issue: IssueSpec;
    config: ReproSightConfig;
    provider: string;
    runId?: string;
  }): Promise<RunRecord> {
    const id = opts.runId ?? `run_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
    const rootDir = this.runDir(id);
    await ensureDir(path.join(rootDir, "artifacts"));
    await ensureDir(path.join(rootDir, "report"));

    const now = new Date().toISOString();
    const record: RunRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      rootDir,
      state: "CREATED",
      transitions: [],
      issueId: opts.issue.id,
      projectName: opts.config.project.name,
      baseRef: opts.config.project.baseRef,
      repoPath: opts.config.project.repoPath,
      provider: opts.provider,
      finalVerdict: null,
      human: { status: "pending" },
      artifacts: DEFAULT_EXPECTED_ARTIFACTS.map((a) => ({
        id: a.id,
        path: a.relativePath,
        present: false,
        note: "not yet produced",
      })),
      worktreePath: null,
      originalCheckoutHash: null,
      error: null,
    };

    await writeJsonAtomic(path.join(rootDir, "run.json"), record);
    await writeJsonAtomic(path.join(rootDir, "issue.json"), opts.issue);
    await writeJsonAtomic(
      path.join(rootDir, "config.snapshot.json"),
      opts.config,
    );
    await this.markPresent(id, "run");
    await this.markPresent(id, "issue");
    await this.markPresent(id, "config");
    return this.load(id);
  }

  async load(runId: string): Promise<RunRecord> {
    return readJsonFile<RunRecord>(path.join(this.runDir(runId), "run.json"));
  }

  async save(record: RunRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await writeJsonAtomic(path.join(record.rootDir, "run.json"), record);
  }

  async transition(
    runId: string,
    to: PipelineState,
    reason: string,
    artifactIds: string[] = [],
  ): Promise<RunRecord> {
    const record = await this.load(runId);
    const t = createTransition(record.state, to, reason, artifactIds);
    record.transitions.push(t);
    record.state = to;
    if (
      to === "NOT_REPRODUCED" ||
      to === "ABSTAINED" ||
      to === "PATCH_REJECTED" ||
      to === "TARGET_FAILED" ||
      to === "REGRESSION_INTRODUCED" ||
      to === "AWAITING_HUMAN_REVIEW"
    ) {
      record.finalVerdict = to;
    }
    await this.save(record);
    return record;
  }

  async markPresent(
    runId: string,
    artifactId: string,
    note?: string,
  ): Promise<void> {
    const record = await this.load(runId);
    const art = record.artifacts.find((a) => a.id === artifactId);
    if (art) {
      art.present = true;
      art.note = note;
    } else {
      record.artifacts.push({
        id: artifactId,
        path: artifactId,
        present: true,
        note,
      });
    }
    await this.save(record);
  }

  async markMissing(
    runId: string,
    artifactId: string,
    note: string,
  ): Promise<void> {
    const record = await this.load(runId);
    const art = record.artifacts.find((a) => a.id === artifactId);
    if (art) {
      art.present = false;
      art.note = note;
    }
    await this.save(record);
  }

  async writeArtifactJson(
    runId: string,
    relativePath: string,
    value: unknown,
    artifactId?: string,
  ): Promise<string> {
    const full = path.join(this.runDir(runId), relativePath);
    await writeJsonAtomic(full, value);
    if (artifactId) await this.markPresent(runId, artifactId);
    return full;
  }

  async writeArtifactText(
    runId: string,
    relativePath: string,
    value: string,
    artifactId?: string,
  ): Promise<string> {
    const full = path.join(this.runDir(runId), relativePath);
    await writeAtomic(full, value);
    if (artifactId) await this.markPresent(runId, artifactId);
    return full;
  }

  async writeArtifactBinary(
    runId: string,
    relativePath: string,
    value: Buffer,
    artifactId?: string,
  ): Promise<string> {
    const full = path.join(this.runDir(runId), relativePath);
    await writeAtomic(full, value);
    if (artifactId) await this.markPresent(runId, artifactId);
    return full;
  }

  async listRuns(): Promise<RunRecord[]> {
    if (!(await pathExists(this.runsRoot))) return [];
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.runsRoot, { withFileTypes: true });
    const runs: RunRecord[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        runs.push(await this.load(e.name));
      } catch {
        // skip corrupt
      }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  artifactPath(runId: string, relativePath: string): string {
    return path.join(this.runDir(runId), relativePath);
  }
}

export function defaultReproRoot(cwd = process.cwd()): string {
  return path.join(cwd, ".reprosight");
}
