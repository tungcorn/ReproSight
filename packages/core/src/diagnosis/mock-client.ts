import type {
  DiagnosisInput,
  DiagnosisResult,
  ModelClient,
} from "./types.js";
import { parseDiagnosisOutput } from "./types.js";

/**
 * Deterministic mock provider used in tests and CI.
 * Matches known fixture issue IDs / source candidates; abstains otherwise.
 *
 * Diffs are authored against LF-normalized fixture CSS (fixtures use .gitattributes eol=lf).
 */
export class MockModelClient implements ModelClient {
  readonly name = "mock";

  async diagnoseAndProposePatch(
    input: DiagnosisInput,
  ): Promise<DiagnosisResult> {
    const issueId = input.issue.id;
    const known = KNOWN_PATCHES[issueId];
    if (!known) {
      const byHeuristic = heuristicPatch(input);
      if (byHeuristic) {
        return {
          output: parseDiagnosisOutput(byHeuristic),
          usage: { provider: "mock", model: "mock-v1", totalTokens: 0 },
        };
      }
      return {
        output: parseDiagnosisOutput({
          reproduced: input.evidence.detectors.horizontalOverflow.length > 0,
          summary:
            "Insufficient mapped evidence for a safe minimal patch in mock provider.",
          rootCause: {
            confidence: 0.2,
            elementSelectors: input.evidence.detectors.horizontalOverflow
              .slice(0, 3)
              .map((f) => f.selector),
            sourceCandidates: [],
          },
          patch: {
            unifiedDiff: null,
            rationale: "Mock provider abstains when no fixture mapping exists.",
            filesExpected: [],
          },
          regressionScenarios: [],
          abstainReason:
            "No deterministic mock patch mapping for this issue id and evidence.",
        }),
        usage: { provider: "mock", model: "mock-v1", totalTokens: 0 },
      };
    }

    return {
      output: parseDiagnosisOutput({
        reproduced: true,
        summary: known.summary,
        rootCause: {
          confidence: known.confidence,
          elementSelectors: known.elementSelectors,
          sourceCandidates: [
            {
              file: known.file,
              line: known.line,
              selector: known.selector,
              properties: known.properties,
              explanation: known.explanation,
            },
          ],
        },
        patch: {
          unifiedDiff: known.diff,
          rationale: known.rationale,
          filesExpected: [known.file],
        },
        regressionScenarios: known.regressionScenarios,
        abstainReason: null,
      }),
      usage: {
        provider: "mock",
        model: "mock-v1",
        promptTokens: 100,
        completionTokens: 80,
        totalTokens: 180,
        estimatedCostUsd: 0,
      },
    };
  }
}

type KnownPatch = {
  summary: string;
  confidence: number;
  elementSelectors: string[];
  file: string;
  line?: number;
  selector?: string;
  properties: string[];
  explanation: string;
  rationale: string;
  diff: string;
  regressionScenarios: Array<{
    name: string;
    reason: string;
    viewport?: { width: number; height: number };
    locale?: string;
    theme?: string;
  }>;
};

const KNOWN_PATCHES: Record<string, KnownPatch> = {
  "container-stretch": {
    summary:
      "Hero section stretches because .hero overrides shared .container with max-width:none and min-width:1600px.",
    confidence: 0.93,
    elementSelectors: [".hero.container", ".hero"],
    file: "styles.css",
    line: 35,
    selector: ".hero",
    properties: ["max-width", "min-width"],
    explanation:
      "Later .hero rules defeat .container { max-width:1080px; margin:0 auto; } and force a 1600px min width.",
    rationale:
      "Remove the erroneous max-width/min-width overrides on .hero so the shared container constraint applies again.",
    diff: `--- a/styles.css
+++ b/styles.css
@@ -32,9 +32,6 @@
 .hero {
   padding: 48px 24px;
   background: #111827;
-  /* buggy override of shared .container max-width */
-  max-width: none;
-  min-width: 1600px;
 }

 .hero h1 {
`,
    regressionScenarios: [
      {
        name: "desktop-en",
        reason: "Original failing desktop state",
        viewport: { width: 1440, height: 900 },
        locale: "en",
        theme: "dark",
      },
      {
        name: "tablet",
        reason: "Ensure container still centered",
        viewport: { width: 768, height: 1024 },
      },
      {
        name: "mobile",
        reason: "Ensure mobile layout unaffected",
        viewport: { width: 390, height: 844 },
      },
    ],
  },
  "locale-overflow-vi-768": {
    summary:
      "Vietnamese About highlight labels overflow at 768px due to nowrap and a desktop grid override winning at tablet width.",
    confidence: 0.91,
    elementSelectors: [".about__highlights li", ".about__highlights strong"],
    file: "styles.css",
    line: 49,
    selector: ".about__highlights strong",
    properties: ["white-space", "grid-template-columns"],
    explanation:
      "white-space: nowrap on strong labels plus a late desktop grid rule raises min-content width past the tablet viewport.",
    rationale:
      "Allow wrapping on highlight labels and remove the conflicting late grid override.",
    diff: `--- a/styles.css
+++ b/styles.css
@@ -46,7 +46,7 @@

 .about__highlights strong {
   display: inline-block;
-  white-space: nowrap;
+  white-space: normal;
   font-weight: 700;
 }

@@ -62,7 +62,3 @@
     grid-template-columns: 1fr 1fr;
   }
 }
-
-/* buggy late desktop override without min-width media */
-.about__highlights {
-  grid-template-columns: 280px 280px 280px;
-}
`,
    regressionScenarios: [
      {
        name: "vi-tablet",
        reason: "Original failing state",
        viewport: { width: 768, height: 1024 },
        locale: "vi",
      },
      {
        name: "en-tablet",
        reason: "English should remain neat",
        viewport: { width: 768, height: 1024 },
        locale: "en",
      },
      {
        name: "vi-mobile",
        reason: "Mobile regression",
        viewport: { width: 390, height: 844 },
        locale: "vi",
      },
    ],
  },
  "overlap-cta-badge": {
    summary: "Absolute badge overlaps the primary CTA.",
    confidence: 0.9,
    elementSelectors: ["#badge", "#cta"],
    file: "styles.css",
    line: 28,
    selector: ".badge",
    properties: ["left", "top", "z-index"],
    explanation: "Badge is positioned over the CTA with higher z-index.",
    rationale: "Move the badge so it no longer covers the interactive CTA.",
    diff: `--- a/styles.css
+++ b/styles.css
@@ -25,8 +25,8 @@
 }
 .badge {
   position: absolute;
-  left: 90px;
-  top: 30px;
+  left: 220px;
+  top: 8px;
   background: #ef4444;
   padding: 18px 22px;
   border-radius: 999px;
`,
    regressionScenarios: [
      {
        name: "mobile",
        reason: "Original viewport",
        viewport: { width: 390, height: 844 },
      },
    ],
  },
  "clipping-vi-paragraph": {
    summary: "Fixed height + overflow hidden clips translated paragraph.",
    confidence: 0.88,
    elementSelectors: ["#clip"],
    file: "styles.css",
    line: 8,
    selector: ".clip",
    properties: ["height", "overflow"],
    explanation: "Fixed 48px height clips multi-line Vietnamese text.",
    rationale: "Allow the paragraph to grow with content.",
    diff: `--- a/styles.css
+++ b/styles.css
@@ -7,8 +7,8 @@
 }
 .clip {
   width: 280px;
-  height: 48px;
-  overflow: hidden;
+  min-height: 48px;
+  overflow: visible;
   border: 1px solid #334155;
   padding: 8px;
 }
`,
    regressionScenarios: [
      {
        name: "mobile",
        reason: "Original viewport",
        viewport: { width: 390, height: 844 },
      },
    ],
  },
  "sticky-heading-occlusion": {
    summary: "Heading lacks scroll-margin-top under sticky nav.",
    confidence: 0.86,
    elementSelectors: ["#section"],
    file: "styles.css",
    line: 21,
    selector: "#section",
    properties: ["scroll-margin-top"],
    explanation: "Sticky nav covers the heading after scroll-to-anchor.",
    rationale: "Add scroll-margin-top equal to sticky nav height.",
    diff: `--- a/styles.css
+++ b/styles.css
@@ -21,6 +21,7 @@
 #section {
   margin: 0;
   padding: 8px 20px;
+  scroll-margin-top: 64px;
   /* intentionally missing scroll-margin-top — heading sits under sticky nav */
   background: #1e293b;
 }
`,
    regressionScenarios: [
      {
        name: "desktop",
        reason: "Original viewport",
        viewport: { width: 1440, height: 900 },
      },
    ],
  },
  "grid-mincontent-overflow": {
    summary: "nowrap unbreakable token expands grid min-content width.",
    confidence: 0.87,
    elementSelectors: ["#long", ".long"],
    file: "styles.css",
    line: 19,
    selector: ".long",
    properties: ["white-space", "min-width"],
    explanation: "white-space:nowrap prevents shrinking inside 1fr tracks.",
    rationale:
      "Allow wrapping/breaking, permit grid items to shrink, and box-size the grid so padding does not overflow the viewport.",
    diff: `--- a/styles.css
+++ b/styles.css
@@ -1,21 +1,28 @@
 body {
   margin: 0;
   font-family: system-ui, sans-serif;
   background: #0b1220;
   color: #e5e7eb;
 }
 .grid {
   display: grid;
   grid-template-columns: 1fr 1fr 1fr;
   gap: 8px;
   padding: 16px;
-  width: 100%;
+  width: 100%;
+  max-width: 100%;
+  box-sizing: border-box;
 }
 .cell {
   border: 1px solid #334155;
   padding: 12px;
-  min-width: auto;
+  min-width: 0;
+  box-sizing: border-box;
 }
 .long {
-  white-space: nowrap;
+  white-space: normal;
+  overflow-wrap: anywhere;
+  word-break: break-word;
 }
`,
    regressionScenarios: [
      {
        name: "mobile",
        reason: "Original viewport",
        viewport: { width: 390, height: 844 },
      },
    ],
  },
};

function heuristicPatch(input: DiagnosisInput): unknown | null {
  const id = input.issue.id;
  for (const key of Object.keys(KNOWN_PATCHES)) {
    if (id.includes(key) || key.includes(id)) {
      const known = KNOWN_PATCHES[key]!;
      return {
        reproduced: true,
        summary: known.summary,
        rootCause: {
          confidence: known.confidence,
          elementSelectors: known.elementSelectors,
          sourceCandidates: [
            {
              file: known.file,
              line: known.line,
              selector: known.selector,
              properties: known.properties,
              explanation: known.explanation,
            },
          ],
        },
        patch: {
          unifiedDiff: known.diff,
          rationale: known.rationale,
          filesExpected: [known.file],
        },
        regressionScenarios: known.regressionScenarios,
        abstainReason: null,
      };
    }
  }
  return null;
}
