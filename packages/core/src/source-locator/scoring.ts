function tokensFromSelector(selector: string): string[] {
  const tokens = new Set<string>();
  for (const m of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
    if (m[1]) tokens.add(m[1]);
  }
  for (const m of selector.matchAll(/#([A-Za-z0-9_-]+)/g)) {
    if (m[1]) tokens.add(m[1]);
  }
  return [...tokens];
}

/**
 * Deterministic candidate scoring. Must not hard-code fixture file names,
 * expected line numbers, or case IDs.
 */
export function scoreCandidate(input: {
  property: string;
  value: string;
  computedValue: string;
  selectorText: string;
  elementSelector: string;
  media: string | null;
  file: string | null;
  defectProperties: string[];
}): number {
  let score = 0;

  if (input.defectProperties.includes(input.property)) score += 40;
  if (input.property === "white-space" && /nowrap/i.test(input.value))
    score += 35;
  if (input.property === "max-width") {
    if (/100%/.test(input.value) || /none/i.test(input.value)) score += 30;
  }
  if (input.property === "min-width") {
    if (/none/i.test(input.value)) score += 28;
    else if (input.value !== "0px" && input.value !== "auto") score += 15;
  }
  if (input.property === "width" && /px/.test(input.value)) score += 10;
  if (input.property === "overflow" || input.property.startsWith("overflow-"))
    score += 8;
  if (input.property === "grid-template-columns") {
    score += 18;
    // Fixed multi-track templates without media are high-risk for overflow.
    const fixedTracks = (input.value.match(/\d+px/g) ?? []).length;
    if (fixedTracks >= 2 && !input.media) score += 20;
  }
  if (input.property === "flex-basis" || input.property === "flex") score += 12;
  if (input.property === "position" && /absolute|fixed/.test(input.value))
    score += 12;
  if (input.property === "z-index") score += 10;
  if (input.property === "scroll-margin-top") score += 20;
  if (input.property === "transform" && input.value !== "none") score += 10;
  if (input.property === "outline" && /none/i.test(input.value)) score += 12;
  if (input.property === "color") score += 6;

  // Selector proximity using class/id tokens (generalizable).
  const elementTokens = tokensFromSelector(input.elementSelector);
  const ruleTokens = tokensFromSelector(input.selectorText);
  const shared = elementTokens.filter((t) => ruleTokens.includes(t));
  score += shared.length * 18;
  const simple = input.elementSelector.replace(/^[.#]/, "");
  if (simple && input.selectorText.includes(simple)) score += 25;
  if (
    input.selectorText
      .split(",")
      .some((s) => s.trim() === input.elementSelector)
  ) {
    score += 10;
  }
  // Prefer more specific rules over bare element/type selectors.
  if (ruleTokens.length >= 2) score += 6;
  if (input.selectorText.includes(" ") || input.selectorText.includes(">"))
    score += 4;

  // Media context signals
  if (
    !input.media &&
    /grid-template-columns|width|min-width|max-width/.test(input.property)
  ) {
    score += 8;
  }
  if (input.media && /min-width:\s*\d+/.test(input.media)) score += 5;

  if (input.file) score += 15;
  else score -= 10;

  if (input.file && /\.css$/i.test(input.file)) score += 5;

  // Prefer authored values that still match the computed suspicious value.
  if (
    input.computedValue &&
    input.value &&
    input.computedValue.replace(/\s+/g, "") ===
      input.value.replace(/\s+/g, "")
  ) {
    score += 5;
  }

  return score;
}
