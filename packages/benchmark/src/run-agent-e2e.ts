import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import {
  agentRun,
  agentWorkspace,
  agentVerify,
  agentEvidence,
  agentReport,
  agentCleanup,
  discoverRepository,
  prepareAgentSession,
  buildAgentContract,
  hashCheckout,
} from "@reprosight/core";
import { repoRoot, staticServeCommand as ssc } from "./fixture-server.js";

type CaseResult = {
  id: string;
  ok: boolean;
  notes: string[];
  details?: Record<string, unknown>;
};

async function ensureGit(dir: string): Promise<void> {
  try {
    await fs.access(path.join(dir, ".git"));
  } catch {
    await execa("git", ["init"], { cwd: dir });
  }
  await execa("git", ["config", "user.email", "agent-e2e@reprosight.local"], {
    cwd: dir,
  });
  await execa("git", ["config", "user.name", "Agent E2E"], { cwd: dir });
  await execa("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  await fs.writeFile(path.join(dir, ".gitattributes"), "* text=auto eol=lf\n");
  await execa("git", ["add", "-A"], { cwd: dir });
  const st = await execa("git", ["status", "--porcelain"], { cwd: dir });
  if (st.stdout.trim()) {
    await execa("git", ["commit", "-m", "agent e2e baseline"], {
      cwd: dir,
      reject: false,
    });
  }
}

async function caseA(): Promise<CaseResult> {
  const id = "A-description-only-overflow";
  const notes: string[] = [];
  const fixture = path.join(repoRoot, "fixtures", "locale-overflow");
  await ensureGit(fixture);
  const before = await hashCheckout(fixture);

  const contract = buildAgentContract("json");
  if (contract.status !== "OK") {
    return { id, ok: false, notes: ["contract failed"] };
  }

  const discovery = await discoverRepository(fixture);
  if (!discovery.repository.isGit) {
    notes.push("fixture not git");
  }

  // Agent supplies start/ready (as coding agent would after discover)
  const port = 4271;
  const prepared = await prepareAgentSession({
    cwd: repoRoot,
    request: {
      version: 1,
      repository: { path: fixture },
      task: {
        description:
          "Vietnamese About highlights overflow at tablet width 768px",
      },
      stateHints: {
        route: "/",
        viewport: { width: 768, height: 1024 },
        locale: "vi",
        theme: "dark",
      },
      projectHints: {
        installCommand: 'node -e "process.exit(0)"',
        startCommand: ssc(port),
        readyUrl: `http://127.0.0.1:${port}`,
      },
      reproductionHints: {
        category: "horizontalOverflow",
        actions: [
          { type: "click", selector: "[data-language-toggle]" },
          { type: "scrollIntoView", selector: "#about" },
        ],
      },
    },
  });
  if (prepared.status !== "OK" || !prepared.sessionId) {
    return {
      id,
      ok: false,
      notes: [`prepare ${prepared.status}: ${prepared.message}`],
      details: prepared,
    };
  }

  const run = await agentRun({
    sessionId: prepared.sessionId,
    cwd: repoRoot,
  });
  if (run.status !== "REPRODUCED" || !run.runId) {
    return {
      id,
      ok: false,
      notes: [`run ${run.status}`],
      details: run,
    };
  }

  const evidence = await agentEvidence({
    runId: String(run.runId),
    section: "summary",
    cwd: repoRoot,
  });

  const ws = await agentWorkspace({
    runId: String(run.runId),
    sessionId: prepared.sessionId,
    cwd: repoRoot,
  });
  if (ws.status !== "WORKSPACE_READY") {
    return { id, ok: false, notes: [`workspace ${ws.status}`], details: ws };
  }

  // Known repair for locale-overflow fixture (coding agent would edit files)
  const workspacePath = (ws.workspace as { path: string }).path;
  const cssPath = path.join(workspacePath, "styles.css");
  let css = await fs.readFile(cssPath, "utf8");
  css = css.replace("white-space: nowrap;", "white-space: normal;");
  css = css.replace(
    /\n\/\* buggy late desktop override without min-width media \*\/\n\.about__highlights \{\n {2}grid-template-columns: 280px 280px 280px;\n\}\n?/,
    "\n",
  );
  await fs.writeFile(cssPath, css, "utf8");

  const verify = await agentVerify({
    runId: String(run.runId),
    sessionId: prepared.sessionId,
    workspace: true,
    cwd: repoRoot,
  });
  const report = await agentReport({
    runId: String(run.runId),
    cwd: repoRoot,
  });
  await agentCleanup({ id: String(run.runId), cwd: repoRoot, force: true });

  const after = await hashCheckout(fixture);
  const ok =
    verify.verificationVerdict === "TARGET_FIXED_REGRESSIONS_PASSED" &&
    verify.status === "HUMAN_REVIEW_REQUIRED" &&
    after === before &&
    (report.humanReviewRequired === true ||
      report.status === "HUMAN_REVIEW_REQUIRED");

  if (!ok) {
    notes.push(`verify=${String(verify.verificationVerdict)}`);
    notes.push(`status=${verify.status}`);
    notes.push(`reportHR=${String(report.humanReviewRequired)}`);
    notes.push(`unchanged=${after === before}`);
  }

  return {
    id,
    ok,
    notes,
    details: {
      runStatus: run.status,
      evidenceStatus: evidence.status,
      verify: verify.verificationVerdict,
      verifyStatus: verify.status,
      verifyMessage: verify.message,
      humanReviewRequired: report.humanReviewRequired,
      originalUnchanged: after === before,
      contractCommands: Object.keys(
        ((contract as { commands?: object }).commands ?? {}) as object,
      ).length,
    },
  };
}

async function caseC_incorrectThenFix(): Promise<CaseResult> {
  const id = "C-incorrect-first-repair";
  const notes: string[] = [];
  const fixture = path.join(repoRoot, "fixtures", "overlap");
  await ensureGit(fixture);
  const before = await hashCheckout(fixture);
  const port = 4272;

  const prepared = await prepareAgentSession({
    cwd: repoRoot,
    request: {
      version: 1,
      repository: { path: fixture },
      task: {
        description: "CTA is covered by an absolute badge on mobile 390px",
      },
      stateHints: {
        viewport: { width: 390, height: 844 },
        route: "/",
      },
      projectHints: {
        installCommand: 'node -e "process.exit(0)"',
        startCommand: ssc(port),
        readyUrl: `http://127.0.0.1:${port}`,
      },
      reproductionHints: {
        category: "overlap",
        suspectedSelectors: ["#cta", "#badge"],
      },
    },
  });
  if (prepared.status !== "OK" || !prepared.sessionId) {
    return { id, ok: false, notes: [`prepare ${prepared.status}`] };
  }
  const run = await agentRun({ sessionId: prepared.sessionId, cwd: repoRoot });
  if (run.status !== "REPRODUCED" || !run.runId) {
    return { id, ok: false, notes: [`run ${run.status}`] };
  }
  const ws = await agentWorkspace({
    runId: String(run.runId),
    sessionId: prepared.sessionId,
    cwd: repoRoot,
  });
  const workspacePath = (ws.workspace as { path: string }).path;

  // Attempt 1: insufficient change (comment only)
  const cssPath = path.join(workspacePath, "styles.css");
  let css = await fs.readFile(cssPath, "utf8");
  await fs.writeFile(cssPath, `${css}\n/* noop */\n`, "utf8");
  const attempt1 = await agentVerify({
    runId: String(run.runId),
    sessionId: prepared.sessionId,
    workspace: true,
    cwd: repoRoot,
  });

  // Attempt 2: real fix
  css = await fs.readFile(cssPath, "utf8");
  css = css
    .replace("left: 90px;", "left: 220px;")
    .replace("top: 30px;", "top: 8px;")
    .replace("/* noop */\n", "");
  await fs.writeFile(cssPath, css, "utf8");
  const attempt2 = await agentVerify({
    runId: String(run.runId),
    sessionId: prepared.sessionId,
    workspace: true,
    cwd: repoRoot,
  });

  await agentCleanup({ id: String(run.runId), cwd: repoRoot, force: true });
  const after = await hashCheckout(fixture);

  const ok =
    attempt1.verificationVerdict !== "TARGET_FIXED_REGRESSIONS_PASSED" &&
    attempt2.verificationVerdict === "TARGET_FIXED_REGRESSIONS_PASSED" &&
    after === before;

  if (!ok) {
    notes.push(`a1=${attempt1.verificationVerdict}`);
    notes.push(`a2=${attempt2.verificationVerdict}`);
  }

  return {
    id,
    ok,
    notes,
    details: {
      attempt1: attempt1.verificationVerdict,
      attempt2: attempt2.verificationVerdict,
      originalUnchanged: after === before,
    },
  };
}

async function caseE_ambiguousStart(): Promise<CaseResult> {
  const id = "E-agent-action-ambiguity";
  // Use monorepo root which has multiple scripts (dev/build/test)
  const discovery = await discoverRepository(repoRoot);
  const ambiguous =
    discovery.startCommandCandidates.length > 1 ||
    discovery.startCommandCandidates.some((c) => c.confidence < 1);
  // prepare without start hint on a package with multiple scripts
  const prepared = await prepareAgentSession({
    cwd: repoRoot,
    request: {
      version: 1,
      repository: { path: repoRoot },
      task: { description: "Something overflows on mobile" },
    },
  });
  // For monorepo root, start candidates include dev — may auto-pick with high confidence.
  // Accept AGENT_ACTION_REQUIRED when confidence low; else ensure candidates are exposed.
  const hasCandidates =
    Array.isArray(
      (prepared as { discovery?: { startCommandCandidates?: unknown[] } })
        .discovery?.startCommandCandidates,
    ) || discovery.startCommandCandidates.length > 0;
  const prepareOk =
    prepared.status === "AGENT_ACTION_REQUIRED" || prepared.status === "OK";
  return {
    id,
    ok: hasCandidates && prepareOk,
    notes: [
      `prepareStatus=${prepared.status}`,
      `discoverStarts=${discovery.startCommandCandidates.length}`,
      `ambiguous=${ambiguous}`,
    ],
    details: {
      preparedStatus: prepared.status,
      code: prepared.code,
      candidates: discovery.startCommandCandidates,
    },
  };
}

async function main() {
  const results: CaseResult[] = [];
  console.log("Agent E2E Case A...");
  results.push(await caseA());
  console.log("Agent E2E Case C...");
  results.push(await caseC_incorrectThenFix());
  console.log("Agent E2E Case E...");
  results.push(await caseE_ambiguousStart());

  // Case B lightweight: screenshot metadata path optional + overlap description
  console.log("Agent E2E Case B...");
  {
    const fixture = path.join(repoRoot, "fixtures", "fixed-badge");
    await ensureGit(fixture);
    const port = 4273;
    const prepared = await prepareAgentSession({
      cwd: repoRoot,
      request: {
        version: 1,
        repository: { path: fixture },
        task: {
          description: "This checkout button is being covered on mobile",
          screenshot: null,
        },
        stateHints: { viewport: { width: 390, height: 844 } },
        projectHints: {
          installCommand: 'node -e "process.exit(0)"',
          startCommand: ssc(port),
          readyUrl: `http://127.0.0.1:${port}`,
        },
        reproductionHints: {
          category: "overlap",
          suspectedSelectors: ["#save", "#promo"],
          actions: [],
        },
      },
    });
    const run = await agentRun({
      sessionId: String(prepared.sessionId),
      cwd: repoRoot,
    });
    // Reproduction may be REPRODUCED when overlap detectors fire.
    results.push({
      id: "B-screenshot-vague-overlap",
      ok:
        prepared.status === "OK" &&
        (run.status === "REPRODUCED" || run.status === "NOT_REPRODUCED"),
      notes: [`prepare=${prepared.status}`, `run=${run.status}`],
      details: { runId: run.runId, acceptedNotReproduced: true },
    });
    if (run.runId) {
      await agentCleanup({ id: String(run.runId), cwd: repoRoot, force: true });
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    results,
    note: "External-agent simulation harness (no network model).",
  };
  const out = path.join(repoRoot, "artifacts", "benchmark", "agent-e2e.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
