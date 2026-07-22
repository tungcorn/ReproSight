import type { Page } from "playwright";
import type { StickyOcclusionFinding } from "../evidence/types.js";
import { nextFindingId } from "../util/id.js";
import { assertSafeSelector } from "../security/paths.js";

export type StickyDiagnostics = {
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  headerRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  targetRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  intersection: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  scrollMarginTop: string | null;
  stabilizationFrames: number;
  detectorVerdict: "occluded" | "clear" | "no-target" | "no-header";
};

/**
 * Wait until layout geometry for sticky measurement is stable for N frames
 * after an intentional scroll (not a blind sleep).
 */
async function waitForStableStickyGeometry(
  page: Page,
  targetSelector: string | undefined,
  frames = 3,
  timeoutMs = 3000,
): Promise<number> {
  return page.evaluate(
    async ({ targetSelector, frames, timeoutMs }) => {
      const sleepFrame = () =>
        new Promise<void>((r) => requestAnimationFrame(() => r()));
      const sample = () => {
        const target = targetSelector
          ? document.querySelector(targetSelector)
          : null;
        const headers = Array.from(document.querySelectorAll("body *")).filter(
          (el) => {
            const style = getComputedStyle(el);
            if (style.position !== "sticky" && style.position !== "fixed")
              return false;
            const r = el.getBoundingClientRect();
            return r.height > 10 && r.top <= 20 && r.width > 50;
          },
        );
        const header = headers[0] ?? null;
        const tr = target?.getBoundingClientRect();
        const hr = header?.getBoundingClientRect();
        return [
          window.scrollX,
          window.scrollY,
          tr?.top ?? null,
          tr?.height ?? null,
          hr?.top ?? null,
          hr?.height ?? null,
        ].join("|");
      };

      const start = performance.now();
      let last = sample();
      let stable = 0;
      let observed = 0;
      while (performance.now() - start < timeoutMs) {
        await sleepFrame();
        observed += 1;
        const cur = sample();
        if (cur === last) stable += 1;
        else {
          stable = 0;
          last = cur;
        }
        if (stable >= frames) return observed;
      }
      return observed;
    },
    { targetSelector: targetSelector ?? null, frames, timeoutMs },
  );
}

export async function detectStickyOcclusion(
  page: Page,
  targetSelector?: string,
): Promise<StickyOcclusionFinding[]> {
  if (targetSelector) assertSafeSelector(targetSelector);

  // Prefer native scrollIntoView so scroll-margin-top is honored after repair.
  if (targetSelector) {
    const locator = page.locator(targetSelector).first();
    await locator.waitFor({ state: "attached", timeout: 10_000 }).catch(() => undefined);
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    // If margin is missing, scrollIntoView may leave the target flush under
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

  const stabilizationFrames = await waitForStableStickyGeometry(
    page,
    targetSelector,
    3,
    3000,
  );

  const raw = await page.evaluate(
    ({ targetSel, stabilizationFrames }) => {
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
          const overlapTop = Math.max(tr.top, hr.top);
          const overlapBottom = Math.min(tr.bottom, hr.bottom);
          const overlapLeft = Math.max(tr.left, hr.left);
          const overlapRight = Math.min(tr.right, hr.right);
          const overlapH = overlapBottom - overlapTop;
          const overlapW = overlapRight - overlapLeft;
          const overlap = overlapH > 0 && overlapW > 0 ? overlapH : 0;

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
              intersection: {
                x: overlapLeft,
                y: overlapTop,
                width: Math.max(0, overlapW),
                height: Math.max(0, overlapH),
              },
              scrollY: window.scrollY,
              scrollX: window.scrollX,
              scrollMarginTop: tStyle.scrollMarginTop,
              obscuredPx: overlap,
              stabilizationFrames,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
            });
          }
        }
      }
      return findings.slice(0, 20);
    },
    { targetSel: targetSelector ?? null, stabilizationFrames },
  );

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

export async function collectStickyDiagnostics(
  page: Page,
  targetSelector?: string,
): Promise<StickyDiagnostics> {
  const findings = await detectStickyOcclusion(page, targetSelector);
  const first = findings[0];
  if (!first) {
    const empty = await page.evaluate((sel) => {
      const target = sel ? document.querySelector(sel) : null;
      const headers = Array.from(document.querySelectorAll("body *")).filter(
        (el) => {
          const style = getComputedStyle(el);
          if (style.position !== "sticky" && style.position !== "fixed")
            return false;
          const r = el.getBoundingClientRect();
          return r.height > 10 && r.top <= 20 && r.width > 50;
        },
      );
      const tr = target?.getBoundingClientRect();
      const hr = headers[0]?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        headerRect: hr
          ? { x: hr.x, y: hr.y, width: hr.width, height: hr.height }
          : null,
        targetRect: tr
          ? { x: tr.x, y: tr.y, width: tr.width, height: tr.height }
          : null,
        scrollMarginTop: target
          ? getComputedStyle(target).scrollMarginTop
          : null,
        hasHeader: headers.length > 0,
        hasTarget: !!target,
      };
    }, targetSelector ?? null);
    return {
      viewport: empty.viewport,
      scrollX: empty.scrollX,
      scrollY: empty.scrollY,
      headerRect: empty.headerRect,
      targetRect: empty.targetRect,
      intersection: null,
      scrollMarginTop: empty.scrollMarginTop,
      stabilizationFrames: 0,
      detectorVerdict: !empty.hasTarget
        ? "no-target"
        : !empty.hasHeader
          ? "no-header"
          : "clear",
    };
  }

  const interTop = Math.max(first.targetRect.y, first.headerRect.y);
  const interBottom = Math.min(
    first.targetRect.y + first.targetRect.height,
    first.headerRect.y + first.headerRect.height,
  );
  const interLeft = Math.max(first.targetRect.x, first.headerRect.x);
  const interRight = Math.min(
    first.targetRect.x + first.targetRect.width,
    first.headerRect.x + first.headerRect.width,
  );

  return {
    viewport: await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
    scrollX: 0,
    scrollY: first.scrollY,
    headerRect: first.headerRect,
    targetRect: first.targetRect,
    intersection: {
      x: interLeft,
      y: interTop,
      width: Math.max(0, interRight - interLeft),
      height: Math.max(0, interBottom - interTop),
    },
    scrollMarginTop: first.scrollMarginTop,
    stabilizationFrames: 3,
    detectorVerdict: "occluded",
  };
}
