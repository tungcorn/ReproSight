import type { Page, CDPSession } from "playwright";
import path from "node:path";
import type { SourceCandidate } from "../evidence/types.js";
import { scoreCandidate } from "./scoring.js";

const INTERESTING_PROPS = new Set([
  "display",
  "position",
  "left",
  "right",
  "top",
  "bottom",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "overflow",
  "overflow-x",
  "overflow-y",
  "white-space",
  "flex",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "grid-template-columns",
  "grid-column",
  "gap",
  "padding",
  "margin",
  "transform",
  "z-index",
  "scroll-margin-top",
]);

export type LocalizationContext = {
  repoPath: string;
  readyUrl: string;
  defectHints: Array<{
    selector: string;
    properties?: string[];
    reason?: string;
  }>;
};

function mapStylesheetUrlToRepoPath(
  stylesheetUrl: string | undefined,
  readyUrl: string,
  repoPath: string,
): string | null {
  if (!stylesheetUrl) return null;
  if (stylesheetUrl.startsWith("blob:") || stylesheetUrl === "injected") {
    return null;
  }
  try {
    const base = new URL(readyUrl);
    const u = new URL(stylesheetUrl, readyUrl);
    if (u.origin !== base.origin) {
      // file:// or other
      if (u.protocol === "file:") {
        const fp = decodeURIComponent(u.pathname);
        const normalized =
          process.platform === "win32" && fp.startsWith("/")
            ? fp.slice(1)
            : fp;
        const rel = path.relative(repoPath, normalized).replace(/\\/g, "/");
        if (!rel.startsWith("..")) return rel;
      }
      return null;
    }
    let p = decodeURIComponent(u.pathname);
    // strip leading slash
    if (p.startsWith("/")) p = p.slice(1);
    // common static servers serve repo root
    return p || null;
  } catch {
    return null;
  }
}

async function collectForSelector(
  client: CDPSession,
  page: Page,
  selector: string,
  ctx: LocalizationContext,
): Promise<SourceCandidate[]> {
  const backendNodeId = await page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    // mark element for CDP resolution via objectId path is complex; use CSS.collect + DOM
    (el as HTMLElement).setAttribute("data-reprosight-probe", "1");
    return true;
  }, selector);

  if (!backendNodeId) return [];

  const doc = (await client.send("DOM.getDocument", {
    depth: 0,
  })) as { root: { nodeId: number } };

  const { nodeId } = (await client.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: `${selector}, [data-reprosight-probe="1"]`,
  })) as { nodeId: number };

  await page.evaluate(() => {
    document
      .querySelectorAll("[data-reprosight-probe]")
      .forEach((el) => el.removeAttribute("data-reprosight-probe"));
  });

  if (!nodeId) return [];

  const matched = (await client.send("CSS.getMatchedStylesForNode", {
    nodeId,
  })) as {
    matchedCSSRules?: Array<{
      rule?: {
        selectorList?: { text?: string };
        style?: {
          cssProperties?: Array<{
            name: string;
            value: string;
            disabled?: boolean;
          }>;
          range?: { startLine: number; endLine: number };
          styleSheetId?: string;
        };
        origin?: string;
        media?: Array<{ text?: string }>;
      };
      matchingSelectors?: number[];
    }>;
    inlineStyle?: {
      cssProperties?: Array<{ name: string; value: string }>;
    };
  };

  const computed = (await client.send("CSS.getComputedStyleForNode", {
    nodeId,
  })) as {
    computedStyle: Array<{ name: string; value: string }>;
  };
  const computedMap = new Map(
    computed.computedStyle.map((c) => [c.name, c.value]),
  );

  const candidates: SourceCandidate[] = [];

  for (const m of matched.matchedCSSRules ?? []) {
    const rule = m.rule;
    if (!rule?.style) continue;
    if (rule.origin === "user-agent") continue;
    const selectorText = rule.selectorList?.text ?? "";
    const media =
      rule.media?.map((x) => x.text).filter(Boolean).join(", ") || null;
    const styleSheetId = rule.style.styleSheetId;
    let href: string | null = null;
    let line: number | null =
      rule.style.range != null ? rule.style.range.startLine + 1 : null;
    let lineEnd: number | null =
      rule.style.range != null ? rule.style.range.endLine + 1 : null;

    if (styleSheetId) {
      try {
        const sheet = (await client.send("CSS.getStyleSheetText", {
          styleSheetId,
        })) as { text: string };
        void sheet;
        const header = (await client.send("CSS.collectClassNames", {
          styleSheetId,
        }).catch(() => null)) as unknown;
        void header;
      } catch {
        // ignore
      }
      try {
        // get header via CSS.getStyleSheetText + tracked headers
        const all = (await client.send("CSS.getMediaQueries")) as unknown;
        void all;
      } catch {
        // ignore
      }
    }

    // Resolve stylesheet URL via DOM.getNodeForLocation is not used; use CSS style sheet headers cache
    href = await resolveStylesheetUrl(client, styleSheetId);

    const file = mapStylesheetUrlToRepoPath(
      href ?? undefined,
      ctx.readyUrl,
      ctx.repoPath,
    );

    for (const prop of rule.style.cssProperties ?? []) {
      if (prop.disabled) continue;
      if (!INTERESTING_PROPS.has(prop.name)) continue;
      const computedValue = computedMap.get(prop.name) ?? prop.value;
      const hint = ctx.defectHints.find((h) =>
        selector.includes(h.selector.replace(/^[.#]/, "")) ||
        h.selector === selector,
      );
      const reasonParts = [
        `Matched rule ${selectorText} sets ${prop.name}:${prop.value}`,
        media ? `media(${media})` : null,
        hint?.reason ?? null,
      ].filter(Boolean);

      const score = scoreCandidate({
        property: prop.name,
        value: prop.value,
        computedValue,
        selectorText,
        elementSelector: selector,
        media,
        file,
        defectProperties: hint?.properties ?? [],
      });

      candidates.push({
        elementSelector: selector,
        file,
        line,
        lineEnd,
        selector: selectorText,
        media,
        property: prop.name,
        value: prop.value,
        computedValue,
        reason: reasonParts.join("; "),
        rank: 0,
        score,
        stylesheetUrl: href,
      });
    }
  }

  // inline styles
  for (const prop of matched.inlineStyle?.cssProperties ?? []) {
    if (!INTERESTING_PROPS.has(prop.name)) continue;
    candidates.push({
      elementSelector: selector,
      file: null,
      line: null,
      lineEnd: null,
      selector: "element.style",
      media: null,
      property: prop.name,
      value: prop.value,
      computedValue: computedMap.get(prop.name) ?? prop.value,
      reason: "Inline style declaration",
      rank: 0,
      score: scoreCandidate({
        property: prop.name,
        value: prop.value,
        computedValue: computedMap.get(prop.name) ?? prop.value,
        selectorText: "element.style",
        elementSelector: selector,
        media: null,
        file: null,
        defectProperties: [],
      }),
      stylesheetUrl: null,
    });
  }

  return candidates;
}

const sheetUrlCache = new WeakMap<CDPSession, Map<string, string>>();

async function resolveStylesheetUrl(
  client: CDPSession,
  styleSheetId?: string,
): Promise<string | null> {
  if (!styleSheetId) return null;
  let cache = sheetUrlCache.get(client);
  if (!cache) {
    cache = new Map();
    sheetUrlCache.set(client, cache);
    client.on("CSS.styleSheetAdded", (evt: { header?: { styleSheetId?: string; sourceURL?: string } }) => {
      const id = evt.header?.styleSheetId;
      const url = evt.header?.sourceURL;
      if (id && url) cache!.set(id, url);
    });
    try {
      // enable already called; pull via getMatched already populated events
    } catch {
      // ignore
    }
  }
  return cache.get(styleSheetId) ?? null;
}

export async function localizeSources(
  page: Page,
  ctx: LocalizationContext,
): Promise<SourceCandidate[]> {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");

  // Seed stylesheet URL cache from added events going forward + probe
  const cache = new Map<string, string>();
  sheetUrlCache.set(client, cache);
  client.on(
    "CSS.styleSheetAdded",
    (evt: { header?: { styleSheetId?: string; sourceURL?: string } }) => {
      if (evt.header?.styleSheetId && evt.header.sourceURL) {
        cache.set(evt.header.styleSheetId, evt.header.sourceURL);
      }
    },
  );

  // Force style recalc / sheet discovery
  await page.evaluate(() => document.styleSheets.length);

  const selectors = [
    ...new Set(ctx.defectHints.map((h) => h.selector).filter(Boolean)),
  ];
  // Also try simplified selectors from hints
  const expanded: string[] = [];
  for (const s of selectors) {
    expanded.push(s);
    const simple = s.split(">").pop()?.trim();
    if (simple && simple !== s) expanded.push(simple);
    const idMatch = s.match(/#[A-Za-z0-9_-]+/);
    if (idMatch) expanded.push(idMatch[0]!);
    const classMatch = s.match(/\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/);
    if (classMatch) expanded.push(classMatch[0]!);
  }

  const all: SourceCandidate[] = [];
  for (const sel of [...new Set(expanded)].slice(0, 12)) {
    try {
      const part = await collectForSelector(client, page, sel, ctx);
      all.push(...part);
    } catch {
      // selector may not resolve
    }
  }

  // Fallback: if CDP matched rules lacked URLs, parse document.styleSheets from page
  if (all.every((c) => !c.file)) {
    const pageCandidates = await localizeFromDomStylesheets(page, ctx);
    all.push(...pageCandidates);
  } else {
    // fill missing files via page stylesheet index by selector text
    const pageIndex = await indexPageStyles(page, ctx);
    for (const c of all) {
      if (!c.file) {
        const hit = pageIndex.find(
          (p) =>
            p.selector === c.selector &&
            p.property === c.property &&
            p.value === c.value,
        );
        if (hit) {
          c.file = hit.file;
          c.line = hit.line;
          c.lineEnd = hit.lineEnd;
          c.stylesheetUrl = hit.stylesheetUrl;
        }
      }
    }
  }

  all.sort((a, b) => b.score - a.score);
  all.forEach((c, i) => {
    c.rank = i + 1;
  });

  await client.detach().catch(() => undefined);
  return all.slice(0, 40);
}

async function indexPageStyles(
  page: Page,
  ctx: LocalizationContext,
): Promise<SourceCandidate[]> {
  const raw = await page.evaluate(() => {
    const out: Array<Record<string, string | number | null>> = [];
    const sheets = Array.from(document.styleSheets);
    for (const sheet of sheets) {
      let href = sheet.href;
      let rules: CSSRuleList | undefined;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      const walk = (ruleList: CSSRuleList, media: string | null) => {
        for (const rule of Array.from(ruleList)) {
          if (rule instanceof CSSMediaRule) {
            walk(rule.cssRules, rule.conditionText);
          } else if (rule instanceof CSSStyleRule) {
            const style = rule.style;
            for (let i = 0; i < style.length; i++) {
              const prop = style.item(i);
              out.push({
                selector: rule.selectorText,
                property: prop,
                value: style.getPropertyValue(prop).trim(),
                media,
                href,
                // cssText line numbers not available; leave null
              });
            }
          }
        }
      };
      walk(rules, null);
    }
    return out;
  });

  return raw.map((r, idx) => {
    const file = mapStylesheetUrlToRepoPath(
      (r.href as string) || undefined,
      ctx.readyUrl,
      ctx.repoPath,
    );
    const property = String(r.property);
    const value = String(r.value);
    const selectorText = String(r.selector);
    const score = scoreCandidate({
      property,
      value,
      computedValue: value,
      selectorText,
      elementSelector: selectorText,
      media: (r.media as string) || null,
      file,
      defectProperties: [],
    });
    return {
      elementSelector: selectorText,
      file,
      line: null,
      lineEnd: null,
      selector: selectorText,
      media: (r.media as string) || null,
      property,
      value,
      computedValue: value,
      reason: "Collected from document.styleSheets",
      rank: idx + 1,
      score,
      stylesheetUrl: (r.href as string) || null,
    } satisfies SourceCandidate;
  });
}

async function localizeFromDomStylesheets(
  page: Page,
  ctx: LocalizationContext,
): Promise<SourceCandidate[]> {
  const index = await indexPageStyles(page, ctx);
  // boost if selector matches defect hints
  for (const c of index) {
    for (const h of ctx.defectHints) {
      const simple = h.selector.replace(/^[.#]/, "");
      if (
        c.selector.includes(simple) ||
        c.elementSelector.includes(h.selector)
      ) {
        c.score += 20;
        if (h.properties?.includes(c.property)) c.score += 30;
        if (h.reason) c.reason = h.reason;
      }
    }
  }
  index.sort((a, b) => b.score - a.score);
  index.forEach((c, i) => {
    c.rank = i + 1;
  });
  return index.slice(0, 40);
}

export async function readSourceSnippets(
  repoPath: string,
  candidates: SourceCandidate[],
  max = 6,
): Promise<Array<{ file: string; startLine: number; text: string }>> {
  const fs = await import("node:fs/promises");
  const snippets: Array<{ file: string; startLine: number; text: string }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c.file || seen.has(c.file)) continue;
    seen.add(c.file);
    const full = path.join(repoPath, c.file);
    try {
      const text = await fs.readFile(full, "utf8");
      const lines = text.split(/\r?\n/);
      const center = c.line ?? 1;
      const start = Math.max(1, center - 8);
      const end = Math.min(lines.length, center + 12);
      snippets.push({
        file: c.file,
        startLine: start,
        text: lines
          .slice(start - 1, end)
          .map((l, i) => `${start + i}| ${l}`)
          .join("\n"),
      });
    } catch {
      snippets.push({
        file: c.file,
        startLine: c.line ?? 0,
        text: "[source file not readable from repo path]",
      });
    }
    if (snippets.length >= max) break;
  }
  return snippets;
}
