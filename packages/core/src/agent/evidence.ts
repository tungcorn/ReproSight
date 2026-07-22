import path from "node:path";
import { agentError, agentOk, type AgentResponse } from "./response.js";
import { RunStore, defaultReproRoot } from "../store/run-store.js";
import { readJsonFile, pathExists } from "../store/fs.js";

const SECTIONS = [
  "summary",
  "findings",
  "source-candidates",
  "console",
  "accessibility",
  "artifacts",
  "all",
] as const;

export type EvidenceSection = (typeof SECTIONS)[number];

export async function agentEvidence(opts: {
  runId: string;
  section?: string;
  cwd?: string;
}): Promise<AgentResponse> {
  const cwd = opts.cwd ?? process.cwd();
  const section = (opts.section ?? "summary") as EvidenceSection;
  if (!SECTIONS.includes(section)) {
    return agentError(
      "INVALID_REQUEST",
      "INVALID_SECTION",
      `Unknown section ${opts.section}`,
    );
  }
  const runStore = new RunStore(defaultReproRoot(cwd));
  let run;
  try {
    run = await runStore.load(opts.runId);
  } catch {
    return agentError(
      "INVALID_REQUEST",
      "UNKNOWN_RUN",
      `Unknown run id ${opts.runId}`,
    );
  }

  const evidence = await readJsonFile<Record<string, unknown>>(
    runStore.artifactPath(opts.runId, "evidence.json"),
  ).catch(() => null);
  const reproduction = await readJsonFile<Record<string, unknown>>(
    runStore.artifactPath(opts.runId, "reproduction.json"),
  ).catch(() => null);
  const attempts = await readJsonFile<unknown[]>(
    runStore.artifactPath(opts.runId, "attempts.json"),
  ).catch(() => []);

  const artifacts = {
    before: await pathIfExists(run.rootDir, "artifacts/before.png"),
    beforeAnnotated: await pathIfExists(
      run.rootDir,
      "artifacts/before-annotated.png",
    ),
    after: await pathIfExists(run.rootDir, "artifacts/after.png"),
    diff: await pathIfExists(run.rootDir, "artifacts/diff.png"),
    evidence: await pathIfExists(run.rootDir, "evidence.json"),
    report: await pathIfExists(run.rootDir, "report/index.html"),
    traceBefore: run.artifacts.find((a) => a.id === "trace-before")?.present
      ? "artifacts/trace-before.zip"
      : null,
  };

  const detectors = (evidence?.detectors ?? {}) as Record<string, unknown>;
  const body: Record<string, unknown> = {
    runId: opts.runId,
    pipelineState: run.state,
    section,
  };

  if (section === "summary" || section === "all") {
    body.summary = {
      issueId: run.issueId,
      state: run.state,
      finalVerdict: run.finalVerdict,
      reproduction,
      findingsCount: {
        overflow: Array.isArray(detectors.horizontalOverflow)
          ? detectors.horizontalOverflow.length
          : 0,
        overlap: Array.isArray(detectors.overlap)
          ? detectors.overlap.length
          : 0,
        clipping: Array.isArray(detectors.textClipping)
          ? detectors.textClipping.length
          : 0,
        sticky: Array.isArray(detectors.stickyOcclusion)
          ? detectors.stickyOcclusion.length
          : 0,
      },
      attempts: attempts.length,
    };
  }
  if (section === "findings" || section === "all") {
    body.findings = detectors;
  }
  if (section === "source-candidates" || section === "all") {
    body.sourceCandidates = evidence?.sourceCandidates ?? [];
  }
  if (section === "console" || section === "all") {
    body.console = evidence?.console ?? [];
    body.failedRequests = evidence?.failedRequests ?? [];
  }
  if (section === "accessibility" || section === "all") {
    body.accessibility =
      (detectors as { accessibility?: unknown }).accessibility ?? null;
  }
  if (section === "artifacts" || section === "all") {
    body.artifacts = artifacts;
  }

  return agentOk("EVIDENCE_READY", body);
}

async function pathIfExists(
  root: string,
  rel: string,
): Promise<string | null> {
  const full = path.join(root, rel);
  return (await pathExists(full)) ? rel : null;
}
