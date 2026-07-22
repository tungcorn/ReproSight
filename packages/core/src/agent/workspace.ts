import { randomUUID } from "node:crypto";
import { agentError, agentOk, type AgentResponse } from "./response.js";
import { defaultAgentStore } from "./session.js";
import { RunStore, defaultReproRoot } from "../store/run-store.js";
import {
  assertCleanGitRepo,
  createLinkedWorktree,
  hashCheckout,
} from "../patcher/worktree.js";
import { readJsonFile } from "../store/fs.js";
import type { ReproSightConfig } from "../config/schema.js";

export async function agentWorkspace(opts: {
  runId: string;
  sessionId?: string;
  cwd?: string;
}): Promise<AgentResponse> {
  const cwd = opts.cwd ?? process.cwd();
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

  const config = await readJsonFile<ReproSightConfig>(
    runStore.artifactPath(opts.runId, "config.snapshot.json"),
  );

  try {
    await assertCleanGitRepo(config.project.repoPath);
  } catch (err) {
    return agentError(
      "WORKSPACE_NOT_READY",
      "TARGET_DIRTY",
      err instanceof Error ? err.message : String(err),
      { runId: opts.runId },
    );
  }

  const beforeHash = await hashCheckout(config.project.repoPath);
  const { worktreePath } = await createLinkedWorktree({
    repoPath: config.project.repoPath,
    runId: opts.runId,
    baseRef: config.project.baseRef,
    reproRoot: defaultReproRoot(cwd),
  });

  run.worktreePath = worktreePath;
  run.originalCheckoutHash = beforeHash;
  await runStore.save(run);

  if (opts.sessionId) {
    const sessions = defaultAgentStore(cwd);
    if (await sessions.exists(opts.sessionId)) {
      const session = await sessions.load(opts.sessionId);
      session.worktreePath = worktreePath;
      session.runId = opts.runId;
      session.originalCheckoutHash = beforeHash;
      session.status = "WORKSPACE_READY";
      await sessions.save(session);
    }
  }

  const afterHash = await hashCheckout(config.project.repoPath);
  const evidence = await readJsonFile<{
    sourceCandidates?: Array<{ file?: string | null }>;
  }>(runStore.artifactPath(opts.runId, "evidence.json")).catch(() => null);

  const sourceFiles = [
    ...new Set(
      (evidence?.sourceCandidates ?? [])
        .map((c) => c.file)
        .filter((f): f is string => Boolean(f)),
    ),
  ].slice(0, 10);

  return agentOk("WORKSPACE_READY", {
    runId: opts.runId,
    sessionId: opts.sessionId,
    workspace: {
      path: worktreePath,
      baseCommit: config.project.baseRef,
      originalCheckoutUnchanged: afterHash === beforeHash,
      originalCheckoutHash: beforeHash,
    },
    policy: config.patchPolicy,
    relevantSourceFiles: sourceFiles,
    recommendedAgentAction: {
      type: "EDIT_WORKSPACE_THEN_VERIFY",
      command: `reprosight agent verify ${opts.runId} --workspace --json`,
    },
    attemptSeed: `attempt_${randomUUID().slice(0, 8)}`,
  });
}
