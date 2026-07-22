import path from "node:path";
import type { ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";
import {
  RunStore,
  defaultReproRoot,
} from "../store/run-store.js";
import {
  launchSession,
  navigateAndPrepare,
  captureEnvironment,
} from "../runner/browser.js";
import { startTargetProcess } from "../runner/target-process.js";
import { runDetectors, evaluateAssertions } from "../detectors/run-all.js";
import { annotateScreenshot } from "../detectors/annotate.js";
import {
  localizeSources,
  readSourceSnippets,
} from "../source-locator/cdp.js";
import type { ModelClient } from "../diagnosis/types.js";
import { MockModelClient } from "../diagnosis/mock-client.js";
import { OpenAICompatibleModelClient } from "../diagnosis/openai-compatible.js";
import { validateUnifiedDiff } from "../patcher/policy.js";
import {
  assertCleanGitRepo,
  hashCheckout,
  createLinkedWorktree,
  applyPatchInWorktree,
  removeWorktree,
  verifyOriginalUnchanged,
} from "../patcher/worktree.js";
import { verifyRepair } from "../verifier/verify.js";
import { generateHtmlReport, reportPathForRun } from "../reporting/html-report.js";
import type { EvidencePack } from "../evidence/types.js";
import { readJsonFile } from "../store/fs.js";

export type ProviderName = "mock" | "openai-compatible";

export type PipelineOptions = {
  config: ReproSightConfig;
  issue: IssueSpec;
  cwd?: string;
  provider?: ProviderName;
  headless?: boolean;
  keepWorktree?: boolean;
  noPatch?: boolean;
  modelBaseUrl?: string;
  modelName?: string;
  apiKeyEnvVar?: string;
  runId?: string;
};

export type PipelineResult = {
  runId: string;
  state: string;
  exitCode: number;
};

export function createModelClient(
  provider: ProviderName,
  opts: PipelineOptions,
): ModelClient {
  if (provider === "mock") return new MockModelClient();
  return new OpenAICompatibleModelClient({
    baseUrl: opts.modelBaseUrl ?? process.env.REPROSIGHT_MODEL_BASE_URL ?? "https://api.openai.com/v1",
    model: opts.modelName ?? process.env.REPROSIGHT_MODEL_NAME ?? "gpt-4o-mini",
    apiKeyEnvVar: opts.apiKeyEnvVar ?? "OPENAI_API_KEY",
  });
}

export async function runFullPipeline(
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const cwd = opts.cwd ?? process.cwd();
  const reproRoot = defaultReproRoot(cwd);
  const store = new RunStore(reproRoot);
  const provider = opts.provider ?? "mock";
  const run = await store.createRun({
    issue: opts.issue,
    config: opts.config,
    provider,
    runId: opts.runId,
  });
  const runId = run.id;

  let target: Awaited<ReturnType<typeof startTargetProcess>> | null = null;
  let evidencePack: EvidencePack | null = null;

  try {
    await store.transition(runId, "PREPARING", "Starting target application");
    target = await startTargetProcess({
      config: opts.config,
      cwd: path.resolve(opts.config.project.repoPath),
      install: false,
    });

    await store.transition(runId, "REPRODUCING", "Launching browser and replaying scenario");
    const session = await launchSession({
      config: opts.config,
      issue: opts.issue,
      headless: opts.headless ?? opts.config.browser.headless,
    });

    try {
      await navigateAndPrepare({
        page: session.page,
        config: opts.config,
        issue: opts.issue,
      });
      const environment = await captureEnvironment(
        session.page,
        opts.config,
        opts.issue,
      );
      await store.writeArtifactJson(
        runId,
        "environment.json",
        environment,
        "environment",
      );

      const { evidence, axeRaw } = await runDetectors(
        session.page,
        opts.config,
        opts.issue,
      );
      await store.writeArtifactJson(
        runId,
        "artifacts/axe-before.json",
        axeRaw ?? { note: "axe disabled or empty" },
        "axe-before",
      );
      await store.writeArtifactJson(
        runId,
        "artifacts/console-before.json",
        session.consoleEntries,
        "console-before",
      );

      const assertion = evaluateAssertions(opts.issue, evidence);
      const screenshot = await session.page.screenshot({
        type: "png",
        fullPage: false,
      });
      await store.writeArtifactBinary(
        runId,
        "artifacts/before.png",
        screenshot,
        "before",
      );
      const annotated = annotateScreenshot(screenshot, {
        overflow: evidence.horizontalOverflow,
        overlap: evidence.overlap,
        clipping: evidence.textClipping,
        sticky: evidence.stickyOcclusion,
        region: opts.issue.region,
      });
      await store.writeArtifactBinary(
        runId,
        "artifacts/before-annotated.png",
        annotated,
        "before-annotated",
      );

      // tracing stop via new context tracing was optional; mark missing if absent
      await store.markMissing(runId, "trace-before", "trace capture optional in MVP path");

      const reproduction = {
        reproduced: !assertion.passed,
        assertion,
        route: opts.issue.route,
        state: opts.issue.state,
        actions: opts.issue.actions,
      };
      await store.writeArtifactJson(
        runId,
        "reproduction.json",
        reproduction,
        "reproduction",
      );

      if (assertion.passed) {
        await store.transition(
          runId,
          "NOT_REPRODUCED",
          "Assertions passed; defect not observed",
        );
        evidencePack = {
          environment,
          detectors: evidence,
          sourceCandidates: [],
          console: session.consoleEntries,
          failedRequests: session.failedRequests,
          screenshots: {
            before: "artifacts/before.png",
            beforeAnnotated: "artifacts/before-annotated.png",
          },
          traces: { before: null },
          notes: ["Not reproduced"],
        };
        await store.writeArtifactJson(
          runId,
          "evidence.json",
          evidencePack,
          "evidence",
        );
        await generateHtmlReport({
          run: await store.load(runId),
          issue: opts.issue,
          evidence: evidencePack,
          diagnosis: null,
          patchValidation: null,
          patchDiff: null,
          verification: null,
          outPath: reportPathForRun(store.runDir(runId)),
        });
        await store.markPresent(runId, "report");
        return { runId, state: "NOT_REPRODUCED", exitCode: 2 };
      }

      await store.transition(runId, "REPRODUCED", assertion.failures.join("; "));
      await store.transition(
        runId,
        "COLLECTING_EVIDENCE",
        "Collecting CDP source candidates",
      );

      const defectHints = [
        ...evidence.horizontalOverflow.map((f) => ({
          selector: f.selector,
          properties: ["max-width", "width", "min-width", "white-space", "grid-template-columns", "flex", "overflow-x"],
          reason: `Horizontal overflow ${f.overflowAmount.toFixed(1)}px`,
        })),
        ...evidence.textClipping.map((f) => ({
          selector: f.selector,
          properties: ["overflow", "height", "max-height", "white-space", "text-overflow"],
          reason: "Text clipping",
        })),
        ...evidence.overlap.flatMap((f) => [
          {
            selector: f.selectorA,
            properties: ["position", "z-index", "transform", "top", "left"],
            reason: "Overlap participant A",
          },
          {
            selector: f.selectorB,
            properties: ["position", "z-index", "transform", "top", "left"],
            reason: "Overlap participant B",
          },
        ]),
        ...evidence.stickyOcclusion.map((f) => ({
          selector: f.targetSelector,
          properties: ["scroll-margin-top", "top", "position"],
          reason: "Sticky occlusion target",
        })),
      ];

      // Prefer simple selectors for fixtures
      if (opts.issue.expected?.culpritSelector) {
        defectHints.unshift({
          selector: opts.issue.expected.culpritSelector,
          properties: opts.issue.expected.property
            ? [opts.issue.expected.property]
            : [],
          reason: "Issue expected culprit selector",
        });
      }

      const sourceCandidates = await localizeSources(session.page, {
        repoPath: path.resolve(opts.config.project.repoPath),
        readyUrl: opts.config.server.readyUrl,
        defectHints,
      });
      await store.writeArtifactJson(
        runId,
        "artifacts/source-candidates.json",
        sourceCandidates,
        "source-candidates",
      );

      evidencePack = {
        environment,
        detectors: evidence,
        sourceCandidates,
        console: session.consoleEntries,
        failedRequests: session.failedRequests,
        screenshots: {
          before: "artifacts/before.png",
          beforeAnnotated: "artifacts/before-annotated.png",
        },
        traces: { before: null },
        notes: [],
      };
      await store.writeArtifactJson(
        runId,
        "evidence.json",
        evidencePack,
        "evidence",
      );
      await store.transition(runId, "EVIDENCE_READY", "Evidence pack written");

      if (opts.noPatch) {
        await generateHtmlReport({
          run: await store.load(runId),
          issue: opts.issue,
          evidence: evidencePack,
          diagnosis: null,
          patchValidation: null,
          patchDiff: null,
          verification: null,
          outPath: reportPathForRun(store.runDir(runId)),
        });
        await store.markPresent(runId, "report");
        return { runId, state: "EVIDENCE_READY", exitCode: 0 };
      }

      await store.transition(runId, "DIAGNOSING", `Provider=${provider}`);
      const model = createModelClient(provider, opts);
      const snippets = await readSourceSnippets(
        path.resolve(opts.config.project.repoPath),
        sourceCandidates,
      );
      const diagnosisResult = await model.diagnoseAndProposePatch({
        issue: opts.issue,
        config: opts.config,
        evidence: evidencePack,
        sourceSnippets: snippets,
      });
      await store.writeArtifactJson(
        runId,
        "diagnosis.json",
        {
          ...diagnosisResult.output,
          usage: diagnosisResult.usage,
        },
        "diagnosis",
      );

      if (
        diagnosisResult.output.abstainReason ||
        !diagnosisResult.output.patch.unifiedDiff
      ) {
        await store.transition(
          runId,
          "ABSTAINED",
          diagnosisResult.output.abstainReason ?? "No patch proposed",
        );
        await generateHtmlReport({
          run: await store.load(runId),
          issue: opts.issue,
          evidence: evidencePack,
          diagnosis: diagnosisResult.output,
          patchValidation: null,
          patchDiff: null,
          verification: null,
          outPath: reportPathForRun(store.runDir(runId)),
        });
        await store.markPresent(runId, "report");
        return { runId, state: "ABSTAINED", exitCode: 3 };
      }

      await store.transition(runId, "PATCH_PROPOSED", "Model returned unified diff");
      await store.writeArtifactText(
        runId,
        "patch.diff",
        diagnosisResult.output.patch.unifiedDiff,
        "patch",
      );

      await store.transition(runId, "VALIDATING_PATCH", "Applying patch policy");
      const validation = validateUnifiedDiff(
        diagnosisResult.output.patch.unifiedDiff,
        opts.config.patchPolicy,
      );
      await store.writeArtifactJson(
        runId,
        "patch-validation.json",
        validation,
        "patch-validation",
      );

      if (!validation.accepted) {
        await store.transition(
          runId,
          "PATCH_REJECTED",
          validation.reasons.join("; "),
        );
        await generateHtmlReport({
          run: await store.load(runId),
          issue: opts.issue,
          evidence: evidencePack,
          diagnosis: diagnosisResult.output,
          patchValidation: validation,
          patchDiff: diagnosisResult.output.patch.unifiedDiff,
          verification: null,
          outPath: reportPathForRun(store.runDir(runId)),
        });
        await store.markPresent(runId, "report");
        return { runId, state: "PATCH_REJECTED", exitCode: 4 };
      }

      // Stop original server before worktree verify (port conflict)
      await target.stop();
      target = null;

      const repoPath = path.resolve(opts.config.project.repoPath);
      await assertCleanGitRepo(repoPath);
      const originalHash = await hashCheckout(repoPath);
      const rec = await store.load(runId);
      rec.originalCheckoutHash = originalHash;
      await store.save(rec);

      const { worktreePath } = await createLinkedWorktree({
        repoPath,
        runId,
        baseRef: opts.config.project.baseRef,
        reproRoot,
      });
      rec.worktreePath = worktreePath;
      await store.save(rec);

      const check = await applyPatchInWorktree({
        worktreePath,
        unifiedDiff: diagnosisResult.output.patch.unifiedDiff,
        checkOnly: true,
      });
      if (!check.ok) {
        await store.transition(
          runId,
          "PATCH_REJECTED",
          `git apply --check failed: ${check.output}`,
        );
        return { runId, state: "PATCH_REJECTED", exitCode: 4 };
      }

      const applied = await applyPatchInWorktree({
        worktreePath,
        unifiedDiff: diagnosisResult.output.patch.unifiedDiff,
      });
      if (!applied.ok) {
        await store.transition(
          runId,
          "PATCH_REJECTED",
          `git apply failed: ${applied.output}`,
        );
        return { runId, state: "PATCH_REJECTED", exitCode: 4 };
      }

      const integrity = await verifyOriginalUnchanged(repoPath, originalHash);
      if (!integrity.ok) {
        throw new Error("Original target checkout changed unexpectedly");
      }

      await store.transition(
        runId,
        "WORKTREE_READY",
        `Patch applied in ${worktreePath}`,
      );

      await store.transition(
        runId,
        "VERIFYING_TARGET",
        "Rerunning original failing scenario in worktree",
      );
      // Adjust ready URL host is same; worktree serves same port after start
      const verification = await verifyRepair({
        config: opts.config,
        issue: opts.issue,
        worktreePath,
        store,
        runId,
        beforeEvidence: evidencePack,
      });

      const integrity2 = await verifyOriginalUnchanged(repoPath, originalHash);
      verification.originalCheckoutUnchanged = integrity2.ok;

      await store.writeArtifactJson(
        runId,
        "verification.json",
        verification,
        "verification",
      );

      if (verification.overall === "TARGET_FAILED") {
        await store.transition(
          runId,
          "TARGET_FAILED",
          verification.target.failures.join("; "),
        );
      } else if (verification.overall === "REGRESSION_INTRODUCED") {
        await store.transition(runId, "TARGET_FIXED", "Target assertions pass");
        await store.transition(
          runId,
          "VERIFYING_REGRESSIONS",
          "Regression matrix executed",
        );
        await store.transition(
          runId,
          "REGRESSION_INTRODUCED",
          "Regressions or new errors detected",
        );
      } else {
        await store.transition(runId, "TARGET_FIXED", "Target assertions pass");
        await store.transition(
          runId,
          "VERIFYING_REGRESSIONS",
          "Regression matrix clean",
        );
        await store.transition(runId, "VERIFIED", "Target fixed; regressions clean");
        await store.transition(
          runId,
          "AWAITING_HUMAN_REVIEW",
          "Human approval required",
        );
      }

      await generateHtmlReport({
        run: await store.load(runId),
        issue: opts.issue,
        evidence: evidencePack,
        diagnosis: diagnosisResult.output,
        patchValidation: validation,
        patchDiff: diagnosisResult.output.patch.unifiedDiff,
        verification,
        outPath: reportPathForRun(store.runDir(runId)),
      });
      await store.markPresent(runId, "report");

      if (!opts.keepWorktree && !opts.config.worktree.preserveOnFailure) {
        // only auto-clean on full success if not keep
      }
      // default preserve for review

      const final = await store.load(runId);
      const exitCode =
        final.state === "AWAITING_HUMAN_REVIEW"
          ? 0
          : final.state === "TARGET_FAILED"
            ? 5
            : final.state === "REGRESSION_INTRODUCED"
              ? 6
              : 10;
      return { runId, state: final.state, exitCode };
    } finally {
      await session.close().catch(() => undefined);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rec = await store.load(runId).catch(() => null);
    if (rec) {
      rec.error = message;
      await store.save(rec);
    }
    throw err;
  } finally {
    if (target) await target.stop().catch(() => undefined);
  }
}

export async function loadIssueFile(issuePath: string): Promise<IssueSpec> {
  const { parseIssue } = await import("../scenario/issue.js");
  const raw = await readJsonFile<unknown>(path.resolve(issuePath));
  return parseIssue(raw);
}

export { removeWorktree, defaultReproRoot, RunStore };
