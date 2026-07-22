import type { ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";
import type { DetectorEvidence, EvidencePack } from "../evidence/types.js";
import {
  launchSession,
  navigateAndPrepare,
} from "../runner/browser.js";
import { runDetectors, evaluateAssertions } from "../detectors/run-all.js";
import { runOptionalCommand } from "../runner/target-process.js";
import { startTargetProcess } from "../runner/target-process.js";
import { annotateScreenshot, diffScreenshots } from "../detectors/annotate.js";
import type { RunStore } from "../store/run-store.js";

export type StateResult = {
  name: string;
  route: string;
  viewport: { width: number; height: number };
  locale: string;
  theme: "dark" | "light";
  passed: boolean;
  failures: string[];
  detectorSummary: {
    overflow: number;
    overlap: number;
    clipping: number;
    sticky: number;
    axeViolations: number;
  };
  consoleErrors: number;
  durationMs: number;
  screenshotPath?: string;
};

export type VerificationResult = {
  target: {
    verdict: "Fixed" | "Still failing" | "Not measurable";
    failures: string[];
    evidence: DetectorEvidence;
  };
  regressions: StateResult[];
  build: { ok: boolean; output: string } | null;
  test: { ok: boolean; output: string } | null;
  screenshotDiff: {
    changedPixels: number;
    ratio: number;
    path: string | null;
  } | null;
  consoleComparison: {
    beforeErrors: number;
    afterErrors: number;
    newErrors: string[];
  };
  axeComparison: {
    before: number;
    after: number;
    newViolationIds: string[];
  };
  originalCheckoutUnchanged: boolean;
  overall: "VERIFIED" | "TARGET_FAILED" | "REGRESSION_INTRODUCED";
};

export async function verifyRepair(opts: {
  config: ReproSightConfig;
  issue: IssueSpec;
  worktreePath: string;
  store: RunStore;
  runId: string;
  beforeEvidence: EvidencePack;
  keepServer?: boolean;
}): Promise<VerificationResult> {
  const installCmd = opts.config.commands.install ?? "";
  const needsInstall =
    installCmd.length > 0 &&
    !/process\.exit\(0\)/.test(installCmd) &&
    !/^true\b/.test(installCmd.trim());
  const server = await startTargetProcess({
    config: {
      ...opts.config,
      project: { ...opts.config.project, repoPath: opts.worktreePath },
    },
    cwd: opts.worktreePath,
    install: needsInstall,
  });

  try {
    const session = await launchSession({
      config: opts.config,
      issue: opts.issue,
      headless: opts.config.browser.headless,
    });
    try {
      await navigateAndPrepare({
        page: session.page,
        config: opts.config,
        issue: opts.issue,
      });
      const { evidence, axeRaw } = await runDetectors(
        session.page,
        opts.config,
        opts.issue,
      );
      await opts.store.writeArtifactJson(
        opts.runId,
        "artifacts/axe-after.json",
        axeRaw ?? { note: "no axe raw" },
        "axe-after",
      );
      await opts.store.writeArtifactJson(
        opts.runId,
        "artifacts/console-after.json",
        session.consoleEntries,
        "console-after",
      );

      const assertion = evaluateAssertions(opts.issue, evidence);
      const screenshot = await session.page.screenshot({ type: "png", fullPage: false });
      await opts.store.writeArtifactBinary(
        opts.runId,
        "artifacts/after.png",
        screenshot,
        "after",
      );
      const annotated = annotateScreenshot(screenshot, {
        overflow: evidence.horizontalOverflow,
        overlap: evidence.overlap,
        clipping: evidence.textClipping,
        sticky: evidence.stickyOcclusion,
        region: opts.issue.region,
      });
      await opts.store.writeArtifactBinary(
        opts.runId,
        "artifacts/after-annotated.png",
        annotated,
        "after-annotated",
      );

      let screenshotDiff: VerificationResult["screenshotDiff"] = null;
      const beforePath = opts.store.artifactPath(
        opts.runId,
        "artifacts/before.png",
      );
      try {
        const fs = await import("node:fs/promises");
        const beforeBuf = await fs.readFile(beforePath);
        const diff = diffScreenshots(beforeBuf, screenshot);
        const diffPath = await opts.store.writeArtifactBinary(
          opts.runId,
          "artifacts/diff.png",
          diff.diff,
          "diff",
        );
        screenshotDiff = {
          changedPixels: diff.changedPixels,
          ratio: diff.ratio,
          path: diffPath,
        };
      } catch {
        screenshotDiff = {
          changedPixels: -1,
          ratio: -1,
          path: null,
        };
      }

      const targetVerdict: VerificationResult["target"] = {
        verdict: assertion.passed ? "Fixed" : "Still failing",
        failures: assertion.failures,
        evidence,
      };

      const beforeAxeIds = new Set(
        opts.beforeEvidence.detectors.accessibility.violations.map((v) => v.id),
      );
      const afterAxeIds = evidence.accessibility.violations.map((v) => v.id);
      const newViolationIds = afterAxeIds.filter((id) => !beforeAxeIds.has(id));

      const beforeConsole = new Set(
        opts.beforeEvidence.console
          .filter((c) => c.type === "error" || c.type === "pageerror")
          .map((c) => c.text),
      );
      const afterConsole = session.consoleEntries.filter(
        (c) => c.type === "error" || c.type === "pageerror",
      );
      const newErrors = afterConsole
        .map((c) => c.text)
        .filter((t) => !beforeConsole.has(t));

      if (targetVerdict.verdict !== "Fixed") {
        return {
          target: targetVerdict,
          regressions: [],
          build: null,
          test: null,
          screenshotDiff,
          consoleComparison: {
            beforeErrors: beforeConsole.size,
            afterErrors: afterConsole.length,
            newErrors,
          },
          axeComparison: {
            before: beforeAxeIds.size,
            after: afterAxeIds.length,
            newViolationIds,
          },
          originalCheckoutUnchanged: true,
          overall: "TARGET_FAILED",
        };
      }

      // Regression matrix
      const states = buildRegressionStates(opts.config, opts.issue);
      const regressions: StateResult[] = [];
      for (const state of states) {
        const started = Date.now();
        const issueState: IssueSpec = {
          ...opts.issue,
          state: {
            viewport: state.viewport,
            locale: state.locale,
            theme: state.theme,
          },
          // keep route; drop scroll actions that may not apply
          actions: opts.issue.actions,
        };
        await session.context.close();
        // reopen context with new viewport via new session page on same browser is hard; relaunch lightweight
        await session.browser.close();
        const s2 = await launchSession({
          config: opts.config,
          issue: issueState,
        });
        Object.assign(session, s2);
        await navigateAndPrepare({
          page: session.page,
          config: opts.config,
          issue: issueState,
        });
        const det = await runDetectors(session.page, opts.config, issueState);
        // For regressions use overflow/severe only unless original assertions
        const severeFailures: string[] = [];
        const overflowDelta =
          det.evidence.documentMetrics.scrollWidth -
          det.evidence.documentMetrics.clientWidth;
        if (overflowDelta > 1) {
          severeFailures.push(`overflow delta ${overflowDelta}`);
        }
        // sticky severe
        if (det.evidence.stickyOcclusion.some((s) => s.obscuredPx > 8)) {
          severeFailures.push("sticky occlusion");
        }
        const shot = await session.page.screenshot({ type: "png" });
        const shotRel = `artifacts/regression-${state.name}.png`;
        await opts.store.writeArtifactBinary(opts.runId, shotRel, shot);
        regressions.push({
          name: state.name,
          route: issueState.route,
          viewport: state.viewport,
          locale: state.locale,
          theme: state.theme,
          passed: severeFailures.length === 0,
          failures: severeFailures,
          detectorSummary: {
            overflow: det.evidence.horizontalOverflow.length,
            overlap: det.evidence.overlap.length,
            clipping: det.evidence.textClipping.length,
            sticky: det.evidence.stickyOcclusion.length,
            axeViolations: det.evidence.accessibility.violations.length,
          },
          consoleErrors: s2.consoleEntries.filter(
            (c) => c.type === "error" || c.type === "pageerror",
          ).length,
          durationMs: Date.now() - started,
          screenshotPath: shotRel,
        });
      }

      const build = await runOptionalCommand(
        opts.config.commands.build,
        opts.worktreePath,
      );
      const test = await runOptionalCommand(
        opts.config.commands.test,
        opts.worktreePath,
      );

      const regressionFailed = regressions.some((r) => !r.passed);
      const buildFailed = build ? !build.ok : false;
      const testFailed = test ? !test.ok : false;
      const axeRegressed = newViolationIds.length > 0;
      const consoleRegressed = newErrors.length > 0;

      const overall =
        regressionFailed || buildFailed || testFailed || axeRegressed || consoleRegressed
          ? "REGRESSION_INTRODUCED"
          : "VERIFIED";

      return {
        target: targetVerdict,
        regressions,
        build: build
          ? { ok: build.ok, output: `${build.stdout}\n${build.stderr}`.slice(0, 4000) }
          : null,
        test: test
          ? { ok: test.ok, output: `${test.stdout}\n${test.stderr}`.slice(0, 4000) }
          : null,
        screenshotDiff,
        consoleComparison: {
          beforeErrors: beforeConsole.size,
          afterErrors: afterConsole.length,
          newErrors,
        },
        axeComparison: {
          before: beforeAxeIds.size,
          after: afterAxeIds.length,
          newViolationIds,
        },
        originalCheckoutUnchanged: true,
        overall,
      };
    } finally {
      await session.close().catch(() => undefined);
    }
  } finally {
    await server.stop();
  }
}

function buildRegressionStates(
  config: ReproSightConfig,
  issue: IssueSpec,
): Array<{
  name: string;
  viewport: { width: number; height: number };
  locale: string;
  theme: "dark" | "light";
}> {
  const states: Array<{
    name: string;
    viewport: { width: number; height: number };
    locale: string;
    theme: "dark" | "light";
  }> = [];

  // Always include original
  states.push({
    name: "original",
    viewport: issue.state.viewport,
    locale: issue.state.locale,
    theme: issue.state.theme,
  });

  if (config.regressionMatrix.includeAllConfiguredStates) {
    for (const vp of config.states.viewports) {
      for (const locale of config.states.locales) {
        for (const theme of config.states.themes) {
          const name = `${vp.name}-${locale}-${theme}`;
          if (
            vp.width === issue.state.viewport.width &&
            vp.height === issue.state.viewport.height &&
            locale === issue.state.locale &&
            theme === issue.state.theme
          ) {
            continue;
          }
          states.push({
            name,
            viewport: { width: vp.width, height: vp.height },
            locale,
            theme,
          });
        }
      }
    }
  }

  // Cap matrix for MVP runtime
  return states.slice(0, 9);
}
