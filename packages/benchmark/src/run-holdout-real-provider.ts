import path from "node:path";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  parseConfig,
  parseIssue,
  runFullPipeline,
  defaultReproRoot,
  hashCheckout,
  type DiagnosisOutput,
} from "@reprosight/core";
import { repoRoot, staticServeCommand } from "./fixture-server.js";
import { execa } from "execa";

/**
 * Official frozen holdout real-provider evaluation.
 * Answer keys are never sent to the model.
 */

type AnswerKey = {
  id: string;
  fixture: string;
  port: number;
  expectedDetector: string;
  expectedFile: string;
  acceptableSelectors: string[];
  expectedProperties: string[];
  abstentionAcceptable?: boolean;
  issue: unknown;
};

type ResultCategory =
  | "FULL_SUCCESS"
  | "LOCALIZED_BUT_NO_VALID_PATCH"
  | "VALID_PATCH_TARGET_FAILED"
  | "TARGET_FIXED_REGRESSION_INTRODUCED"
  | "APPROPRIATE_ABSTENTION"
  | "UNNECESSARY_ABSTENTION"
  | "WRONG_ROOT_CAUSE"
  | "PATCH_POLICY_REJECTED"
  | "MALFORMED_MODEL_RESPONSE"
  | "PROVIDER_FAILURE";

type CaseResult = {
  id: string;
  category: ResultCategory;
  reproducedBefore: boolean | null;
  schemaValid: boolean | null;
  abstained: boolean | null;
  abstentionAppropriate: boolean | null;
  expectedFileTop1: boolean | null;
  expectedFileTop3: boolean | null;
  expectedSelectorOrProperty: boolean | null;
  patchReturned: boolean | null;
  patchAccepted: boolean | null;
  patchApplied: boolean | null;
  targetFixed: boolean | null;
  regressionsPassed: boolean | null;
  newAxe: number | null;
  newConsole: number | null;
  originalUnchanged: boolean | null;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  providerLatencyMs: number | null;
  totalRuntimeMs: number | null;
  failureStage: string | null;
  failureExplanation: string | null;
  infrastructureRetries: number;
  state: string | null;
};

async function ensureGit(dir: string): Promise<void> {
  try {
    await fs.access(path.join(dir, ".git"));
  } catch {
    await execa("git", ["init"], { cwd: dir });
  }
  await execa("git", ["config", "user.email", "holdout@reprosight.local"], {
    cwd: dir,
  });
  await execa("git", ["config", "user.name", "ReproSight Holdout"], {
    cwd: dir,
  });
  await execa("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  await fs.writeFile(path.join(dir, ".gitattributes"), "* text=auto eol=lf\n");
  await execa("git", ["add", "-A"], { cwd: dir });
  const st = await execa("git", ["status", "--porcelain"], { cwd: dir });
  if (st.stdout.trim()) {
    await execa("git", ["commit", "-m", "holdout baseline"], {
      cwd: dir,
      reject: false,
    });
  }
}

function hostOnly(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function classify(opts: {
  key: AnswerKey;
  row: CaseResult;
}): ResultCategory {
  const { key, row } = opts;
  if (row.failureStage === "provider") return "PROVIDER_FAILURE";
  if (row.schemaValid === false) return "MALFORMED_MODEL_RESPONSE";
  if (row.abstained) {
    return key.abstentionAcceptable
      ? "APPROPRIATE_ABSTENTION"
      : "UNNECESSARY_ABSTENTION";
  }
  if (row.patchAccepted === false && row.patchReturned)
    return "PATCH_POLICY_REJECTED";
  if (
    row.expectedFileTop3 === false &&
    row.expectedSelectorOrProperty === false
  ) {
    return "WRONG_ROOT_CAUSE";
  }
  if (row.patchReturned && row.patchAccepted === false)
    return "PATCH_POLICY_REJECTED";
  if (row.patchReturned && !row.patchAccepted && !row.patchApplied) {
    return "LOCALIZED_BUT_NO_VALID_PATCH";
  }
  if (row.targetFixed && row.regressionsPassed === false)
    return "TARGET_FIXED_REGRESSION_INTRODUCED";
  if (row.patchApplied && row.targetFixed === false)
    return "VALID_PATCH_TARGET_FAILED";
  if (
    row.targetFixed &&
    row.regressionsPassed &&
    row.originalUnchanged &&
    row.patchAccepted
  ) {
    return "FULL_SUCCESS";
  }
  if (row.expectedFileTop3 && !row.patchReturned)
    return "LOCALIZED_BUT_NO_VALID_PATCH";
  return "VALID_PATCH_TARGET_FAILED";
}

async function main() {
  const apiKeyEnv = process.env.REPROSIGHT_API_KEY_ENV ?? "OPENAI_API_KEY";
  const keyPresent = Boolean(process.env[apiKeyEnv]);
  const baseUrl =
    process.env.REPROSIGHT_MODEL_BASE_URL ?? "https://api.openai.com/v1";
  const modelName = process.env.REPROSIGHT_MODEL_NAME ?? "gpt-4o-mini";
  const temperature = 0;
  const maxOutputTokens = 2048;
  const candidateLimit = 15;
  const promptVersion = "diagnosis-prompt-v1";

  console.log(`Provider configured: ${keyPresent ? "yes" : "no"}`);
  console.log(`Base URL host: ${hostOnly(baseUrl)}`);
  console.log(`Model name: ${modelName}`);
  console.log(`Key present: ${keyPresent ? "yes" : "no"}`);

  const gitCommit = (
    await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
  const evaluationId = `holdout-real-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const outDir = path.join(
    repoRoot,
    "artifacts",
    "evaluation",
    "holdout",
    evaluationId,
  );
  await fs.mkdir(outDir, { recursive: true });

  const keysDir = path.join(repoRoot, "evaluation", "holdout", "answer-keys");
  const keyFiles = (await fs.readdir(keysDir))
    .filter((f) => f.endsWith(".json"))
    .sort();
  const keys: AnswerKey[] = [];
  for (const f of keyFiles) {
    keys.push(
      JSON.parse(await fs.readFile(path.join(keysDir, f), "utf8")) as AnswerKey,
    );
  }

  const manifest = {
    evaluationId,
    date: new Date().toISOString(),
    gitCommit,
    providerType: "openai-compatible",
    modelName,
    baseUrlHost: hostOnly(baseUrl),
    temperature,
    maxOutputTokens,
    promptVersion,
    candidateLimit,
    cases: keys.map((k) => k.id),
    retryPolicy: {
      providerFailureRetries: 0,
      modelResultRetries: 0,
    },
    note: "Frozen official holdout evaluation. Answer keys are not model inputs.",
  };
  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (!keyPresent) {
    const blocked = {
      status: "blocked",
      evaluationId,
      reason: `Missing ${apiKeyEnv} (value not logged). Mock provider is not a substitute for this gate.`,
      command: [
        `set ${apiKeyEnv}=***`,
        `set REPROSIGHT_MODEL_BASE_URL=${baseUrl}`,
        `set REPROSIGHT_MODEL_NAME=${modelName}`,
        "npm run evaluation:holdout-real",
      ],
      manifest,
    };
    await fs.writeFile(
      path.join(outDir, "results.json"),
      `${JSON.stringify(blocked, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(repoRoot, "artifacts", "evaluation", "holdout-latest.json"),
      `${JSON.stringify(blocked, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(repoRoot, "artifacts", "evaluation", "holdout-latest.md"),
      `# Holdout real-provider evaluation — BLOCKED\n\nCredential missing for \`${apiKeyEnv}\`.\n\nDo not substitute mock results.\n\nCommand:\n\n\`\`\`bat\nset ${apiKeyEnv}=***\nset REPROSIGHT_MODEL_BASE_URL=${baseUrl}\nset REPROSIGHT_MODEL_NAME=${modelName}\nnpm run evaluation:holdout-real\n\`\`\`\n`,
    );
    console.log(JSON.stringify(blocked, null, 2));
    return;
  }

  const results: CaseResult[] = [];
  for (const key of keys) {
    const fixtureDir = path.join(repoRoot, "fixtures", key.fixture);
    await ensureGit(fixtureDir);
    const beforeHash = await hashCheckout(fixtureDir);
    const started = Date.now();
    const row: CaseResult = {
      id: key.id,
      category: "PROVIDER_FAILURE",
      reproducedBefore: null,
      schemaValid: null,
      abstained: null,
      abstentionAppropriate: null,
      expectedFileTop1: null,
      expectedFileTop3: null,
      expectedSelectorOrProperty: null,
      patchReturned: null,
      patchAccepted: null,
      patchApplied: null,
      targetFixed: null,
      regressionsPassed: null,
      newAxe: null,
      newConsole: null,
      originalUnchanged: null,
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd: null,
      providerLatencyMs: null,
      totalRuntimeMs: null,
      failureStage: null,
      failureExplanation: null,
      infrastructureRetries: 0,
      state: null,
    };

    try {
      const config = parseConfig({
        project: {
          name: key.fixture,
          repoPath: fixtureDir,
          baseRef: "HEAD",
        },
        commands: {
          install: 'node -e "process.exit(0)"',
          start: staticServeCommand(key.port),
        },
        server: {
          readyUrl: `http://127.0.0.1:${key.port}`,
          timeoutMs: 60_000,
        },
        browser: { headless: true },
        patchPolicy: {
          allowedGlobs: ["**/*.{css,html,js}"],
          deniedGlobs: [".env*", "**/node_modules/**", "**/.git/**"],
          maxFiles: 3,
          maxAddedLines: 120,
          maxDeletedLines: 120,
        },
        regressionMatrix: { includeAllConfiguredStates: true },
        states: {
          viewports: [
            { name: "desktop", width: 1440, height: 900 },
            { name: "tablet", width: 768, height: 1024 },
            { name: "mobile", width: 390, height: 844 },
          ],
          locales: ["en"],
          themes: ["dark"],
        },
      });
      // Issue only — no answer key fields
      const issue = parseIssue(key.issue);
      const providerStarted = Date.now();
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
      row.providerLatencyMs = Date.now() - providerStarted;
      row.totalRuntimeMs = Date.now() - started;
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

      const reproduction = await readJson<{ reproduced?: boolean }>(
        "reproduction.json",
      );
      const diagnosis = await readJson<
        DiagnosisOutput & {
          usage?: {
            promptTokens?: number;
            completionTokens?: number;
            estimatedCostUsd?: number;
          };
        }
      >("diagnosis.json");
      const evidence = await readJson<{
        sourceCandidates?: Array<{
          file?: string | null;
          selector?: string;
          property?: string;
          elementSelector?: string;
        }>;
      }>("evidence.json");
      const patchValidation = await readJson<{ accepted?: boolean }>(
        "patch-validation.json",
      );
      const verification = await readJson<{
        target?: { verdict?: string };
        regressions?: Array<{ passed?: boolean }>;
        axeComparison?: { newViolationIds?: string[] };
        consoleComparison?: { newErrors?: string[] };
        originalCheckoutUnchanged?: boolean;
      }>("verification.json");
      const run = await readJson<{ worktreePath?: string | null }>("run.json");

      row.reproducedBefore = Boolean(reproduction?.reproduced);
      row.schemaValid = diagnosis != null;
      row.abstained = Boolean(
        diagnosis?.abstainReason || !diagnosis?.patch?.unifiedDiff,
      );
      row.abstentionAppropriate = row.abstained
        ? Boolean(key.abstentionAcceptable)
        : null;
      row.patchReturned = Boolean(diagnosis?.patch?.unifiedDiff);
      row.patchAccepted = patchValidation
        ? Boolean(patchValidation.accepted)
        : null;
      row.patchApplied = Boolean(run?.worktreePath);
      row.targetFixed = verification?.target?.verdict === "Fixed";
      row.regressionsPassed = Array.isArray(verification?.regressions)
        ? verification!.regressions!.every((r) => r.passed)
        : null;
      row.newAxe = verification?.axeComparison?.newViolationIds?.length ?? null;
      row.newConsole =
        verification?.consoleComparison?.newErrors?.length ?? null;
      row.promptTokens = diagnosis?.usage?.promptTokens ?? null;
      row.completionTokens = diagnosis?.usage?.completionTokens ?? null;
      row.estimatedCostUsd = diagnosis?.usage?.estimatedCostUsd ?? null;

      const ranked = evidence?.sourceCandidates ?? [];
      row.expectedFileTop1 = ranked[0]
        ? ranked[0].file === key.expectedFile ||
          (ranked[0].file?.endsWith(key.expectedFile) ?? false)
        : false;
      row.expectedFileTop3 = ranked.slice(0, 3).some(
        (c) =>
          c.file === key.expectedFile ||
          (c.file?.endsWith(key.expectedFile) ?? false),
      );
      row.expectedSelectorOrProperty = ranked.slice(0, 5).some((c) => {
        const selHit = key.acceptableSelectors.some(
          (s) =>
            (c.selector ?? "").includes(s.replace(/^[#.]/, "")) ||
            (c.elementSelector ?? "").includes(s.replace(/^[#.]/, "")) ||
            (c.selector ?? "").includes(s) ||
            (c.elementSelector ?? "").includes(s),
        );
        const propHit = key.expectedProperties.includes(c.property ?? "");
        return selHit || propHit;
      });

      const afterHash = await hashCheckout(fixtureDir);
      row.originalUnchanged =
        afterHash === beforeHash &&
        verification?.originalCheckoutUnchanged !== false;

      if (!row.reproducedBefore) {
        row.failureStage = "reproduction";
        row.failureExplanation = "Holdout defect did not reproduce";
      } else if (row.schemaValid === false) {
        row.failureStage = "diagnosis";
        row.failureExplanation = "Missing/invalid diagnosis artifact";
      } else if (row.abstained) {
        row.failureStage = "diagnosis";
        row.failureExplanation = diagnosis?.abstainReason ?? "abstained";
      } else if (row.patchAccepted === false) {
        row.failureStage = "patch-policy";
        row.failureExplanation = "Patch rejected by policy";
      } else if (row.targetFixed === false) {
        row.failureStage = "verification";
        row.failureExplanation = "Target still failing after patch";
      } else if (row.regressionsPassed === false) {
        row.failureStage = "regression";
        row.failureExplanation = "Regressions introduced";
      }

      row.category = classify({ key, row });
      console.log(`${key.id}: ${row.category} state=${row.state}`);
    } catch (err) {
      row.totalRuntimeMs = Date.now() - started;
      row.failureStage = "provider";
      row.failureExplanation = (
        err instanceof Error ? err.message : String(err)
      ).replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
      row.category = "PROVIDER_FAILURE";
      console.error(`${key.id}: PROVIDER_FAILURE`);
    }
    results.push(row);
  }

  const fullSuccess = results.filter((r) => r.category === "FULL_SUCCESS");
  const nums = (xs: Array<number | null>) =>
    xs.filter((x): x is number => typeof x === "number");
  const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  const categoryCounts: Record<string, number> = {};
  for (const r of results) {
    categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1;
  }

  const summary = {
    status: "completed",
    evaluationId,
    gitCommit,
    modelName,
    baseUrlHost: hostOnly(baseUrl),
    total: results.length,
    fullRepairSuccessRate: fullSuccess.length / results.length,
    correctFileTop1:
      results.filter((r) => r.expectedFileTop1).length / results.length,
    correctFileTop3:
      results.filter((r) => r.expectedFileTop3).length / results.length,
    validPatchRate:
      results.filter((r) => r.patchAccepted).length / results.length,
    patchPolicyRejectionRate:
      results.filter((r) => r.category === "PATCH_POLICY_REJECTED").length /
      results.length,
    targetFixedRate:
      results.filter((r) => r.targetFixed).length / results.length,
    regressionFreeRate:
      results.filter((r) => r.regressionsPassed).length / results.length,
    appropriateAbstentionCount: results.filter(
      (r) => r.category === "APPROPRIATE_ABSTENTION",
    ).length,
    unnecessaryAbstentionCount: results.filter(
      (r) => r.category === "UNNECESSARY_ABSTENTION",
    ).length,
    manualInterventionRate: 0,
    medianInputTokens: median(nums(results.map((r) => r.promptTokens))),
    medianOutputTokens: median(nums(results.map((r) => r.completionTokens))),
    totalEstimatedCost: nums(results.map((r) => r.estimatedCostUsd)).reduce(
      (a, b) => a + b,
      0,
    ),
    medianProviderLatencyMs: median(
      nums(results.map((r) => r.providerLatencyMs)),
    ),
    medianEndToEndRuntimeMs: median(
      nums(results.map((r) => r.totalRuntimeMs)),
    ),
    categoryCounts,
    results,
    integrityHash: createHash("sha256")
      .update(JSON.stringify(results))
      .digest("hex"),
    note: "Small holdout set — not scientifically representative. Failures are not hidden. Manual intervention rate is 0 by protocol.",
  };

  await fs.writeFile(
    path.join(outDir, "results.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(repoRoot, "artifacts", "evaluation", "holdout-latest.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  const md = `# Holdout real-provider evaluation

- evaluationId: \`${evaluationId}\`
- model: \`${modelName}\`
- host: \`${hostOnly(baseUrl)}\`
- cases: ${summary.total}
- FULL_SUCCESS: ${fullSuccess.length}/${summary.total} (${(summary.fullRepairSuccessRate * 100).toFixed(1)}%)
- file top-1: ${(summary.correctFileTop1 * 100).toFixed(1)}%
- file top-3: ${(summary.correctFileTop3 * 100).toFixed(1)}%
- valid patch rate: ${(summary.validPatchRate * 100).toFixed(1)}%
- target fixed: ${(summary.targetFixedRate * 100).toFixed(1)}%
- regression-free: ${(summary.regressionFreeRate * 100).toFixed(1)}%
- appropriate abstention: ${summary.appropriateAbstentionCount}
- unnecessary abstention: ${summary.unnecessaryAbstentionCount}
- manual intervention rate: 0
- median input tokens: ${summary.medianInputTokens ?? "n/a"}
- median output tokens: ${summary.medianOutputTokens ?? "n/a"}
- total estimated cost: ${summary.totalEstimatedCost}
- median provider latency ms: ${summary.medianProviderLatencyMs ?? "n/a"}
- median e2e runtime ms: ${summary.medianEndToEndRuntimeMs ?? "n/a"}

## Category counts

${Object.entries(categoryCounts)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

## Per-case

| Case | Category | Top1 file | Top3 file | Patch accepted | Target fixed | Regressions |
| --- | --- | --- | --- | --- | --- | --- |
${results
  .map(
    (r) =>
      `| ${r.id} | ${r.category} | ${r.expectedFileTop1} | ${r.expectedFileTop3} | ${r.patchAccepted} | ${r.targetFixed} | ${r.regressionsPassed} |`,
  )
  .join("\n")}

This holdout is an MVP evaluation set, not a broad scientific benchmark.
`;
  await fs.writeFile(
    path.join(outDir, "results.md"),
    md,
  );
  await fs.writeFile(
    path.join(repoRoot, "artifacts", "evaluation", "holdout-latest.md"),
    md,
  );
  console.log(md);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
