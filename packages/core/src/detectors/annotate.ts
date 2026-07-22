import { PNG } from "pngjs";
import type {
  ClippingFinding,
  OverflowFinding,
  OverlapFinding,
  StickyOcclusionFinding,
  Rect,
} from "../evidence/types.js";

function drawRect(
  png: PNG,
  rect: Rect,
  color: [number, number, number, number],
  thickness = 2,
): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width - 1, Math.floor(rect.x + rect.width));
  const y1 = Math.min(png.height - 1, Math.floor(rect.y + rect.height));

  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const idx = (png.width * y + x) << 2;
    png.data[idx] = color[0]!;
    png.data[idx + 1] = color[1]!;
    png.data[idx + 2] = color[2]!;
    png.data[idx + 3] = color[3]!;
  };

  for (let t = 0; t < thickness; t++) {
    for (let x = x0; x <= x1; x++) {
      set(x, y0 + t);
      set(x, y1 - t);
    }
    for (let y = y0; y <= y1; y++) {
      set(x0 + t, y);
      set(x1 - t, y);
    }
  }
}

function fillRect(
  png: PNG,
  rect: Rect,
  color: [number, number, number, number],
): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width - 1, Math.floor(rect.x + rect.width));
  const y1 = Math.min(png.height - 1, Math.floor(rect.y + rect.height));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (png.width * y + x) << 2;
      // blend
      const a = color[3]! / 255;
      png.data[idx] = Math.round(png.data[idx]! * (1 - a) + color[0]! * a);
      png.data[idx + 1] = Math.round(
        png.data[idx + 1]! * (1 - a) + color[1]! * a,
      );
      png.data[idx + 2] = Math.round(
        png.data[idx + 2]! * (1 - a) + color[2]! * a,
      );
      png.data[idx + 3] = 255;
    }
  }
}

export function annotateScreenshot(
  pngBuffer: Buffer,
  findings: {
    overflow?: OverflowFinding[];
    overlap?: OverlapFinding[];
    clipping?: ClippingFinding[];
    sticky?: StickyOcclusionFinding[];
    region?: Rect | null;
  },
): Buffer {
  const png = PNG.sync.read(pngBuffer);

  for (const f of findings.overflow ?? []) {
    drawRect(png, f.rect, [220, 38, 38, 255], 3);
  }
  for (const f of findings.overlap ?? []) {
    fillRect(png, f.intersection, [245, 158, 11, 90]);
    drawRect(png, f.intersection, [245, 158, 11, 255], 2);
  }
  for (const f of findings.clipping ?? []) {
    drawRect(png, f.rect, [37, 99, 235, 255], 2);
  }
  for (const f of findings.sticky ?? []) {
    fillRect(png, f.headerRect, [147, 51, 234, 60]);
    drawRect(png, f.targetRect, [147, 51, 234, 255], 2);
  }
  if (findings.region) {
    drawRect(png, findings.region, [16, 185, 129, 255], 2);
  }

  return PNG.sync.write(png);
}

export function diffScreenshots(
  beforeBuf: Buffer,
  afterBuf: Buffer,
): { diff: Buffer; changedPixels: number; ratio: number } {
  const img1 = PNG.sync.read(beforeBuf);
  const img2 = PNG.sync.read(afterBuf);
  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  const diff = new PNG({ width, height });

  // lightweight pixelmatch-like comparison without requiring default export quirks
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      // map from possibly different strides
      const i1 = (img1.width * y + x) << 2;
      const i2 = (img2.width * y + x) << 2;
      const dr = Math.abs(img1.data[i1]! - img2.data[i2]!);
      const dg = Math.abs(img1.data[i1 + 1]! - img2.data[i2 + 1]!);
      const db = Math.abs(img1.data[i1 + 2]! - img2.data[i2 + 2]!);
      if (dr + dg + db > 30) {
        changed += 1;
        diff.data[i] = 255;
        diff.data[i + 1] = 0;
        diff.data[i + 2] = 0;
        diff.data[i + 3] = 255;
      } else {
        const v = img1.data[i1]!;
        diff.data[i] = v;
        diff.data[i + 1] = v;
        diff.data[i + 2] = v;
        diff.data[i + 3] = 80;
      }
    }
  }

  const total = width * height || 1;
  return {
    diff: PNG.sync.write(diff),
    changedPixels: changed,
    ratio: changed / total,
  };
}
