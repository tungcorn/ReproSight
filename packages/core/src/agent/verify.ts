import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { agentError, agentOk, type AgentResponse } from "./response.js";
import { defaultAgentStore } from "./session.js";
import { RunStore, defaultReproRoot } from "../store/run-store.js";
import { readJsonFile, writeJsonAtomic, writeAtomic } from "../store/fs.js";
import type { ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";
import { validateUnifiedDiff } from "../patcher/policy.js";
import {
  applyPatchInWorktree,
  hashCheckout,
  verifyOriginalUnchanged,
} from "../patcher/worktree.js";
import { verifyRepair } from "../verifier/verify.js";
import type { EvidencePack } from "../evidence/types.js";

async function workspaceDiff(worktreePath: string): Promise<string> {
  const result = await execa("git", ["diff", "HEAD"], {
    cwd: worktreePath,
    reject: false,
  });
  return result.stdout || "";
}

export async function agentVerify(opts: {
  runId: string;
  sessionId?: string;
  cwd?: string;
  workspace?: boolean;
  patchFile?: string;
  patchText?: string;
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
  const issue = await readJsonFile<IssueSpec>(
    runStore.artifactPath(opts.runId, "issue.json"),
  );
  const beforeEvidence = await readJsonFile<EvidencePack>(
    runStore.artifactPath(opts.runId, "evidence.json"),
  );

  const originalHash =
    run.originalCheckoutHash ?? (await hashCheckout(config.project.repoPath));

  const worktreePath = run.worktreePath;
  let unifiedDiff = "";

  if (opts.patchFile || opts.patchText) {
    unifiedDiff =
      opts.patchText ??
      (await fs.readFile(path.resolve(opts.patchFile!), "utf8"));
    if (!worktreePath) {
      return agentError(
        "WORKSPACE_NOT_READY",
        "WORKSPACE_NOT_READY",
        "Create a workspace first or pass --workspace after agent workspace",
        { runId: opts.runId },
      );
    }
    // reset worktree to clean base then apply
    await execa("git", ["checkout", "--", "."], {
      cwd: worktreePath,
      reject: false,
    });
    await execa("git", ["clean", "-fd"], { cwd: worktreePath, reject: false });
    const check = await applyPatchInWorktree({
      worktreePath,
      unifiedDiff,
      checkOnly: true,
    });
    if (!check.ok) {
      return agentError(
        "PATCH_POLICY_REJECTED",
        "GIT_APPLY_CHECK_FAILED",
        check.output,
        { runId: opts.runId },
      );
    }
    const applied = await applyPatchInWorktree({
      worktreePath,
      unifiedDiff,
    });
    if (!applied.ok) {
      return agentError(
        "PATCH_POLICY_REJECTED",
        "GIT_APPLY_FAILED",
        applied.output,
        { runId: opts.runId },
      );
    }
  } else if (opts.workspace) {
    if (!worktreePath) {
      return agentError(
        "WORKSPACE_NOT_READY",
        "WORKSPACE_NOT_READY",
        "No worktree recorded for run. Call agent workspace first.",
        { runId: opts.runId },
      );
    }
    unifiedDiff = await workspaceDiff(worktreePath);
    if (!unifiedDiff.trim()) {
      return agentError(
        "TARGET_STILL_FAILING",
        "EMPTY_DIFF",
        "Workspace has no changes to verify",
        { runId: opts.runId, worktreePath },
      );
    }
  } else {
    return agentError(
      "INVALID_REQUEST",
      "MISSING_REPAIR_INPUT",
      "Provide --workspace or --patch-file/--patch-stdin",
      { runId: opts.runId },
    );
  }

  const policy = validateUnifiedDiff(unifiedDiff, config.patchPolicy);
  await writeAtomic(
    runStore.artifactPath(opts.runId, "patch.diff"),
    unifiedDiff,
  );
  await writeJsonAtomic(
    runStore.artifactPath(opts.runId, "patch-validation.json"),
    policy,
  );
  await runStore.markPresent(opts.runId, "patch");
  await runStore.markPresent(opts.runId, "patch-validation");

  const attemptId = `attempt_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 6)}`;
  const attemptDir = path.join(
    runStore.runDir(opts.runId),
    "attempts",
    attemptId,
  );
  await fs.mkdir(attemptDir, { recursive: true });
  await writeAtomic(path.join(attemptDir, "patch.diff"), unifiedDiff);
  await writeJsonAtomic(path.join(attemptDir, "patch-validation.json"), policy);

  if (!policy.accepted) {
    const attempt = {
      attemptId,
      at: new Date().toISOString(),
      verdict: "PATCH_POLICY_REJECTED",
      patchPolicyAccepted: false,
      changedFiles: policy.files,
      notes: policy.reasons,
    };
    await recordAttempt(opts, attempt, cwd);
    return agentOk("PATCH_POLICY_REJECTED", {
      runId: opts.runId,
      sessionId: opts.sessionId,
      attemptId,
      verificationVerdict: "PATCH_POLICY_REJECTED",
      patchPolicy: policy,
      integrity: {
        originalCheckoutUnchanged: (
          await verifyOriginalUnchanged(
            config.project.repoPath,
            originalHash,
          )
        ).ok,
      },
      recommendedAgentAction: {
        type: "REVISE_WORKSPACE_REPAIR",
        command: `reprosight agent verify ${opts.runId} --workspace --json`,
      },
    });
  }

  // Ensure patch content is in worktree (for workspace mode already edited)
  if (opts.workspace && worktreePath) {
    // already edited; nothing to apply
  }

  try {
    const verification = await verifyRepair({
      config,
      issue,
      worktreePath: worktreePath!,
      store: runStore,
      runId: opts.runId,
      beforeEvidence,
    });
    await writeJsonAtomic(
      runStore.artifactPath(opts.runId, "verification.json"),
      verification,
    );
    await runStore.markPresent(opts.runId, "verification");
    await writeJsonAtomic(
      path.join(attemptDir, "verification.json"),
      verification,
    );

    const integrity = await verifyOriginalUnchanged(
      config.project.repoPath,
      originalHash,
    );

    let status:
      | "HUMAN_REVIEW_REQUIRED"
      | "TARGET_STILL_FAILING"
      | "REGRESSION_INTRODUCED"
      | "NEW_ACCESSIBILITY_FAILURE"
      | "NEW_CONSOLE_ERROR"
      | "VERIFICATION_INFRASTRUCTURE_FAILURE" = "TARGET_STILL_FAILING";
    let verificationVerdict = "TARGET_STILL_FAILING";

    if (!integrity.ok) {
      status = "VERIFICATION_INFRASTRUCTURE_FAILURE";
      verificationVerdict = "ORIGINAL_CHECKOUT_CHANGED";
    } else if (verification.overall === "VERIFIED") {
      status = "HUMAN_REVIEW_REQUIRED";
      verificationVerdict = "TARGET_FIXED_REGRESSIONS_PASSED";
    } else if (verification.overall === "REGRESSION_INTRODUCED") {
      status = "REGRESSION_INTRODUCED";
      verificationVerdict = "REGRESSION_INTRODUCED";
    } else if (verification.axeComparison.newViolationIds.length > 0) {
      status = "NEW_ACCESSIBILITY_FAILURE";
      verificationVerdict = "NEW_ACCESSIBILITY_FAILURE";
    } else if (verification.consoleComparison.newErrors.length > 0) {
      status = "NEW_CONSOLE_ERROR";
      verificationVerdict = "NEW_CONSOLE_ERROR";
    } else {
      status = "TARGET_STILL_FAILING";
      verificationVerdict = "TARGET_STILL_FAILING";
    }

    const attempt = {
      attemptId,
      at: new Date().toISOString(),
      verdict: verificationVerdict,
      patchPolicyAccepted: true,
      changedFiles: policy.files,
      notes: verification.target.failures,
      artifacts: {
        after: "artifacts/after.png",
        diff: "artifacts/diff.png",
        verification: "verification.json",
      },
    };
    await recordAttempt(opts, attempt, cwd);

    return agentOk(status, {
      runId: opts.runId,
      sessionId: opts.sessionId,
      attemptId,
      verificationVerdict,
      target: {
        before: "FAILED",
        after:
          verification.target.verdict === "Fixed" ? "PASSED" : "FAILED",
        failures: verification.target.failures,
      },
      regressions: {
        passed: verification.regressions.filter((r) => r.passed).length,
        failed: verification.regressions.filter((r) => !r.passed).length,
        rows: verification.regressions,
      },
      patchPolicy: {
        accepted: true,
        changedFiles: policy.files,
        addedLines: policy.addedLines,
        deletedLines: policy.deletedLines,
      },
      axeComparison: verification.axeComparison,
      consoleComparison: verification.consoleComparison,
      integrity: {
        originalCheckoutUnchanged: integrity.ok,
        originalCheckoutHash: originalHash,
      },
      artifacts: {
        report: path.join(run.rootDir, "report", "index.html"),
        attemptDir,
      },
      recommendedAgentAction:
        status === "HUMAN_REVIEW_REQUIRED"
          ? {
              type: "REPORT_TO_USER",
              humanApprovalStillRequired: true,
              command: `reprosight agent report ${opts.runId} --json`,
            }
          : {
              type: "REVISE_WORKSPACE_REPAIR",
              command: `reprosight agent evidence ${opts.runId} --json`,
            },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempt = {
      attemptId,
      at: new Date().toISOString(),
      verdict: "VERIFICATION_INFRASTRUCTURE_FAILURE",
      notes: [message],
    };
    await recordAttempt(opts, attempt, cwd);
    return agentError(
      "VERIFICATION_INFRASTRUCTURE_FAILURE",
      "VERIFICATION_INFRASTRUCTURE_FAILURE",
      message,
      { runId: opts.runId, attemptId },
    );
  }
}

async function recordAttempt(
  opts: { runId: string; sessionId?: string },
  attempt: {
    attemptId: string;
    at: string;
    verdict: string;
    patchPolicyAccepted?: boolean;
    changedFiles?: string[];
    notes?: string[];
    artifacts?: Record<string, string | null>;
  },
  cwd: string,
): Promise<void> {
  const runStore = new RunStore(defaultReproRoot(cwd));
  const historyPath = runStore.artifactPath(opts.runId, "attempts.json");
  let history: unknown[] = [];
  try {
    history = await readJsonFile<unknown[]>(historyPath);
  } catch {
    history = [];
  }
  history.push(attempt);
  await writeJsonAtomic(historyPath, history);

  if (opts.sessionId) {
    const sessions = defaultAgentStore(cwd);
    if (await sessions.exists(opts.sessionId)) {
      const session = await sessions.load(opts.sessionId);
      session.attempts.push(attempt);
      await sessions.save(session);
    }
  }
}
