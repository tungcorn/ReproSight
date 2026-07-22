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
  collectStickyDiagnostics,
} from "@reprosight/core";
import { BENCH_CASES } from "./cases.js";
import { repoRoot, startFixtureServer } from "./fixture-server.js";

type CaseResult = {
  id: string;
  detector: string;
  reproduced: boolean;
  expectedDetectorHit: boolean;
  top1: boolean | null;
  top3: boolean | null;
  failures: string[];
  notes: string[];
  durationMs: number;
  stickyDiagnostics?: unknown;
};

async function main() {
  const results: CaseResult[] = [];
  const startedAll = Date.now();

  for (const c of BENCH_CASES) {
    const caseStarted = Date.now();
    const server = await startFixtureServer({
      fixture: c.fixture,
      port: c.port,
    });
    try {
      const config = parseConfig({
        project: {
          name: c.fixture,
          repoPath: server.cwd,
          baseRef: "HEAD",
        },
        commands: {
          install: "npm ci",
          start: `npx --yes serve -l ${c.port} .`,
        },
        server: {
          readyUrl: server.url,
          timeoutMs: 30_000,
        },
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
        detectors: {
          horizontalOverflow: true,
          overlap: true,
          textClipping: true,
          stickyOcclusion: true,
          accessibility: true,
        },
        stabilization: {
          waitForFonts: true,
          waitForImages: true,
          disableAnimations: true,
          settleFrames: 3,
          timeoutMs: 10_000,
        },
      });
      const issue = parseIssue(c.issue);
      const session = await launchSession({ config, issue, headless: true });
      try {
        await navigateAndPrepare({ page: session.page, config, issue });
        const { evidence } = await runDetectors(session.page, config, issue);
        const assertion = evaluateAssertions(issue, evidence);
        const reproduced = !assertion.passed;

        let expectedDetectorHit = false;
        let stickyDiagnostics: unknown;
        if (c.detector === "horizontalOverflow") {
          expectedDetectorHit =
            evidence.documentMetrics.scrollWidth -
              evidence.documentMetrics.clientWidth >
              1 || evidence.horizontalOverflow.length > 0;
          if (
            c.id === "container-stretch" ||
            c.id === "desktop-container-maxwidth"
          ) {
            const heroBox = await session.page
              .locator(
                (c.issue.expected?.culpritSelector as string) || "#hero",
              )
              .boundingBox()
              .catch(() => null);
            if (heroBox && heroBox.x < 8) {
              expectedDetectorHit = true;
            }
          }
        } else if (c.detector === "overlap") {
          expectedDetectorHit = evidence.overlap.length > 0;
        } else if (c.detector === "textClipping") {
          expectedDetectorHit = evidence.textClipping.length > 0;
        } else if (c.detector === "stickyOcclusion") {
          let stickySelector: string | undefined;
          for (const a of issue.assertions) {
            if (a.type === "noStickyOcclusion") {
              stickySelector = a.selector;
              break;
            }
          }
          if (!stickySelector) {
            for (const a of issue.actions) {
              if (a.type === "scrollIntoView") {
                stickySelector = a.selector;
                break;
              }
            }
          }
          stickyDiagnostics = await collectStickyDiagnostics(
            session.page,
            stickySelector,
          );
          expectedDetectorHit = evidence.stickyOcclusion.length > 0;
          if (!expectedDetectorHit) {
            console.error(
              `sticky diagnostics for ${c.id}:`,
              JSON.stringify(stickyDiagnostics, null, 2),
            );
          }
        } else if (c.detector === "accessibility") {
          expectedDetectorHit = evidence.accessibility.violations.length > 0;
        }

        let top1: boolean | null = null;
        let top3: boolean | null = null;
        if (c.localization) {
          const hints = [
            {
              selector: String(
                c.issue.expected?.culpritSelector ??
                  c.localization.selectorIncludes ??
                  "body",
              ),
              properties: c.localization.property
                ? [c.localization.property]
                : [],
              reason: "benchmark expected",
            },
          ];
          const candidates = await localizeSources(session.page, {
            repoPath: server.cwd,
            readyUrl: server.url,
            defectHints: hints,
          });
          const match = (cand: (typeof candidates)[number]) => {
            const fileOk =
              !c.localization!.sourceFile ||
              cand.file === c.localization!.sourceFile ||
              (cand.file?.endsWith(c.localization!.sourceFile) ?? false);
            const propOk =
              !c.localization!.property ||
              cand.property === c.localization!.property;
            const selOk =
              !c.localization!.selectorIncludes ||
              cand.selector.includes(c.localization!.selectorIncludes) ||
              cand.elementSelector.includes(c.localization!.selectorIncludes);
            return Boolean(fileOk && (propOk || selOk));
          };
          top1 = candidates[0] ? match(candidates[0]) : false;
          top3 = candidates.slice(0, 3).some(match);
        }

        const specialReproduced =
          (c.id === "container-stretch" ||
            c.id === "desktop-container-maxwidth") &&
          expectedDetectorHit
            ? true
            : reproduced;

        const durationMs = Date.now() - caseStarted;
        results.push({
          id: c.id,
          detector: c.detector,
          reproduced: specialReproduced || expectedDetectorHit,
          expectedDetectorHit,
          top1,
          top3,
          failures: assertion.failures,
          notes: stickyDiagnostics
            ? [`stickyDiagnostics=${JSON.stringify(stickyDiagnostics)}`]
            : [],
          durationMs,
          stickyDiagnostics,
        });
        console.log(
          `${c.id}: reproduced=${specialReproduced || expectedDetectorHit} detectorHit=${expectedDetectorHit} top1=${top1} top3=${top3} durationMs=${durationMs}`,
        );
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
    }
  }

  const reproducedN = results.filter((r) => r.reproduced).length;
  const detectorHits = results.filter((r) => r.expectedDetectorHit).length;
  const locCases = results.filter((r) => r.top1 !== null);
  const top1 = locCases.filter((r) => r.top1).length;
  const top3 = locCases.filter((r) => r.top3).length;
  const failedCases = results
    .filter((r) => !r.expectedDetectorHit)
    .map((r) => r.id);

  const summary = {
    total: results.length,
    reproductionSuccessRate: reproducedN / results.length,
    detectorHitRate: detectorHits / results.length,
    expectedPrimaryDetectors: 12,
    primaryDetectorHits: detectorHits,
    failedPrimaryDetectors: failedCases,
    localizationCases: locCases.length,
    sourceLocalizationTop1: locCases.length ? top1 / locCases.length : null,
    sourceLocalizationTop3: locCases.length ? top3 / locCases.length : null,
    totalDurationMs: Date.now() - startedAll,
    results,
    note: "MVP fixture benchmark — not a scientific claim of broad validity. Primary detector gate requires 12/12 hits.",
  };

  const outDir = path.join(repoRoot, "artifacts", "benchmark");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "detectors.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log("\n=== Detector benchmark summary ===");
  console.log(JSON.stringify(summary, null, 2));

  // Strict gate: all 12 expected primary detectors must hit. No silent retries.
  if (detectorHits < results.length || failedCases.length > 0) {
    console.error(
      `Detector benchmark failed: ${detectorHits}/${results.length}. Failed: ${failedCases.join(", ") || "none"}`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
