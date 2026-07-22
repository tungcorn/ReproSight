import type { Page } from "playwright";
import type { ClippingFinding } from "../evidence/types.js";
import { nextFindingId } from "../util/id.js";

export async function detectTextClipping(
  page: Page,
  ignoreSelectors: string[],
  allowEllipsis = true,
): Promise<ClippingFinding[]> {
  const raw = await page.evaluate(
    ({ ignores, allowEllipsis }) => {
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

      const findings: Array<Record<string, unknown>> = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (isIgnored(el)) continue;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const htmlEl = el as HTMLElement;
        const scrollWidth = htmlEl.scrollWidth;
        const clientWidth = htmlEl.clientWidth;
        const scrollHeight = htmlEl.scrollHeight;
        const clientHeight = htmlEl.clientHeight;
        const overflowX = style.overflowX;
        const overflowY = style.overflowY;
        const clippedX =
          scrollWidth - clientWidth > 1 &&
          (overflowX === "hidden" ||
            overflowX === "clip" ||
            overflowX === "scroll" ||
            overflowX === "auto");
        const clippedY =
          scrollHeight - clientHeight > 1 &&
          (overflowY === "hidden" ||
            overflowY === "clip" ||
            overflowY === "scroll" ||
            overflowY === "auto");
        if (!clippedX && !clippedY) continue;

        const lineClamp =
          style.getPropertyValue("-webkit-line-clamp") ||
          style.getPropertyValue("line-clamp") ||
          "";
        const intentionalEllipsis =
          allowEllipsis &&
          (style.textOverflow === "ellipsis" ||
            (lineClamp && lineClamp !== "none"));
        if (intentionalEllipsis) continue;

        const rect = el.getBoundingClientRect();
        findings.push({
          selector: cssPath(el),
          domPath: cssPath(el),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          scrollWidth,
          clientWidth,
          scrollHeight,
          clientHeight,
          overflowX,
          overflowY,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          lineClamp,
          ignored: false,
        });
      }
      return findings.slice(0, 25);
    },
    { ignores: ignoreSelectors, allowEllipsis },
  );

  return raw.map((r) => ({
    id: nextFindingId("clip"),
    kind: "textClipping" as const,
    selector: String(r.selector),
    domPath: String(r.domPath),
    rect: r.rect as ClippingFinding["rect"],
    scrollWidth: Number(r.scrollWidth),
    clientWidth: Number(r.clientWidth),
    scrollHeight: Number(r.scrollHeight),
    clientHeight: Number(r.clientHeight),
    overflowX: String(r.overflowX),
    overflowY: String(r.overflowY),
    textOverflow: String(r.textOverflow),
    whiteSpace: String(r.whiteSpace),
    lineClamp: String(r.lineClamp),
    ignored: Boolean(r.ignored),
  }));
}
