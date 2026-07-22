import type { Page } from "playwright";
import type { ReproSightConfig } from "../config/schema.js";
import type { DetectorEvidence } from "../evidence/types.js";
import type { IssueSpec } from "../scenario/issue.js";
import { detectHorizontalOverflow } from "./overflow.js";
import { detectOverlap } from "./overlap.js";
import { detectTextClipping } from "./clipping.js";
import { detectStickyOcclusion } from "./sticky.js";
import { runAxe } from "./accessibility.js";
import { resetFindingIds } from "../util/id.js";

export async function runDetectors(
  page: Page,
  config: ReproSightConfig,
  issue: IssueSpec,
): Promise<{ evidence: DetectorEvidence; axeRaw: unknown }> {
  resetFindingIds();
  const ignores = config.ignores.selectors;

  const overflow = config.detectors.horizontalOverflow
    ? await detectHorizontalOverflow(page, ignores)
    : {
        findings: [],
        documentMetrics: {
          clientWidth: 0,
          scrollWidth: 0,
          bodyClientWidth: 0,
          bodyScrollWidth: 0,
          clientHeight: 0,
          scrollHeight: 0,
        },
      };

  const overlap = config.detectors.overlap
    ? await detectOverlap(page, {
        ignoreSelectors: ignores,
        ignorePairs: config.ignores.overlapPairs,
      })
    : [];

  const clipping = config.detectors.textClipping
    ? await detectTextClipping(page, ignores)
    : [];

  const stickyTarget =
    issue.assertions.find((a) => a.type === "noStickyOcclusion")?.selector ??
    issue.actions.find((a) => a.type === "scrollIntoView")?.selector;

  const sticky = config.detectors.stickyOcclusion
    ? await detectStickyOcclusion(page, stickyTarget)
    : [];

  const axe = config.detectors.accessibility
    ? await runAxe(page)
    : {
        violations: [],
        incomplete: 0,
        passes: 0,
        raw: null,
        note: "Accessibility detector disabled",
      };

  // If document metrics empty (detectors off), still sample
  let documentMetrics = overflow.documentMetrics;
  if (!documentMetrics.clientWidth) {
    documentMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body?.clientWidth ?? 0,
      bodyScrollWidth: document.body?.scrollWidth ?? 0,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
  }

  return {
    evidence: {
      horizontalOverflow: overflow.findings.filter((f) => !f.ignored),
      overlap: overlap.filter((f) => !f.ignored),
      textClipping: clipping.filter((f) => !f.ignored),
      stickyOcclusion: sticky,
      accessibility: {
        violations: axe.violations,
        incomplete: axe.incomplete,
        passes: axe.passes,
        note: axe.note,
      },
      documentMetrics,
    },
    axeRaw: axe.raw,
  };
}

export function evaluateAssertions(
  issue: IssueSpec,
  evidence: DetectorEvidence,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const assertion of issue.assertions) {
    switch (assertion.type) {
      case "noHorizontalOverflow": {
        const overflow =
          evidence.documentMetrics.scrollWidth -
            evidence.documentMetrics.clientWidth >
          1;
        const offenders = evidence.horizontalOverflow.filter(
          (f) => !f.decorativeLikely,
        );
        if (overflow || offenders.length > 0) {
          failures.push(
            `Horizontal overflow detected (delta=${
              evidence.documentMetrics.scrollWidth -
              evidence.documentMetrics.clientWidth
            }, offenders=${offenders.length})`,
          );
        }
        break;
      }
      case "selectorWithinViewport": {
        const offender = evidence.horizontalOverflow.find((f) =>
          f.selector.includes(assertion.selector.replace("#", "")),
        );
        // also check any finding for that selector path
        const match = evidence.horizontalOverflow.find(
          (f) =>
            f.selector.includes(assertion.selector) ||
            f.domPath.includes(assertion.selector),
        );
        if (offender || match) {
          failures.push(
            `Selector ${assertion.selector} extends beyond viewport`,
          );
        }
        break;
      }
      case "noOverlap": {
        const hit = evidence.overlap.find(
          (o) =>
            (o.selectorA.includes(assertion.a) &&
              o.selectorB.includes(assertion.b)) ||
            (o.selectorA.includes(assertion.b) &&
              o.selectorB.includes(assertion.a)),
        );
        if (hit) failures.push(`Overlap between ${assertion.a} and ${assertion.b}`);
        break;
      }
      case "noTextClipping": {
        const hits = assertion.selector
          ? evidence.textClipping.filter((c) =>
              c.selector.includes(assertion.selector!),
            )
          : evidence.textClipping;
        if (hits.length)
          failures.push(`Text clipping detected (${hits.length})`);
        break;
      }
      case "noStickyOcclusion": {
        const sel = assertion.selector;
        const bare = sel.replace(/^#/, "");
        const any = evidence.stickyOcclusion.filter(
          (s) =>
            s.obscuredPx > 1 &&
            (s.targetSelector.includes(sel) ||
              s.targetSelector.includes(bare) ||
              s.targetSelector === sel ||
              s.targetSelector.endsWith(sel)),
        );
        if (any.length === 0 && evidence.stickyOcclusion.some((s) => s.obscuredPx > 1)) {
          // fall back to any occlusion when selector path differs slightly
          failures.push(`Sticky occlusion on ${assertion.selector}`);
        } else if (any.length) {
          failures.push(`Sticky occlusion on ${assertion.selector}`);
        }
        break;
      }
    }
  }
  return { passed: failures.length === 0, failures };
}
