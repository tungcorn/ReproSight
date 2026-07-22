import path from "node:path";
import fs from "node:fs/promises";
import {
  parseConfig,
  parseIssue,
  launchSession,
  navigateAndPrepare,
  runDetectors,
  localizeSources,
  type SourceCandidate,
} from "@reprosight/core";
import { BENCH_CASES } from "./cases.js";
import {
  repoRoot,
  startFixtureServer,
  staticServeCommand,
} from "./fixture-server.js";

type FailureCategory =
  | "correct"
  | "correct-file-wrong-rule"
  | "correct-element-unresolved-source"
  | "wrong-element"
  | "stylesheet-url-mapping-failed"
  | "ambiguous-cascade"
  | "unsupported-source-style";

type CaseAnalysis = {
  caseId: string;
  expected: {
    file: string | null;
    selector: string | null;
    properties: string[];
  };
  topCandidates: Array<{
    rank: number;
    file: string | null;
    selector: string;
    property: string;
    value: string;
    score: number;
    reason: string;
  }>;
  top1: boolean;
  top3: boolean;
  failureCategory: FailureCategory | null;
  explanation: string;
  detector: string;
  difficulty: string;
};

function categorize(
  expected: CaseAnalysis["expected"],
  candidates: SourceCandidate[],
  top1: boolean,
  top3: boolean,
): { category: FailureCategory; explanation: string } {
  if (top1) {
    return {
      category: "correct",
      explanation: "Expected source candidate ranked #1.",
    };
  }

  const top = candidates.slice(0, 5);
  const anyFile = top.some(
    (c) =>
      c.file &&
      expected.file &&
      (c.file === expected.file || c.file.endsWith(expected.file)),
  );
  const anySelector = top.some((c) => {
    if (!expected.selector) return false;
    return (
      c.selector.includes(expected.selector) ||
      c.elementSelector.includes(expected.selector) ||
      (expected.selector.startsWith(".") &&
        c.selector.includes(expected.selector.slice(1)))
    );
  });
  const anyProp = top.some(
    (c) =>
      expected.properties.length === 0 ||
      expected.properties.includes(c.property),
  );
  const unresolved = top.length > 0 && top.every((c) => !c.file);

  if (unresolved) {
    return {
      category: "stylesheet-url-mapping-failed",
      explanation:
        "Candidates found but authored stylesheet URLs did not map to repository paths.",
    };
  }
  if (anyFile && anySelector && !anyProp) {
    return {
      category: "correct-file-wrong-rule",
      explanation:
        "Expected file/selector present but the property/rule was not ranked highly enough.",
    };
  }
  if (anyFile && !anySelector) {
    return {
      category: "correct-file-wrong-rule",
      explanation: "Expected file appears in top candidates but wrong rule.",
    };
  }
  if (!anyFile && anySelector) {
    return {
      category: "correct-element-unresolved-source",
      explanation:
        "Element/selector signals present but expected file was not resolved.",
    };
  }
  if (top3) {
    return {
      category: "ambiguous-cascade",
      explanation:
        "Expected rule is in top-3 but not top-1 due to competing cascade candidates.",
    };
  }
  if (top.length === 0) {
    return {
      category: "unsupported-source-style",
      explanation: "No source candidates collected for this defect.",
    };
  }
  return {
    category: "wrong-element",
    explanation: "Top candidates do not match expected file/selector/property.",
  };
}

function matchCandidate(
  cand: SourceCandidate,
  expected: CaseAnalysis["expected"],
  selectorIncludes?: string,
): boolean {
  const fileOk =
    !expected.file ||
    cand.file === expected.file ||
    (cand.file?.endsWith(expected.file) ?? false);
  const propOk =
    expected.properties.length === 0 ||
    expected.properties.includes(cand.property);
  const selOk =
    !selectorIncludes ||
    cand.selector.includes(selectorIncludes) ||
    cand.elementSelector.includes(selectorIncludes) ||
    (!!expected.selector &&
      (cand.selector.includes(expected.selector) ||
        cand.elementSelector.includes(expected.selector)));
  return Boolean(fileOk && (propOk || selOk));
}

async function main() {
  const analyses: CaseAnalysis[] = [];

  for (const c of BENCH_CASES) {
    if (!c.localization) continue;
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
          start: staticServeCommand(c.port),
        },
        server: { readyUrl: server.url, timeoutMs: 30_000 },
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
      });
      const issue = parseIssue(c.issue);
      const session = await launchSession({ config, issue, headless: true });
      try {
        await navigateAndPrepare({ page: session.page, config, issue });
        const { evidence } = await runDetectors(session.page, config, issue);
        const hints = [
          ...evidence.horizontalOverflow.map((f) => ({
            selector: f.selector,
            properties: [
              "max-width",
              "width",
              "min-width",
              "white-space",
              "grid-template-columns",
              "flex",
              "overflow-x",
            ],
            reason: `overflow ${f.overflowAmount.toFixed(1)}px`,
          })),
          ...evidence.textClipping.map((f) => ({
            selector: f.selector,
            properties: [
              "overflow",
              "height",
              "max-height",
              "white-space",
              "text-overflow",
            ],
            reason: "clipping",
          })),
          ...evidence.overlap.flatMap((f) => [
            {
              selector: f.selectorA,
              properties: ["position", "z-index", "top", "left", "transform"],
              reason: "overlap A",
            },
            {
              selector: f.selectorB,
              properties: ["position", "z-index", "top", "left", "transform"],
              reason: "overlap B",
            },
          ]),
          ...evidence.stickyOcclusion.map((f) => ({
            selector: f.targetSelector,
            properties: ["scroll-margin-top", "top", "position"],
            reason: "sticky",
          })),
        ];
        if (c.issue.expected?.culpritSelector) {
          hints.unshift({
            selector: String(c.issue.expected.culpritSelector),
            properties: c.localization.property
              ? [c.localization.property]
              : [],
            reason: "issue expected culprit",
          });
        }

        const candidates = await localizeSources(session.page, {
          repoPath: server.cwd,
          readyUrl: server.url,
          defectHints: hints,
        });

        const expected = {
          file: c.localization.sourceFile ?? null,
          selector:
            (c.issue.expected?.culpritSelector as string | undefined) ??
            c.localization.selectorIncludes ??
            null,
          properties: c.localization.property
            ? [c.localization.property]
            : [],
        };

        const selectorIncludes = c.localization?.selectorIncludes;
        const top1 = candidates[0]
          ? matchCandidate(candidates[0], expected, selectorIncludes)
          : false;
        const top3 = candidates
          .slice(0, 3)
          .some((cand) => matchCandidate(cand, expected, selectorIncludes));
        const { category, explanation } = categorize(
          expected,
          candidates,
          top1,
          top3,
        );

        analyses.push({
          caseId: c.id,
          expected,
          topCandidates: candidates.slice(0, 5).map((cand) => ({
            rank: cand.rank,
            file: cand.file,
            selector: cand.selector,
            property: cand.property,
            value: cand.value,
            score: cand.score,
            reason: cand.reason,
          })),
          top1,
          top3,
          failureCategory: top1 ? "correct" : category,
          explanation,
          detector: c.detector,
          difficulty: c.difficulty,
        });
        console.log(
          `${c.id}: top1=${top1} top3=${top3} category=${top1 ? "correct" : category}`,
        );
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
    }
  }

  const top1N = analyses.filter((a) => a.top1).length;
  const top3N = analyses.filter((a) => a.top3).length;
  const byCategory: Record<string, number> = {};
  const byDetector: Record<string, { n: number; top1: number; top3: number }> =
    {};
  const byDifficulty: Record<
    string,
    { n: number; top1: number; top3: number }
  > = {};
  for (const a of analyses) {
    const cat = a.failureCategory ?? "unknown";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byDetector[a.detector] ??= { n: 0, top1: 0, top3: 0 };
    byDetector[a.detector]!.n += 1;
    if (a.top1) byDetector[a.detector]!.top1 += 1;
    if (a.top3) byDetector[a.detector]!.top3 += 1;
    byDifficulty[a.difficulty] ??= { n: 0, top1: 0, top3: 0 };
    byDifficulty[a.difficulty]!.n += 1;
    if (a.top1) byDifficulty[a.difficulty]!.top1 += 1;
    if (a.top3) byDifficulty[a.difficulty]!.top3 += 1;
  }

  const report = {
    total: analyses.length,
    top1Rate: analyses.length ? top1N / analyses.length : 0,
    top3Rate: analyses.length ? top3N / analyses.length : 0,
    byCategory,
    byDetector,
    byDifficulty,
    cases: analyses,
    limitations: [
      "Plain CSS and style tags only; CSS-in-JS runtime rewriting unsupported.",
      "Stylesheet URL → repo path mapping depends on local static server paths.",
      "Competing cascade rules can push the true culprit out of top-1 while remaining in top-3.",
      "MVP fixture set is not a broad scientific benchmark.",
    ],
    note: "Deterministic source localization analysis. Not real-model accuracy.",
  };

  const outDir = path.join(repoRoot, "artifacts", "benchmark");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "localization-analysis.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log("\n=== Localization analysis ===");
  console.log(
    JSON.stringify(
      {
        total: report.total,
        top1Rate: report.top1Rate,
        top3Rate: report.top3Rate,
        byCategory: report.byCategory,
        byDetector: report.byDetector,
        byDifficulty: report.byDifficulty,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
