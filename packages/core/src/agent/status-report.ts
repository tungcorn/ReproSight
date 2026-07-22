import path from "node:path";
import { agentError, agentOk, type AgentResponse } from "./response.js";
import { defaultAgentStore } from "./session.js";
import { RunStore, defaultReproRoot } from "../store/run-store.js";
import { readJsonFile, pathExists } from "../store/fs.js";
import { removeWorktree } from "../patcher/worktree.js";
import { execa } from "execa";

export async function agentStatus(opts: {
  id: string;
  cwd?: string;
}): Promise<AgentResponse> {
  const cwd = opts.cwd ?? process.cwd();
  const sessions = defaultAgentStore(cwd);
  const runStore = new RunStore(defaultReproRoot(cwd));

  if (await sessions.exists(opts.id)) {
    const session = await sessions.load(opts.id);
    let run = null;
    if (session.runId) {
      try {
        run = await runStore.load(session.runId);
      } catch {
        run = null;
      }
    }
    return agentOk(session.status, {
      sessionId: session.sessionId,
      runId: session.runId,
      pipelineState: run?.state ?? null,
      worktreePath: session.worktreePath,
      attempts: session.attempts,
      lastError: session.lastError,
      artifacts: {
        sessionDir: session.rootDir,
        runDir: run?.rootDir ?? null,
      },
      recommendedAgentAction: session.runId
        ? {
            type: "CONTINUE",
            command: session.worktreePath
              ? `reprosight agent verify ${session.runId} --workspace --json`
              : `reprosight agent workspace ${session.runId} --session ${session.sessionId} --json`,
          }
        : {
            type: "CALL_RUN",
            command: `reprosight agent run --session ${session.sessionId} --json`,
          },
    });
  }

  try {
    const run = await runStore.load(opts.id);
    const attempts = await readJsonFile<unknown[]>(
      runStore.artifactPath(opts.id, "attempts.json"),
    ).catch(() => []);
    return agentOk("OK", {
      runId: run.id,
      pipelineState: run.state,
      worktreePath: run.worktreePath,
      finalVerdict: run.finalVerdict,
      attempts,
      human: run.human,
      recommendedAgentAction: {
        type: "INSPECT",
        command: `reprosight agent evidence ${run.id} --json`,
      },
    });
  } catch {
    return agentError(
      "INVALID_REQUEST",
      "UNKNOWN_ID",
      `Unknown session or run id: ${opts.id}`,
    );
  }
}

export async function agentReport(opts: {
  runId: string;
  cwd?: string;
}): Promise<AgentResponse> {
  const cwd = opts.cwd ?? process.cwd();
  const runStore = new RunStore(defaultReproRoot(cwd));
  try {
    const run = await runStore.load(opts.runId);
    const reportPath = path.join(run.rootDir, "report", "index.html");
    const attempts = await readJsonFile<unknown[]>(
      runStore.artifactPath(opts.runId, "attempts.json"),
    ).catch(() => []);
    const verification = await readJsonFile<Record<string, unknown>>(
      runStore.artifactPath(opts.runId, "verification.json"),
    ).catch(() => null);
    const humanReviewRequired =
      run.state === "AWAITING_HUMAN_REVIEW" ||
      run.finalVerdict === "AWAITING_HUMAN_REVIEW";
    return agentOk(
      humanReviewRequired ? "HUMAN_REVIEW_REQUIRED" : "OK",
      {
        runId: opts.runId,
        pipelineState: run.state,
        finalVerdict: run.finalVerdict,
        humanReviewRequired,
        reportPath: (await pathExists(reportPath)) ? reportPath : null,
        attempts,
        verificationSummary: verification
          ? {
              overall: verification.overall,
              target: verification.target,
            }
          : null,
      },
    );
  } catch {
    return agentError(
      "INVALID_REQUEST",
      "UNKNOWN_RUN",
      `Unknown run id ${opts.runId}`,
    );
  }
}

export async function agentCleanup(opts: {
  id: string;
  cwd?: string;
  force?: boolean;
}): Promise<AgentResponse> {
  const cwd = opts.cwd ?? process.cwd();
  const sessions = defaultAgentStore(cwd);
  const runStore = new RunStore(defaultReproRoot(cwd));

  let runId: string | null = null;
  let worktreePath: string | null = null;
  let repoPath: string | null = null;

  if (await sessions.exists(opts.id)) {
    const session = await sessions.load(opts.id);
    runId = session.runId;
    worktreePath = session.worktreePath;
    repoPath = session.repoPath;
  } else {
    try {
      const run = await runStore.load(opts.id);
      runId = run.id;
      worktreePath = run.worktreePath;
      repoPath = run.repoPath;
    } catch {
      return agentError(
        "INVALID_REQUEST",
        "UNKNOWN_ID",
        `Unknown session or run id: ${opts.id}`,
      );
    }
  }

  // best-effort kill listeners on common ports is intentionally avoided
  if (worktreePath && repoPath) {
    if (!opts.force) {
      // still allow cleanup but warn in payload
    }
    await removeWorktree({
      repoPath,
      worktreePath,
      force: true,
    });
    if (runId) {
      try {
        const run = await runStore.load(runId);
        run.worktreePath = null;
        await runStore.save(run);
      } catch {
        // ignore
      }
    }
    if (await sessions.exists(opts.id)) {
      const session = await sessions.load(opts.id);
      session.worktreePath = null;
      await sessions.save(session);
    }
  }

  // also prune git worktrees
  if (repoPath) {
    await execa("git", ["worktree", "prune"], {
      cwd: repoPath,
      reject: false,
    });
  }

  return agentOk("OK", {
    cleaned: {
      id: opts.id,
      runId,
      worktreeRemoved: Boolean(worktreePath),
      evidencePreserved: true,
    },
    message: "Cleanup complete. Run evidence preserved under .reprosight/runs.",
  });
}
