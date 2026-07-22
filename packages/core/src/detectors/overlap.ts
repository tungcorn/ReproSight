import type { Page } from "playwright";
import type { OverlapFinding } from "../evidence/types.js";
import { nextFindingId } from "../util/id.js";

export async function detectOverlap(
  page: Page,
  opts: {
    ignoreSelectors: string[];
    ignorePairs: Array<{ a: string; b: string }>;
    minIntersectionArea?: number;
  },
): Promise<OverlapFinding[]> {
  const minArea = opts.minIntersectionArea ?? 40;
  const raw = await page.evaluate(
    ({ ignores, ignorePairs, minArea }) => {
      const cssPath = (el: Element): string => {
        if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && cur.nodeType === 1 && parts.length < 5) {
          let part = cur.nodeName.toLowerCase();
          if ((cur as HTMLElement).classList?.length) {
            part +=
              "." +
              Array.from((cur as HTMLElement).classList)
                .slice(0, 2)
                .join(".");
          }
          parts.unshift(part);
          cur = cur.parentElement;
        }
        return parts.join(" > ");
      };

      const isIgnored = (el: Element) =>
        ignores.some((sel) => {
          try {
            return el.matches(sel) || !!el.closest(sel);
          } catch {
            return false;
          }
        });

      const elements = Array.from(document.querySelectorAll("body *")).filter(
        (el) => {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden")
            return false;
          if (style.pointerEvents === "none") return false;
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        },
      );

      const findings: Array<Record<string, unknown>> = [];
      const limit = Math.min(elements.length, 80);
      for (let i = 0; i < limit; i++) {
        const a = elements[i]!;
        if (isIgnored(a)) continue;
        const ra = a.getBoundingClientRect();
        const sa = getComputedStyle(a);
        for (let j = i + 1; j < limit; j++) {
          const b = elements[j]!;
          if (a.contains(b) || b.contains(a)) continue;
          if (isIgnored(b)) continue;
          const rb = b.getBoundingClientRect();
          const x = Math.max(ra.x, rb.x);
          const y = Math.max(ra.y, rb.y);
          const right = Math.min(ra.right, rb.right);
          const bottom = Math.min(ra.bottom, rb.bottom);
          const width = right - x;
          const height = bottom - y;
          if (width <= 0 || height <= 0) continue;
          const area = width * height;
          if (area < minArea) continue;
          const sb = getComputedStyle(b);
          const selA = cssPath(a);
          const selB = cssPath(b);
          const pairIgnored = ignorePairs.some(
            (p) =>
              (selA.includes(p.a) && selB.includes(p.b)) ||
              (selA.includes(p.b) && selB.includes(p.a)),
          );
          const areaA = ra.width * ra.height || 1;
          const areaB = rb.width * rb.height || 1;
          findings.push({
            selectorA: selA,
            selectorB: selB,
            intersection: { x, y, width, height },
            overlapRatioA: area / areaA,
            overlapRatioB: area / areaB,
            zIndexA: sa.zIndex,
            zIndexB: sb.zIndex,
            positionA: sa.position,
            positionB: sb.position,
            interactionObstructed:
              (sa.pointerEvents !== "none" && sb.pointerEvents !== "none") &&
              area > 100,
            ignored: pairIgnored,
          });
        }
      }
      return findings.slice(0, 30);
    },
    {
      ignores: opts.ignoreSelectors,
      ignorePairs: opts.ignorePairs,
      minArea,
    },
  );

  return raw.map((r) => ({
    id: nextFindingId("overlap"),
    kind: "overlap" as const,
    selectorA: String(r.selectorA),
    selectorB: String(r.selectorB),
    intersection: r.intersection as OverlapFinding["intersection"],
    overlapRatioA: Number(r.overlapRatioA),
    overlapRatioB: Number(r.overlapRatioB),
    zIndexA: String(r.zIndexA),
    zIndexB: String(r.zIndexB),
    positionA: String(r.positionA),
    positionB: String(r.positionB),
    interactionObstructed: Boolean(r.interactionObstructed),
    ignored: Boolean(r.ignored),
  }));
}
