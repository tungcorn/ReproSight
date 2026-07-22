import type { Page } from "playwright";
import type { StickyOcclusionFinding } from "../evidence/types.js";
import { nextFindingId } from "../util/id.js";
import { assertSafeSelector } from "../security/paths.js";

export async function detectStickyOcclusion(
  page: Page,
  targetSelector?: string,
): Promise<StickyOcclusionFinding[]> {
  if (targetSelector) assertSafeSelector(targetSelector);

  // Prefer native scrollIntoView so scroll-margin-top is honored after repair.
  if (targetSelector) {
    await page
      .locator(targetSelector)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    // If margin is missing, scrollIntoView may still leave the target flush under
    // the sticky header. Force-align to top only when computed scroll-margin is ~0.
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const style = getComputedStyle(el);
      const margin = Number.parseFloat(style.scrollMarginTop || "0") || 0;
      if (margin < 8) {
        const y = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, Math.max(0, y));
      }
    }, targetSelector);
  }

  const raw = await page.evaluate((targetSel) => {
    const headers = Array.from(document.querySelectorAll("body *")).filter(
      (el) => {
        const style = getComputedStyle(el);
        if (style.position !== "sticky" && style.position !== "fixed")
          return false;
        const r = el.getBoundingClientRect();
        return r.height > 10 && r.top <= 20 && r.width > 50;
      },
    );

    const targets = targetSel
      ? Array.from(document.querySelectorAll(targetSel))
      : Array.from(document.querySelectorAll("h1,h2,h3,[data-anchor]"));

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

    const findings: Array<Record<string, unknown>> = [];
    for (const target of targets) {
      const tr = target.getBoundingClientRect();
      const tStyle = getComputedStyle(target);
      const margin = Number.parseFloat(tStyle.scrollMarginTop || "0") || 0;
      for (const header of headers) {
        if (header.contains(target) || target.contains(header)) continue;
        const hr = header.getBoundingClientRect();
        const overlap =
          Math.min(tr.bottom, hr.bottom) - Math.max(tr.top, hr.top);
        // Adequate scroll-margin that keeps the target below the sticky header
        // after scrollIntoView should not be reported as occlusion.
        if (margin >= hr.height - 1 && tr.top >= hr.bottom - 1) {
          continue;
        }
        if (overlap > 1 && tr.top < hr.bottom) {
          findings.push({
            targetSelector: cssPath(target),
            headerSelector: cssPath(header),
            targetRect: {
              x: tr.x,
              y: tr.y,
              width: tr.width,
              height: tr.height,
            },
            headerRect: {
              x: hr.x,
              y: hr.y,
              width: hr.width,
              height: hr.height,
            },
            scrollY: window.scrollY,
            scrollMarginTop: tStyle.scrollMarginTop,
            obscuredPx: overlap,
          });
        }
      }
    }
    return findings.slice(0, 20);
  }, targetSelector ?? null);

  return raw.map((r) => ({
    id: nextFindingId("sticky"),
    kind: "stickyOcclusion" as const,
    targetSelector: String(r.targetSelector),
    headerSelector: String(r.headerSelector),
    targetRect: r.targetRect as StickyOcclusionFinding["targetRect"],
    headerRect: r.headerRect as StickyOcclusionFinding["headerRect"],
    scrollY: Number(r.scrollY),
    scrollMarginTop: String(r.scrollMarginTop),
    obscuredPx: Number(r.obscuredPx),
  }));
}
