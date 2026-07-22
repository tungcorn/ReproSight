import type { AgentRequest } from "./request.js";
import { parseAgentRequest } from "./request.js";
import { prepareAgentSession } from "./prepare.js";
import { defaultAgentStore } from "./session.js";
import { agentError, agentOk, type AgentResponse } from "./response.js";
import { readJsonFile } from "../store/fs.js";
import type { ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";
import { runFullPipeline } from "../orchestrator/pipeline.js";
import { RunStore, defaultReproRoot } from "../store/run-store.js";
import { hashCheckout } from "../patcher/worktree.js";

export async function agentRun(opts: {
  request?: unknown;
  sessionId?: string;
  cwd?: string;
  headed?: boolean;
}): Promise<AgentResponse> {
  const cwd = opts.cwd ?? process.cwd();
  const store = defaultAgentStore(cwd);

  let sessionId = opts.sessionId;
  if (!sessionId) {
    if (!opts.request) {
      return agentError(
        "INVALID_REQUEST",
        "INVALID_REQUEST",
        "Provide --request/--stdin description or --session",
      );
    }
    const prepared = await prepareAgentSession({
      request: opts.request,
      cwd,
      sessionStore: store,
    });
    if (prepared.status !== "OK" || !prepared.sessionId) {
      return prepared;
    }
    sessionId = prepared.sessionId;
  }

  const session = await store.load(sessionId);
  if (!session.generatedConfigPath || !session.generatedIssuePath) {
    return agentError(
      "WORKSPACE_NOT_READY",
      "NOT_PREPARED",
      "Call agent prepare before agent run",
      { sessionId },
    );
  }

  const config = await readJsonFile<ReproSightConfig>(
    store.resolvePath(sessionId, session.generatedConfigPath),
  );
  const issue = await readJsonFile<IssueSpec>(
    store.resolvePath(sessionId, session.generatedIssuePath),
  );

  let originalHash: string | null = null;
  try {
    originalHash = await hashCheckout(config.project.repoPath);
    session.originalCheckoutHash = originalHash;
  } catch {
    // non-git fixtures still ok for static discovery
  }

  try {
    const result = await runFullPipeline({
      config,
      issue,
      cwd,
      provider: "mock",
      headless: opts.headed === true ? false : true,
      noPatch: true,
      keepWorktree: true,
    });

    session.runId = result.runId;
    const runStore = new RunStore(defaultReproRoot(cwd));
    const run = await runStore.load(result.runId);
    const evidence = await readJsonFile<Record<string, unknown>>(
      runStore.artifactPath(result.runId, "evidence.json"),
    ).catch(() => null);
    const reproduction = await readJsonFile<{
      reproduced?: boolean;
      assertion?: { failures?: string[] };
    }>(runStore.artifactPath(result.runId, "reproduction.json")).catch(
      () => null,
    );

    const detectors = (evidence?.detectors ?? {}) as Record<string, unknown[]>;
    const findings = [
      {
        detector: "horizontalOverflow",
        status:
          ((detectors.horizontalOverflow as unknown[]) ?? []).length > 0
            ? "CONFIRMED"
            : "NONE",
        count: ((detectors.horizontalOverflow as unknown[]) ?? []).length,
      },
      {
        detector: "overlap",
        status:
          ((detectors.overlap as unknown[]) ?? []).length > 0
            ? "CONFIRMED"
            : "NONE",
        count: ((detectors.overlap as unknown[]) ?? []).length,
      },
      {
        detector: "textClipping",
        status:
          ((detectors.textClipping as unknown[]) ?? []).length > 0
            ? "CONFIRMED"
            : "NONE",
        count: ((detectors.textClipping as unknown[]) ?? []).length,
      },
      {
        detector: "stickyOcclusion",
        status:
          ((detectors.stickyOcclusion as unknown[]) ?? []).length > 0
            ? "CONFIRMED"
            : "NONE",
        count: ((detectors.stickyOcclusion as unknown[]) ?? []).length,
      },
    ];

    const reproduced =
      result.state !== "NOT_REPRODUCED" && Boolean(reproduction?.reproduced);

    if (originalHash) {
      const after = await hashCheckout(config.project.repoPath);
      if (after !== originalHash) {
        return agentError(
          "ERROR",
          "ORIGINAL_CHECKOUT_MUTATED",
          "Original checkout changed during reproduction",
          { sessionId, runId: result.runId },
        );
      }
    }

    session.status = reproduced ? "REPRODUCED" : "NOT_REPRODUCED";
    await store.save(session);

    return agentOk(reproduced ? "REPRODUCED" : "NOT_REPRODUCED", {
      sessionId,
      runId: result.runId,
      pipelineState: result.state,
      target: {
        route: issue.route,
        viewport: issue.state.viewport,
        locale: issue.state.locale,
        theme: issue.state.theme,
      },
      findings,
      sourceCandidates: (evidence?.sourceCandidates as unknown[]) ?? [],
      artifacts: {
        rootDir: run.rootDir,
        before: "artifacts/before.png",
        beforeAnnotated: "artifacts/before-annotated.png",
        evidence: "evidence.json",
        report: "report/index.html",
        config: session.generatedConfigPath,
        issue: session.generatedIssuePath,
      },
      integrity: {
        originalCheckoutUnchanged: true,
        originalCheckoutHash: originalHash,
      },
      recommendedAgentAction: reproduced
        ? {
            type: "CREATE_REPAIR_WORKSPACE",
            command: `reprosight agent workspace ${result.runId} --session ${sessionId} --json`,
          }
        : {
            type: "REFINE_SCENARIO_OR_INSPECT",
            command: `reprosight agent evidence ${result.runId} --json`,
          },
    });
  } catch (err) {
    session.lastError = err instanceof Error ? err.message : String(err);
    session.status = "APPLICATION_START_FAILED";
    await store.save(session);
    return agentError(
      "APPLICATION_START_FAILED",
      "APPLICATION_START_FAILED",
      session.lastError,
      { sessionId },
    );
  }
}

export async function buildRequestFromFlags(flags: {
  repo?: string;
  description?: string;
  screenshot?: string;
  route?: string;
  width?: number;
  height?: number;
  locale?: string;
  theme?: "dark" | "light";
  startCommand?: string;
  readyUrl?: string;
}): Promise<AgentRequest> {
  if (!flags.description) {
    throw new Error("description is required");
  }
  return parseAgentRequest({
    version: 1,
    repository: { path: flags.repo ?? "." },
    task: {
      description: flags.description,
      screenshot: flags.screenshot ?? null,
    },
    stateHints: {
      route: flags.route,
      viewport:
        flags.width && flags.height
          ? { width: flags.width, height: flags.height }
          : undefined,
      locale: flags.locale,
      theme: flags.theme,
    },
    projectHints: {
      startCommand: flags.startCommand,
      readyUrl: flags.readyUrl,
    },
    execution: {
      mode: "external-agent-repair",
      noPatch: true,
    },
  });
}
