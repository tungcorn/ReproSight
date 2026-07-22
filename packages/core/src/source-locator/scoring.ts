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
  if (input.property === "max-width" && /100%/.test(input.value)) score += 30;
  if (input.property === "min-width" && input.value !== "0px") score += 15;
  if (input.property === "width" && /px/.test(input.value)) score += 10;
  if (input.property === "overflow" || input.property.startsWith("overflow-"))
    score += 8;
  if (input.property === "grid-template-columns") score += 18;
  if (input.property === "flex-basis" || input.property === "flex") score += 12;
  if (input.property === "position" && /absolute|fixed/.test(input.value))
    score += 12;
  if (input.property === "z-index") score += 10;
  if (input.property === "scroll-margin-top") score += 20;
  if (input.property === "transform" && input.value !== "none") score += 10;

  // selector proximity
  const simple = input.elementSelector.replace(/^[.#]/, "");
  if (input.selectorText.includes(simple)) score += 25;
  if (input.selectorText.split(",").some((s) => s.trim() === input.elementSelector))
    score += 10;

  // media context: missing media on desktop-looking fixed widths is suspicious for tablet bugs
  if (!input.media && /grid-template-columns|width|min-width/.test(input.property))
    score += 8;
  if (input.media && /min-width:\s*10/.test(input.media)) score += 5;

  if (input.file) score += 15;
  else score -= 10;

  if (input.file && /\.css$/i.test(input.file)) score += 5;

  return score;
}
