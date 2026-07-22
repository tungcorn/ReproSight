import type { Rect } from "./types.js";

export function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function overlapRatio(a: Rect, b: Rect): number {
  const inter = intersectRects(a, b);
  if (!inter) return 0;
  const area = rectArea(a);
  if (area <= 0) return 0;
  return rectArea(inter) / area;
}

export function extendsBeyondViewport(
  rect: Rect,
  viewportWidth: number,
  epsilon = 1,
): { overflows: boolean; amount: number } {
  const right = rect.x + rect.width;
  const amount = Math.max(0, right - viewportWidth);
  return { overflows: amount > epsilon, amount };
}

export function isAncestorPath(parentPath: string, childPath: string): boolean {
  return (
    childPath === parentPath ||
    childPath.startsWith(`${parentPath} > `) ||
    childPath.startsWith(`${parentPath}>`)
  );
}

export function clippingAxes(opts: {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  epsilon?: number;
}): { horizontal: boolean; vertical: boolean } {
  const epsilon = opts.epsilon ?? 1;
  return {
    horizontal: opts.scrollWidth - opts.clientWidth > epsilon,
    vertical: opts.scrollHeight - opts.clientHeight > epsilon,
  };
}
