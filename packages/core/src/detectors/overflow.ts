import type { Page } from "playwright";
import type { OverflowFinding } from "../evidence/types.js";
import { nextFindingId } from "../util/id.js";

export async function detectHorizontalOverflow(
  page: Page,
  ignoreSelectors: string[],
): Promise<{
  findings: OverflowFinding[];
  documentMetrics: {
    clientWidth: number;
    scrollWidth: number;
    bodyClientWidth: number;
    bodyScrollWidth: number;
    clientHeight: number;
    scrollHeight: number;
  };
}> {
  const result = await page.evaluate((ignores: string[]) => {
    const clientWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const bodyClientWidth = document.body?.clientWidth ?? 0;
    const bodyScrollWidth = document.body?.scrollWidth ?? 0;
    const clientHeight = document.documentElement.clientHeight;
    const scrollHeight = document.documentElement.scrollHeight;

    const ignoreSet = new Set(ignores);
    const isIgnored = (el: Element) => {
      for (const sel of ignores) {
        try {
          if (el.matches(sel) || el.closest(sel)) return true;
        } catch {
          // invalid selector ignored
        }
      }
      return false;
    };

    const cssPath = (el: Element): string => {
      if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
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

    const candidates: Array<Record<string, unknown>> = [];
    const all = Array.from(document.querySelectorAll("body *"));
    for (const el of all) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const overflowAmount = rect.right - clientWidth;
      if (overflowAmount <= 1) continue;

      const parent = el.parentElement;
      const parentRect = parent?.getBoundingClientRect();
      const decorativeLikely =
        style.pointerEvents === "none" ||
        style.position === "fixed" && (el.className || "").toString().includes("orb") ||
        ignoreSet.has((el as HTMLElement).id);

      candidates.push({
        selector: cssPath(el),
        domPath: cssPath(el),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        parentRect: parentRect
          ? {
              x: parentRect.x,
              y: parentRect.y,
              width: parentRect.width,
              height: parentRect.height,
            }
          : null,
        overflowAmount,
        position: style.position,
        transform: style.transform,
        width: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        whiteSpace: style.whiteSpace,
        flexOrGrid: `${style.display}|flex:${style.flex}|basis:${style.flexBasis}`,
        ignored: isIgnored(el),
        decorativeLikely,
      });
    }

    candidates.sort(
      (a, b) => Number(b.overflowAmount) - Number(a.overflowAmount),
    );

    return {
      documentMetrics: {
        clientWidth,
        scrollWidth,
        bodyClientWidth,
        bodyScrollWidth,
        clientHeight,
        scrollHeight,
      },
      candidates: candidates.slice(0, 25),
    };
  }, ignoreSelectors);

  const findings: OverflowFinding[] = result.candidates.map((c) => ({
    id: nextFindingId("overflow"),
    kind: "horizontalOverflow" as const,
    selector: String(c.selector),
    domPath: String(c.domPath),
    rect: c.rect as OverflowFinding["rect"],
    parentRect: (c.parentRect as OverflowFinding["parentRect"]) ?? null,
    overflowAmount: Number(c.overflowAmount),
    position: String(c.position),
    transform: String(c.transform),
    width: String(c.width),
    minWidth: String(c.minWidth),
    maxWidth: String(c.maxWidth),
    whiteSpace: String(c.whiteSpace),
    flexOrGrid: String(c.flexOrGrid),
    ignored: Boolean(c.ignored),
    decorativeLikely: Boolean(c.decorativeLikely),
  }));

  return { findings, documentMetrics: result.documentMetrics };
}
