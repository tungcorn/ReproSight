import { z } from "zod";
import { ALLOWED_ACTIONS, DETECTOR_CATEGORIES } from "./statuses.js";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), url: z.string().min(1) }),
  z.object({ type: z.literal("click"), selector: z.string().min(1) }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({ type: z.literal("press"), key: z.string().min(1) }),
  z.object({ type: z.literal("hover"), selector: z.string().min(1) }),
  z.object({
    type: z.literal("scrollIntoView"),
    selector: z.string().min(1),
  }),
  z.object({
    type: z.literal("waitForSelector"),
    selector: z.string().min(1),
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
  }),
]);

export const agentRequestSchema = z
  .object({
    version: z.literal(1).default(1),
    repository: z
      .object({
        path: z.string().min(1).default("."),
        baseRef: z.string().min(1).optional(),
      })
      .default({ path: "." }),
    task: z.object({
      description: z.string().min(1),
      screenshot: z.string().optional().nullable(),
    }),
    stateHints: z
      .object({
        route: z.string().optional(),
        viewport: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .optional(),
        locale: z.string().optional(),
        theme: z.enum(["dark", "light"]).optional(),
      })
      .optional(),
    projectHints: z
      .object({
        packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]).optional(),
        installCommand: z.string().optional(),
        startCommand: z.string().optional(),
        readyUrl: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    reproductionHints: z
      .object({
        category: z.enum(DETECTOR_CATEGORIES).optional(),
        actions: z.array(actionSchema).optional(),
        suspectedSelectors: z.array(z.string()).optional(),
        assertions: z
          .array(
            z.object({
              type: z.string(),
              selector: z.string().optional(),
              a: z.string().optional(),
              b: z.string().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    execution: z
      .object({
        mode: z
          .enum(["external-agent-repair", "standalone"])
          .default("external-agent-repair"),
        headed: z.boolean().default(false),
        keepWorkspaceOnFailure: z.boolean().default(true),
        noPatch: z.boolean().default(true),
      })
      .default({}),
  })
  .superRefine((req, ctx) => {
    const actions = req.reproductionHints?.actions ?? [];
    for (const a of actions) {
      if (!ALLOWED_ACTIONS.includes(a.type as (typeof ALLOWED_ACTIONS)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reproductionHints", "actions"],
          message: `Unsupported action type: ${(a as { type: string }).type}`,
        });
      }
    }
  });

export type AgentRequest = z.infer<typeof agentRequestSchema>;

export function parseAgentRequest(input: unknown): AgentRequest {
  const result = agentRequestSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid agent request:\n${details}`);
  }
  return result.data;
}

export function agentRequestJsonSchema(): Record<string, unknown> {
  // Hand-maintained subset aligned with Zod (stable for agents)
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "reprosight-agent-request",
    title: "ReproSight Agent Request",
    type: "object",
    required: ["task"],
    additionalProperties: false,
    properties: {
      version: { const: 1, default: 1 },
      repository: {
        type: "object",
        properties: {
          path: { type: "string", default: "." },
          baseRef: { type: "string" },
        },
      },
      task: {
        type: "object",
        required: ["description"],
        properties: {
          description: { type: "string", minLength: 1 },
          screenshot: { type: ["string", "null"] },
        },
      },
      stateHints: {
        type: "object",
        properties: {
          route: { type: "string" },
          viewport: {
            type: "object",
            properties: {
              width: { type: "integer", exclusiveMinimum: 0 },
              height: { type: "integer", exclusiveMinimum: 0 },
            },
            required: ["width", "height"],
          },
          locale: { type: "string" },
          theme: { enum: ["dark", "light"] },
        },
      },
      projectHints: {
        type: "object",
        properties: {
          packageManager: { enum: ["npm", "pnpm", "yarn", "bun"] },
          installCommand: { type: "string" },
          startCommand: { type: "string" },
          readyUrl: { type: "string" },
          name: { type: "string" },
        },
      },
      reproductionHints: {
        type: "object",
        properties: {
          category: { enum: [...DETECTOR_CATEGORIES] },
          actions: { type: "array" },
          suspectedSelectors: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      execution: {
        type: "object",
        properties: {
          mode: {
            enum: ["external-agent-repair", "standalone"],
            default: "external-agent-repair",
          },
          headed: { type: "boolean", default: false },
          keepWorkspaceOnFailure: { type: "boolean", default: true },
          noPatch: { type: "boolean", default: true },
        },
      },
    },
  };
}
