import path from "node:path";
import fs from "node:fs/promises";
import {
  parseConfig,
  parseIssue,
  launchSession,
  navigateAndPrepare,
  runDetectors,
  evaluateAssertions,
  localizeSources,
  applyPatchInWorktree,
  createLinkedWorktree,
  removeWorktree,
  hashCheckout,
  assertCleanGitRepo,
  startTargetProcess,
  annotateScreenshot,
} from "@reprosight/core";
import {
  repoRoot,
  startFixtureServer,
  staticServeCommand,
} from "./fixture-server.js";
import { execa } from "execa";

type AnswerKey = {
  id: string;
  fixture: string;
  port: number;
  cssFile: string;
  expectedDetector: string;
  expectedFile: string;
  acceptableSelectors: string[];
  expectedProperties: string[];
  referencePatch: string;
  issue: unknown;
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
  // normalize css to lf
  for (const name of await fs.readdir(dir)) {
    if (name.endsWith(".css") || name.endsWith(".html") || name.endsWith(".js")) {
      const p = path.join(dir, name);
      const t = await fs.readFile(p);
      await fs.writeFile(
        p,
        t.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
      );
    }
  }
  await execa("git", ["add", "-A"], { cwd: dir });
  const st = await execa("git", ["status", "--porcelain"], { cwd: dir });
  if (st.stdout.trim()) {
    await execa("git", ["commit", "-m", "holdout baseline"], {
      cwd: dir,
      reject: false,
    });
  }
}

function detectorHit(
  expected: string,
  evidence: Awaited<ReturnType<typeof runDetectors>>["evidence"],
): boolean {
  switch (expected) {
    case "horizontalOverflow":
      return (
        evidence.documentMetrics.scrollWidth -
          evidence.documentMetrics.clientWidth >
          1 || evidence.horizontalOverflow.length > 0
      );
    case "overlap":
      return evidence.overlap.length > 0;
    case "textClipping":
      return evidence.textClipping.length > 0;
    case "stickyOcclusion":
      return evidence.stickyOcclusion.length > 0;
    case "accessibility":
      return evidence.accessibility.violations.length > 0;
    default:
      return false;
  }
}

async function main() {
  const keysDir = path.join(repoRoot, "evaluation", "holdout", "answer-keys");
  const files = (await fs.readdir(keysDir)).filter((f) => f.endsWith(".json"));
  const results: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const key = JSON.parse(
      await fs.readFile(path.join(keysDir, file), "utf8"),
    ) as AnswerKey;
    const fixtureDir = path.join(repoRoot, "fixtures", key.fixture);
    const notes: string[] = [];
    const row: Record<string, unknown> = {
      id: key.id,
      ok: false,
      notes,
    };

    try {
      await ensureGit(fixtureDir);
      await assertCleanGitRepo(fixtureDir);
      const beforeHash = await hashCheckout(fixtureDir);

      const server = await startFixtureServer({
        fixture: key.fixture,
        port: key.port,
      });
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
            timeoutMs: 30_000,
          },
          browser: { headless: true },
          detectors: {
            horizontalOverflow: true,
            overlap: true,
            textClipping: true,
            stickyOcclusion: true,
            accessibility: true,
          },
        });
        const issue = parseIssue(key.issue);
        const session = await launchSession({ config, issue, headless: true });
        try {
          await navigateAndPrepare({ page: session.page, config, issue });
          const { evidence } = await runDetectors(session.page, config, issue);
          const assertion = evaluateAssertions(issue, evidence);
          row.reproduced = !assertion.passed;
          row.expectedDetectorHit = detectorHit(
            key.expectedDetector,
            evidence,
          );
          const shot = await session.page.screenshot({ type: "png" });
          annotateScreenshot(shot, {
            overflow: evidence.horizontalOverflow,
            overlap: evidence.overlap,
            clipping: evidence.textClipping,
            sticky: evidence.stickyOcclusion,
          });
          row.annotatedEvidence = true;

          const candidates = await localizeSources(session.page, {
            repoPath: fixtureDir,
            readyUrl: server.url,
            defectHints: [
              {
                selector: key.acceptableSelectors[0] ?? "body",
                properties: key.expectedProperties,
                reason: "holdout validation",
              },
              ...evidence.horizontalOverflow.map((f) => ({
                selector: f.selector,
                properties: key.expectedProperties,
                reason: "overflow",
              })),
              ...evidence.overlap.flatMap((f) => [
                {
                  selector: f.selectorA,
                  properties: key.expectedProperties,
                  reason: "overlap",
                },
                {
                  selector: f.selectorB,
                  properties: key.expectedProperties,
                  reason: "overlap",
                },
              ]),
              ...evidence.textClipping.map((f) => ({
                selector: f.selector,
                properties: key.expectedProperties,
                reason: "clip",
              })),
              ...evidence.stickyOcclusion.map((f) => ({
                selector: f.targetSelector,
                properties: key.expectedProperties,
                reason: "sticky",
              })),
            ],
          });
          row.sourceCandidateResolved = candidates.some((c) => !!c.file);
          row.answerKeyFileExists = await fs
            .access(path.join(fixtureDir, key.expectedFile))
            .then(() => true)
            .catch(() => false);
        } finally {
          await session.close();
        }
      } finally {
        await server.stop();
      }

      // reference patch validation (not counted as model success)
      const reproRoot = path.join(repoRoot, ".reprosight");
      const runId = `holdout-ref-${key.id}`;
      const { worktreePath } = await createLinkedWorktree({
        repoPath: fixtureDir,
        runId,
        baseRef: "HEAD",
        reproRoot,
      });
      try {
        const check = await applyPatchInWorktree({
          worktreePath,
          unifiedDiff: key.referencePatch,
          checkOnly: true,
        });
        row.referencePatchApplies = check.ok;
        if (!check.ok) {
          notes.push(`ref patch check failed: ${check.output}`);
        } else {
          const applied = await applyPatchInWorktree({
            worktreePath,
            unifiedDiff: key.referencePatch,
          });
          row.referencePatchApplied = applied.ok;
          if (!applied.ok) notes.push(`ref apply failed: ${applied.output}`);
          else {
            const cfg = parseConfig({
              project: {
                name: key.fixture,
                repoPath: worktreePath,
                baseRef: "HEAD",
              },
              commands: {
                install: 'node -e "process.exit(0)"',
                start: staticServeCommand(key.port + 100),
              },
              server: {
                readyUrl: `http://127.0.0.1:${key.port + 100}`,
                timeoutMs: 30_000,
              },
              browser: { headless: true },
            });
            const issue = parseIssue(key.issue);
            const target = await startTargetProcess({
              config: cfg,
              cwd: worktreePath,
              install: false,
            });
            try {
              const session = await launchSession({
                config: cfg,
                issue,
                headless: true,
              });
              try {
                await navigateAndPrepare({
                  page: session.page,
                  config: cfg,
                  issue,
                });
                const { evidence } = await runDetectors(
                  session.page,
                  cfg,
                  issue,
                );
                const assertion = evaluateAssertions(issue, evidence);
                row.referenceFixesTarget = assertion.passed;
                if (!assertion.passed) {
                  notes.push(`ref still failing: ${assertion.failures.join("; ")}`);
                }
              } finally {
                await session.close();
              }
            } finally {
              await target.stop();
            }
          }
        }
      } finally {
        await removeWorktree({
          repoPath: fixtureDir,
          worktreePath,
          force: true,
        });
      }

      const afterHash = await hashCheckout(fixtureDir);
      row.originalUnchanged = afterHash === beforeHash;
      row.ok = Boolean(
        row.reproduced &&
          row.expectedDetectorHit &&
          row.annotatedEvidence &&
          row.sourceCandidateResolved &&
          row.answerKeyFileExists &&
          row.referencePatchApplies &&
          row.referencePatchApplied &&
          row.referenceFixesTarget &&
          row.originalUnchanged,
      );
      console.log(
        `${key.id}: ok=${row.ok} reproduced=${row.reproduced} detector=${row.expectedDetectorHit} refFix=${row.referenceFixesTarget} unchanged=${row.originalUnchanged}`,
      );
    } catch (err) {
      notes.push(err instanceof Error ? err.message : String(err));
      row.ok = false;
      console.error(key.id, err);
    }
    results.push(row);
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    results,
    note: "Deterministic holdout validation of cases/reference patches — not model success.",
  };
  const out = path.join(
    repoRoot,
    "artifacts",
    "evaluation",
    "holdout-validation.json",
  );
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
