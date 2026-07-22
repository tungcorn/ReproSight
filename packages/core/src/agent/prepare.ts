import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { AgentRequest } from "./request.js";
import { parseAgentRequest } from "./request.js";
import { discoverRepository, type DiscoveryResult } from "./discover.js";
import { inferScenario } from "./scenario.js";
import {
  assertSafeOptionalPath,
  assertSafeReadyUrl,
  assertSafeRepoPath,
  assertSafeStartCommand,
  redactDeep,
} from "./security.js";
import { AgentSessionStore, defaultAgentStore } from "./session.js";
import { agentError, agentOk, type AgentResponse } from "./response.js";
import { parseConfig, type ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";

function pickStart(
  discovery: DiscoveryResult,
  hint?: string,
): { command: string; confidence: number; reason: string } {
  if (hint) {
    assertSafeStartCommand(hint);
    return {
      command: hint,
      confidence: 0.95,
      reason: "projectHints.startCommand",
    };
  }
  const top = discovery.startCommandCandidates[0];
  if (!top) {
    throw Object.assign(new Error("No start command candidates"), {
      code: "AGENT_ACTION_REQUIRED",
    });
  }
  return top;
}

function pickReadyUrl(
  discovery: DiscoveryResult,
  hint?: string,
  startCommand?: string,
): { url: string; confidence: number; reason: string } {
  if (hint) {
    assertSafeReadyUrl(hint);
    return { url: hint, confidence: 0.95, reason: "projectHints.readyUrl" };
  }
  const portMatch = startCommand?.match(/(\d{4,5})/);
  if (portMatch) {
    const url = `http://127.0.0.1:${portMatch[1]}`;
    assertSafeReadyUrl(url);
    return {
      url,
      confidence: 0.8,
      reason: "port inferred from start command",
    };
  }
  const top = discovery.readyUrlCandidates[0]!;
  assertSafeReadyUrl(top.url);
  return top;
}

function screenshotMeta(screenshot: string | null | undefined) {
  if (!screenshot) return null;
  const p = assertSafeOptionalPath(screenshot, "screenshot");
  if (!p || !fs.existsSync(p)) {
    return { path: screenshot, exists: false };
  }
  const buf = fs.readFileSync(p);
  const stat = fs.statSync(p);
  return {
    path: p,
    exists: true,
    bytes: stat.size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    // PNG IHDR width/height if possible
    ...readPngSize(buf),
  };
}

function readPngSize(buf: Buffer): { width?: number; height?: number } {
  if (buf.length < 24) return {};
  if (buf.toString("ascii", 1, 4) !== "PNG") return {};
  try {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return {};
  }
}

export async function prepareAgentSession(opts: {
  request: unknown;
  cwd?: string;
  sessionStore?: AgentSessionStore;
}): Promise<AgentResponse> {
  let request: AgentRequest;
  try {
    request = parseAgentRequest(opts.request);
  } catch (err) {
    return agentError(
      "INVALID_REQUEST",
      "INVALID_REQUEST",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    assertSafeStartCommand(request.projectHints?.startCommand);
    assertSafeReadyUrl(request.projectHints?.readyUrl);
    assertSafeOptionalPath(request.task.screenshot, "screenshot");
  } catch (err) {
    return agentError(
      "UNSAFE_REQUEST",
      "UNSAFE_REQUEST",
      err instanceof Error ? err.message : String(err),
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const repoPath = assertSafeRepoPath(
    path.resolve(cwd, request.repository.path),
  );
  const store = opts.sessionStore ?? defaultAgentStore(cwd);

  let discovery: DiscoveryResult;
  try {
    discovery = await discoverRepository(repoPath);
  } catch (err) {
    return agentError(
      "ERROR",
      "DISCOVERY_FAILED",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (discovery.startCommandCandidates.length === 0 && !request.projectHints?.startCommand) {
    return agentOk("AGENT_ACTION_REQUIRED", {
      code: "MISSING_START_COMMAND",
      message: "No start command could be inferred.",
      unresolved: [
        {
          field: "projectHints.startCommand",
          reason: "No package scripts or static entry discovered.",
          candidates: [],
        },
      ],
      discovery: redactDeep(discovery),
      recommendedAgentAction: {
        type: "INSPECT_PACKAGE_SCRIPTS",
        then: "CALL_PREPARE_AGAIN",
      },
    });
  }

  if (
    discovery.startCommandCandidates.length > 1 &&
    !request.projectHints?.startCommand &&
    (discovery.startCommandCandidates[0]?.confidence ?? 0) < 0.9
  ) {
    return agentOk("AGENT_ACTION_REQUIRED", {
      code: "AMBIGUOUS_START_COMMAND",
      message: "Multiple start commands ranked; agent should choose one.",
      unresolved: [
        {
          field: "projectHints.startCommand",
          reason: "Multiple package scripts can start the app.",
          candidates: discovery.startCommandCandidates.map((c) => ({
            value: c.command,
            confidence: c.confidence,
            reason: c.reason,
          })),
        },
      ],
      discovery: redactDeep(discovery),
      recommendedAgentAction: {
        type: "CHOOSE_START_COMMAND",
        then: "CALL_PREPARE_AGAIN",
      },
    });
  }

  const session = await store.create({ request, repoPath });
  await store.writeJson(session.sessionId, "request.normalized.json", request);
  await store.writeJson(session.sessionId, "discovery.json", discovery);
  session.discoveryPath = "discovery.json";

  const start = pickStart(discovery, request.projectHints?.startCommand);
  const ready = pickReadyUrl(
    discovery,
    request.projectHints?.readyUrl,
    start.command,
  );
  const scenario = inferScenario(request);
  const shot = screenshotMeta(request.task.screenshot);

  // Screenshot pixel size is metadata only; do not assume equality with CSS viewport.

  // Static fixtures often lack package-lock; never force `npm ci` there.
  const hasLockfile =
    fs.existsSync(path.join(repoPath, "package-lock.json")) ||
    fs.existsSync(path.join(repoPath, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(repoPath, "yarn.lock"));
  const install =
    request.projectHints?.installCommand ??
    (hasLockfile
      ? (discovery.installCommandCandidates[0]?.command ?? "npm ci")
      : 'node -e "process.exit(0)"');

  const config: ReproSightConfig = parseConfig({
    project: {
      name:
        request.projectHints?.name ??
        discovery.project.name.value ??
        "agent-target",
      repoPath,
      baseRef: request.repository.baseRef ?? "HEAD",
    },
    commands: {
      install,
      start: start.command,
    },
    server: {
      readyUrl: ready.url,
      timeoutMs: 60_000,
    },
    browser: {
      headless: !(request.execution?.headed ?? false),
    },
    routes: [scenario.issue.route],
    states: {
      viewports: [
        {
          name: "target",
          width: scenario.issue.state.viewport.width,
          height: scenario.issue.state.viewport.height,
        },
        { name: "desktop", width: 1440, height: 900 },
        { name: "tablet", width: 768, height: 1024 },
        { name: "mobile", width: 390, height: 844 },
      ],
      locales: [scenario.issue.state.locale, "en"].filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
      themes: [scenario.issue.state.theme],
    },
    detectors: {
      horizontalOverflow: true,
      overlap: true,
      textClipping: true,
      stickyOcclusion: true,
      accessibility: true,
    },
    patchPolicy: {
      allowedGlobs: [
        "src/**/*.{css,scss,html,tsx,ts,jsx,js}",
        "public/**/*.html",
        "css/**/*.css",
        "*.css",
        "*.html",
        "**/*.{css,html,js,tsx,ts,jsx}",
      ],
      deniedGlobs: [
        ".env*",
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
      ],
      maxFiles: 3,
      maxAddedLines: 120,
      maxDeletedLines: 120,
    },
    regressionMatrix: { includeAllConfiguredStates: true },
    worktree: {
      preserveOnFailure: request.execution?.keepWorkspaceOnFailure ?? true,
    },
  });

  const issue: IssueSpec = scenario.issue;
  await store.writeJson(session.sessionId, "generated-config.json", config);
  await store.writeJson(session.sessionId, "generated-issue.json", issue);
  session.generatedConfigPath = "generated-config.json";
  session.generatedIssuePath = "generated-issue.json";

  const preparation = {
    start,
    ready,
    scenarioFields: scenario.fields,
    screenshot: shot,
    unresolved: scenario.unresolved,
  };
  await store.writeJson(session.sessionId, "preparation.json", preparation);
  session.preparationPath = "preparation.json";
  session.status = "OK";
  await store.save(session);

  // Human input only for genuine product ambiguity — not package scripts
  const humanNeeded = false;

  return agentOk("OK", {
    sessionId: session.sessionId,
    repository: discovery.repository,
    generated: {
      configPath: store.resolvePath(session.sessionId, "generated-config.json"),
      issuePath: store.resolvePath(session.sessionId, "generated-issue.json"),
    },
    preparation,
    discovery: {
      packageManager: discovery.project.packageManager,
      framework: discovery.project.framework,
      startCommandCandidates: discovery.startCommandCandidates,
      readyUrlCandidates: discovery.readyUrlCandidates,
      routeCandidates: discovery.routeCandidates,
    },
    recommendedAgentAction: {
      type: "CALL_RUN",
      command: `reprosight agent run --session ${session.sessionId} --json`,
    },
    humanNeeded,
  });
}
