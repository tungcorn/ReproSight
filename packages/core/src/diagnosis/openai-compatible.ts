import {
  type DiagnosisInput,
  type DiagnosisResult,
  type ModelClient,
  parseDiagnosisOutput,
} from "./types.js";
import { SYSTEM_PROMPT, buildDiagnosisUserPayload } from "./prompt.js";

export type OpenAICompatibleOptions = {
  baseUrl: string;
  model: string;
  apiKeyEnvVar?: string;
  enableScreenshotInput?: boolean;
  fetchImpl?: typeof fetch;
};

/**
 * Provider-neutral OpenAI-compatible chat completions client.
 * Does not hard-code a paid vendor; base URL and model are configurable.
 */
export class OpenAICompatibleModelClient implements ModelClient {
  readonly name = "openai-compatible";
  private readonly opts: Required<
    Pick<OpenAICompatibleOptions, "baseUrl" | "model" | "apiKeyEnvVar">
  > &
    OpenAICompatibleOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = {
      apiKeyEnvVar: "OPENAI_API_KEY",
      enableScreenshotInput: false,
      ...opts,
    };
  }

  async diagnoseAndProposePatch(
    input: DiagnosisInput,
  ): Promise<DiagnosisResult> {
    const apiKey = process.env[this.opts.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(
        `Missing API key env var ${this.opts.apiKeyEnvVar} (value not logged)`,
      );
    }

    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          "Diagnose the visual defect and propose a minimal unified diff. Respond with JSON only.\n\n" +
          buildDiagnosisUserPayload(input),
      },
    ];

    // Screenshots only when explicitly enabled; still no secret logging
    if (this.opts.enableScreenshotInput && input.evidence.screenshots.before) {
      userContent.push({
        type: "text",
        text: `Screenshot path (local evidence, not uploaded unless provider supports files): ${input.evidence.screenshots.before}`,
      });
    }

    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Model provider HTTP ${res.status}: ${body.slice(0, 400)}`,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Model provider returned empty content");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Model provider returned non-JSON content");
    }

    const output = parseDiagnosisOutput(parsed);
    return {
      output,
      usage: {
        provider: this.name,
        model: data.model ?? this.opts.model,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
    };
  }
}
