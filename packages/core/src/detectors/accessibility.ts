import type { Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import type { AxeViolationSummary } from "../evidence/types.js";

export async function runAxe(page: Page): Promise<{
  violations: AxeViolationSummary[];
  incomplete: number;
  passes: number;
  raw: unknown;
  note: string;
}> {
  const results = await new AxeBuilder({ page }).analyze();
  return {
    violations: results.violations.map(
      (v: {
        id: string;
        impact?: string | null;
        description: string;
        help: string;
        helpUrl: string;
        nodes: unknown[];
      }) => ({
        id: v.id,
        impact: v.impact ?? null,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
      }),
    ),
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    raw: results,
    note: "Automated axe findings are not a complete manual accessibility audit.",
  };
}
