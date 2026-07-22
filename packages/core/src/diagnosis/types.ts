import { z } from "zod";
import type { EvidencePack } from "../evidence/types.js";
import type { IssueSpec } from "../scenario/issue.js";
import type { ReproSightConfig } from "../config/schema.js";

export const scenarioSuggestionSchema = z.object({
  name: z.string(),
  route: z.string().optional(),
  viewport: z
    .object({ width: z.number(), height: z.number() })
    .optional(),
  locale: z.string().optional(),
  theme: z.enum(["dark", "light"]).optional(),
  reason: z.string(),
});

export const diagnosisOutputSchema = z.object({
  reproduced: z.boolean(),
  summary: z.string().min(1),
  rootCause: z.object({
    confidence: z.number().min(0).max(1),
    elementSelectors: z.array(z.string()),
    sourceCandidates: z.array(
      z.object({
        file: z.string(),
        line: z.number().int().positive().optional(),
        selector: z.string().optional(),
        properties: z.array(z.string()),
        explanation: z.string(),
      }),
    ),
  }),
  patch: z.object({
    unifiedDiff: z.string().nullable(),
    rationale: z.string(),
    filesExpected: z.array(z.string()),
  }),
  regressionScenarios: z.array(scenarioSuggestionSchema),
  abstainReason: z.string().nullable(),
});

export type DiagnosisOutput = z.infer<typeof diagnosisOutputSchema>;
export type ScenarioSuggestion = z.infer<typeof scenarioSuggestionSchema>;

export type DiagnosisInput = {
  issue: IssueSpec;
  config: ReproSightConfig;
  evidence: EvidencePack;
  sourceSnippets: Array<{ file: string; startLine: number; text: string }>;
};

export type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  model?: string;
  provider: string;
};

export type DiagnosisResult = {
  output: DiagnosisOutput;
  usage: ModelUsage;
  rawRejected?: string;
};

export interface ModelClient {
  readonly name: string;
  diagnoseAndProposePatch(input: DiagnosisInput): Promise<DiagnosisResult>;
}

export function parseDiagnosisOutput(input: unknown): DiagnosisOutput {
  const result = diagnosisOutputSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid diagnosis output:\n${details}`);
  }
  return result.data;
}
