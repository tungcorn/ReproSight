import path from "node:path";
import fs from "node:fs/promises";
import {
  parseConfig,
  parseIssue,
  runFullPipeline,
  defaultReproRoot,
  removeWorktree,
  RunStore,
  hashCheckout,
} from "@reprosight/core";
import { BENCH_CASES } from "./cases.js";
import { repoRoot } from "./fixture-server.js";
import { execa } from "execa";

type MatrixRow = {
  id: string;
  runId?: string;
  state?: string;
  reproducedBefore: boolean | null;
  expectedDetector: string;
  sourceCandidatePresent: boolean | null;
  schemaValid: boolean | null;
  patchPolicyAccepted: boolean | null;
  worktreeOnly: boolean | null;
  originalUnchanged: boolean | null;
  targetFixed: boolean | null;
  regressionsPassed: boolean | null;
  noNewAxe: boolean | null;
  noNewConsole: boolean | null;
  reportGenerated: boolean | null;
  awaitingHumanReview: boolean | null;
  ok: boolean;
  notes: string[];
};

async function ensureGitRepo(dir: string): Promise<void> {
  try {
    await fs.access(path.join(dir, ".git"));
  } catch {
    await execa("git", ["init"], { cwd: dir });
  }
  await execa("git", ["config", "user.email", "bench@reprosight.local"], {
    cwd: dir,
  });
  await execa("git", ["config", "user.name", "ReproSight Bench"], { cwd: dir });
  await execa("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  await fs.writeFile(path.join(dir, ".gitattributes"), "* text=auto eol=lf\n");
  await execa("git", ["add", "-A"], { cwd: dir });
  const status = await execa("git", ["status", "--porcelain"], { cwd: dir });
  if (status.stdout.trim()) {
    await execa("git", ["commit", "-m", "fixture baseline"], {
      cwd: dir,
      reject: false,
    });
  }
}

async function cleanupRuntime(): Promise<void> {
  const store = new RunStore(defaultReproRoot(repoRoot));
  const runs = await store.listRuns().catch(() => []);
  for (const run of runs) {
    if (run.worktreePath) {
      await removeWorktree({
        repoPath: path.resolve(run.repoPath),
        worktreePath: run.worktreePath,
        force: true,
      }).catch(() => undefined);
    }
  }
  // Remove disposable generated runs only (not tracked demo evidence)
  await fs.rm(path.join(repoRoot, ".reprosight", "runs"), {
    recursive: true,
    force: true,
  });
  await fs.rm(path.join(repoRoot, ".reprosight", "worktrees"), {
    recursive: true,
    force: true,
  });
}

async function main() {
  await cleanupRuntime();
  const cases = BENCH_CASES.filter((c) => c.e2eMock).slice(0, 6);
  const rows: MatrixRow[] = [];

  for (const c of cases) {
    const fixtureDir = path.join(repoRoot, "fixtures", c.fixture);
    await ensureGitRepo(fixtureDir);
    const beforeHash = await hashCheckout(fixtureDir);
    const notes: string[] = [];
    const row: MatrixRow = {
      id: c.id,
      reproducedBefore: null,
      expectedDetector: c.detector,
      sourceCandidatePresent: null,
      schemaValid: null,
      patchPolicyAccepted: null,
      worktreeOnly: null,
      originalUnchanged: null,
      targetFixed: null,
      regressionsPassed: null,
      noNewAxe: null,
      noNewConsole: null,
      reportGenerated: null,
      awaitingHumanReview: null,
      ok: false,
      notes,
    };

    try {
      const config = parseConfig({
        project: {
          name: c.fixture,
          repoPath: fixtureDir,
          baseRef: "HEAD",
        },
        commands: {
          install: 'node -e "process.exit(0)"',
          start: `npx --yes serve -l ${c.port} .`,
        },
        server: {
          readyUrl: `http://127.0.0.1:${c.port}`,
          timeoutMs: 60_000,
        },
        browser: { headless: true },
        setup: {
          locale: {
            strategy: c.fixture === "locale-overflow" ? "selector" : "none",
            selector:
              c.fixture === "locale-overflow"
                ? "[data-language-toggle]"
                : undefined,
          },
          theme: {
            strategy: c.fixture === "locale-overflow" ? "selector" : "none",
            selector:
              c.fixture === "locale-overflow"
                ? "[data-theme-toggle]"
                : undefined,
          },
        },
        states: {
          viewports: [
            { name: "desktop", width: 1440, height: 900 },
            { name: "tablet", width: 768, height: 1024 },
            { name: "mobile", width: 390, height: 844 },
          ],
          locales: c.fixture === "locale-overflow" ? ["en", "vi"] : ["en"],
          themes: ["dark"],
        },
        patchPolicy: {
          allowedGlobs: ["**/*.{css,html,js}"],
          deniedGlobs: [".env*", "**/node_modules/**", "**/.git/**"],
          maxFiles: 3,
          maxAddedLines: 120,
          maxDeletedLines: 120,
        },
        regressionMatrix: { includeAllConfiguredStates: true },
        worktree: { preserveOnFailure: true },
      });
      const issue = parseIssue(c.issue);
      const result = await runFullPipeline({
        config,
        issue,
        cwd: repoRoot,
        provider: "mock",
        headless: true,
        keepWorktree: true,
      });
      row.runId = result.runId;
      row.state = result.state;

      const runDir = path.join(
        defaultReproRoot(repoRoot),
        "runs",
        result.runId,
      );
      const readJson = async <T>(rel: string): Promise<T | null> => {
        try {
          return JSON.parse(
            await fs.readFile(path.join(runDir, rel), "utf8"),
          ) as T;
        } catch {
          return null;
        }
      };

      const reproduction = await readJson<{
        reproduced?: boolean;
      }>("reproduction.json");
      const evidence = await readJson<{
        sourceCandidates?: unknown[];
        detectors?: Record<string, unknown[]>;
      }>("evidence.json");
      const diagnosis = await readJson<{
        patch?: { unifiedDiff?: string | null };
        abstainReason?: string | null;
      }>("diagnosis.json");
      const patchValidation = await readJson<{
        accepted?: boolean;
      }>("patch-validation.json");
      const verification = await readJson<{
        target?: { verdict?: string };
        regressions?: Array<{ passed?: boolean }>;
        axeComparison?: { newViolationIds?: string[] };
        consoleComparison?: { newErrors?: string[] };
        originalCheckoutUnchanged?: boolean;
        overall?: string;
      }>("verification.json");
      const run = await readJson<{
        worktreePath?: string | null;
        originalCheckoutHash?: string | null;
        state?: string;
      }>("run.json");

      row.reproducedBefore = Boolean(reproduction?.reproduced);
      row.sourceCandidatePresent = Boolean(
        evidence?.sourceCandidates && evidence.sourceCandidates.length > 0,
      );
      row.schemaValid = diagnosis != null;
      row.patchPolicyAccepted = Boolean(patchValidation?.accepted);
      row.worktreeOnly = Boolean(
        run?.worktreePath &&
          String(run.worktreePath).includes(".reprosight") &&
          String(run.worktreePath).includes("worktrees"),
      );
      const afterHash = await hashCheckout(fixtureDir);
      row.originalUnchanged =
        afterHash === beforeHash &&
        verification?.originalCheckoutUnchanged !== false;
      row.targetFixed = verification?.target?.verdict === "Fixed";
      row.regressionsPassed =
        Array.isArray(verification?.regressions) &&
        verification!.regressions!.every((r) => r.passed);
      row.noNewAxe = (verification?.axeComparison?.newViolationIds ?? [])
        .length === 0;
      row.noNewConsole =
        (verification?.consoleComparison?.newErrors ?? []).length === 0;
      try {
        await fs.access(path.join(runDir, "report", "index.html"));
        row.reportGenerated = true;
      } catch {
        row.reportGenerated = false;
      }
      row.awaitingHumanReview =
        result.state === "AWAITING_HUMAN_REVIEW" ||
        run?.state === "AWAITING_HUMAN_REVIEW";

      row.ok = Boolean(
        row.reproducedBefore &&
          row.sourceCandidatePresent &&
          row.schemaValid &&
          row.patchPolicyAccepted &&
          row.worktreeOnly &&
          row.originalUnchanged &&
          row.targetFixed &&
          row.regressionsPassed &&
          row.noNewAxe &&
          row.noNewConsole &&
          row.reportGenerated &&
          row.awaitingHumanReview,
      );
      if (!row.ok) {
        notes.push(`state=${result.state}`);
      }
      console.log(
        `${c.id}: ok=${row.ok} state=${result.state} originalUnchanged=${row.originalUnchanged}`,
      );
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err));
      row.ok = false;
      console.error(c.id, err);
    }
    rows.push(row);
  }

  const summary = {
    label:
      "Orchestration and verification success with deterministic mock provider",
    notClaimed: "Not real-model repair accuracy",
    total: rows.length,
    passed: rows.filter((r) => r.ok).length,
    rows,
  };
  const outDir = path.join(repoRoot, "artifacts", "benchmark");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "mock-orchestration-matrix.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
