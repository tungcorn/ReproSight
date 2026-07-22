import path from "node:path";
import fs from "node:fs/promises";
import {
  parseConfig,
  parseIssue,
  runFullPipeline,
  defaultReproRoot,
  hashCheckout,
} from "@reprosight/core";
import { BENCH_CASES } from "./cases.js";
import { repoRoot, staticServeCommand } from "./fixture-server.js";
import { execa } from "execa";

/**
 * Real OpenAI-compatible provider evaluation.
 * Reads credentials only from environment variables. Never prints secrets.
 *
 * Required:
 *   OPENAI_API_KEY (or REPROSIGHT_API_KEY_ENV override)
 * Optional:
 *   REPROSIGHT_MODEL_BASE_URL
 *   REPROSIGHT_MODEL_NAME
 *   REPROSIGHT_API_KEY_ENV
 */

type RealCaseResult = {
  id: string;
  reproduced: boolean | null;
  schemaValid: boolean | null;
  abstained: boolean | null;
  rootCauseFileTop1: boolean | null;
  rootCauseFileTop3: boolean | null;
  patchReturned: boolean | null;
  patchAccepted: boolean | null;
  patchApplied: boolean | null;
  targetFixed: boolean | null;
  regressionsPassed: boolean | null;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  runtimeMs: number | null;
  state: string | null;
  infrastructureRetry: boolean;
  error: string | null;
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

async function main() {
  const apiKeyEnv = process.env.REPROSIGHT_API_KEY_ENV ?? "OPENAI_API_KEY";
  const hasKey = Boolean(process.env[apiKeyEnv]);
  const baseUrl =
    process.env.REPROSIGHT_MODEL_BASE_URL ?? "https://api.openai.com/v1";
  const modelName = process.env.REPROSIGHT_MODEL_NAME ?? "gpt-4o-mini";

  const outDir = path.join(repoRoot, "artifacts", "evaluation");
  await fs.mkdir(outDir, { recursive: true });

  if (!hasKey) {
    const blocked = {
      status: "blocked",
      reason: `Missing API key environment variable ${apiKeyEnv} (value not logged).`,
      command: [
        `set ${apiKeyEnv}=***`,
        "set REPROSIGHT_MODEL_BASE_URL=https://api.openai.com/v1",
        "set REPROSIGHT_MODEL_NAME=gpt-4o-mini",
        "npm run evaluation:real-provider",
      ],
      model: modelName,
      baseUrl,
      note: "Do not fabricate real-provider results. Mock orchestration is separate.",
    };
    await fs.writeFile(
      path.join(outDir, "real-provider.json"),
      `${JSON.stringify(blocked, null, 2)}\n`,
    );
    console.log(JSON.stringify(blocked, null, 2));
    // Exit 0 so CI without keys is not red; gate is reported as blocked.
    return;
  }

  const cases = BENCH_CASES.filter((c) =>
    [
      "container-stretch",
      "locale-overflow-vi-768",
      "overlap-cta-badge",
      "clipping-vi-paragraph",
      "sticky-heading-occlusion",
      "grid-mincontent-overflow",
    ].includes(c.id),
  );

  const results: RealCaseResult[] = [];
  for (const c of cases) {
    const fixtureDir = path.join(repoRoot, "fixtures", c.fixture);
    await ensureGitRepo(fixtureDir);
    const beforeHash = await hashCheckout(fixtureDir);
    const started = Date.now();
    const row: RealCaseResult = {
      id: c.id,
      reproduced: null,
      schemaValid: null,
      abstained: null,
      rootCauseFileTop1: null,
      rootCauseFileTop3: null,
      patchReturned: null,
      patchAccepted: null,
      patchApplied: null,
      targetFixed: null,
      regressionsPassed: null,
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd: null,
      runtimeMs: null,
      state: null,
      infrastructureRetry: false,
      error: null,
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
          start: staticServeCommand(c.port),
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
        patchPolicy: {
          allowedGlobs: ["**/*.{css,html,js}"],
          deniedGlobs: [".env*", "**/node_modules/**", "**/.git/**"],
          maxFiles: 3,
          maxAddedLines: 120,
          maxDeletedLines: 120,
        },
        regressionMatrix: { includeAllConfiguredStates: true },
      });
      const issue = parseIssue(c.issue);
      // No silent model retry: one attempt per case.
      const result = await runFullPipeline({
        config,
        issue,
        cwd: repoRoot,
        provider: "openai-compatible",
        headless: true,
        keepWorktree: true,
        modelBaseUrl: baseUrl,
        modelName,
        apiKeyEnvVar: apiKeyEnv,
      });
      row.state = result.state;
      row.runtimeMs = Date.now() - started;

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
      const reproduction = await readJson<{ reproduced?: boolean }>(
        "reproduction.json",
      );
      const diagnosis = await readJson<{
        abstainReason?: string | null;
        patch?: { unifiedDiff?: string | null };
        rootCause?: {
          sourceCandidates?: Array<{ file?: string }>;
        };
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          estimatedCostUsd?: number;
        };
      }>("diagnosis.json");
      const evidence = await readJson<{
        sourceCandidates?: Array<{ file?: string | null; rank?: number }>;
      }>("evidence.json");
      const patchValidation = await readJson<{ accepted?: boolean }>(
        "patch-validation.json",
      );
      const verification = await readJson<{
        target?: { verdict?: string };
        regressions?: Array<{ passed?: boolean }>;
      }>("verification.json");

      row.reproduced = Boolean(reproduction?.reproduced);
      row.schemaValid = diagnosis != null;
      row.abstained = Boolean(
        diagnosis?.abstainReason || !diagnosis?.patch?.unifiedDiff,
      );
      row.patchReturned = Boolean(diagnosis?.patch?.unifiedDiff);
      row.patchAccepted = Boolean(patchValidation?.accepted);
      row.patchApplied =
        result.state === "AWAITING_HUMAN_REVIEW" ||
        result.state === "TARGET_FAILED" ||
        result.state === "REGRESSION_INTRODUCED" ||
        result.state === "VERIFIED" ||
        result.state === "TARGET_FIXED" ||
        result.state === "WORKTREE_READY" ||
        result.state === "VERIFYING_TARGET" ||
        result.state === "VERIFYING_REGRESSIONS";
      // More precise: presence of worktree after validate
      const run = await readJson<{ worktreePath?: string | null }>("run.json");
      row.patchApplied = Boolean(run?.worktreePath);
      row.targetFixed = verification?.target?.verdict === "Fixed";
      row.regressionsPassed = Array.isArray(verification?.regressions)
        ? verification!.regressions!.every((r) => r.passed)
        : null;
      row.promptTokens = diagnosis?.usage?.promptTokens ?? null;
      row.completionTokens = diagnosis?.usage?.completionTokens ?? null;
      row.estimatedCostUsd = diagnosis?.usage?.estimatedCostUsd ?? null;

      const expectedFile = c.localization?.sourceFile;
      const ranked = evidence?.sourceCandidates ?? [];
      row.rootCauseFileTop1 = expectedFile
        ? ranked[0]?.file === expectedFile ||
          (ranked[0]?.file?.endsWith(expectedFile) ?? false)
        : null;
      row.rootCauseFileTop3 = expectedFile
        ? ranked
            .slice(0, 3)
            .some(
              (cnd) =>
                cnd.file === expectedFile ||
                (cnd.file?.endsWith(expectedFile) ?? false),
            )
        : null;

      const afterHash = await hashCheckout(fixtureDir);
      if (afterHash !== beforeHash) {
        row.error = "Original checkout hash changed";
      }
      console.log(
        `${c.id}: state=${result.state} fixed=${row.targetFixed} abstained=${row.abstained}`,
      );
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
      // Strip any accidental key-looking substrings
      row.error = row.error.replace(
        /Bearer\s+[A-Za-z0-9._-]+/g,
        "Bearer [REDACTED]",
      );
      row.runtimeMs = Date.now() - started;
      console.error(`${c.id}: error (redacted message printed)`);
      console.error(row.error);
    }
    results.push(row);
  }

  const summary = {
    status: "completed",
    label: "Real-provider repair evaluation",
    model: modelName,
    baseUrl,
    apiKeyEnvVar: apiKeyEnv,
    total: results.length,
    targetFixed: results.filter((r) => r.targetFixed).length,
    abstained: results.filter((r) => r.abstained).length,
    schemaValid: results.filter((r) => r.schemaValid).length,
    patchAccepted: results.filter((r) => r.patchAccepted).length,
    results,
    note: "Failures are published. No silent model retries. Separate from mock orchestration metrics.",
  };
  await fs.writeFile(
    path.join(outDir, "real-provider.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        total: summary.total,
        targetFixed: summary.targetFixed,
        abstained: summary.abstained,
        patchAccepted: summary.patchAccepted,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
