import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import {
  parseConfig,
  parseIssue,
  runFullPipeline,
  defaultReproRoot,
} from "@reprosight/core";
import { BENCH_CASES } from "./cases.js";
import { repoRoot } from "./fixture-server.js";

async function ensureGitRepo(dir: string): Promise<void> {
  const gitDir = path.join(dir, ".git");
  try {
    await fs.access(gitDir);
  } catch {
    await execa("git", ["init"], { cwd: dir });
  }
  await execa("git", ["config", "user.email", "bench@reprosight.local"], {
    cwd: dir,
  });
  await execa("git", ["config", "user.name", "ReproSight Bench"], { cwd: dir });
  // Keep fixture text as LF so mock unified diffs apply portably on Windows CI.
  await execa("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  await execa("git", ["config", "core.eol", "lf"], { cwd: dir });
  await fs.writeFile(
    path.join(dir, ".gitattributes"),
    "* text=auto eol=lf\n",
    "utf8",
  );
  // Always snapshot the current fixture files as HEAD so mock patches match
  // the on-disk MVP fixtures (do not revert uncommitted fixture edits).
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
  const e2eCases = BENCH_CASES.filter((c) => c.e2eMock).slice(0, 6);
  const results: Array<Record<string, unknown>> = [];

  for (const c of e2eCases) {
    const fixtureDir = path.join(repoRoot, "fixtures", c.fixture);
    await ensureGitRepo(fixtureDir);

    // unique port already in case; kill any leftovers best-effort later by pipeline stop
    const config = parseConfig({
      project: {
        name: c.fixture,
        repoPath: fixtureDir,
        baseRef: "HEAD",
      },
      commands: {
        install: "node -e \"process.exit(0)\"",
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
            c.fixture === "locale-overflow" ? "[data-theme-toggle]" : undefined,
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
    console.log(`\n=== E2E mock: ${c.id} ===`);
    try {
      const result = await runFullPipeline({
        config,
        issue,
        cwd: repoRoot,
        provider: "mock",
        headless: true,
        keepWorktree: true,
      });
      results.push({
        id: c.id,
        runId: result.runId,
        state: result.state,
        exitCode: result.exitCode,
        ok:
          result.state === "AWAITING_HUMAN_REVIEW" ||
          result.state === "ABSTAINED" ||
          result.state === "NOT_REPRODUCED" ||
          result.state === "EVIDENCE_READY",
      });
      console.log(result);
    } catch (err) {
      results.push({
        id: c.id,
        error: err instanceof Error ? err.message : String(err),
        ok: false,
      });
      console.error(err);
    }
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    results,
    reproRoot: defaultReproRoot(repoRoot),
    note: "Mock provider e2e. Failures are not hidden.",
  };
  const outDir = path.join(repoRoot, "artifacts", "benchmark");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "e2e-mock.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log("\n=== E2E mock summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.passed < 2) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
