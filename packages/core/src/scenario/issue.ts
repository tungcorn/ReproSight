import { z } from "zod";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("goto"),
    url: z.string().min(1),
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string().min(1),
  }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal("press"),
    key: z.string().min(1),
  }),
  z.object({
    type: z.literal("hover"),
    selector: z.string().min(1),
  }),
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

const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noHorizontalOverflow") }),
  z.object({
    type: z.literal("selectorWithinViewport"),
    selector: z.string().min(1),
  }),
  z.object({
    type: z.literal("noOverlap"),
    a: z.string().min(1),
    b: z.string().min(1),
  }),
  z.object({
    type: z.literal("noTextClipping"),
    selector: z.string().optional(),
  }),
  z.object({
    type: z.literal("noStickyOcclusion"),
    selector: z.string().min(1),
  }),
]);

export const issueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  route: z.string().min(1).default("/"),
  state: z.object({
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    locale: z.string().min(1).default("en"),
    theme: z.enum(["dark", "light"]).default("dark"),
  }),
  actions: z.array(actionSchema).default([]),
  assertions: z.array(assertionSchema).default([{ type: "noHorizontalOverflow" }]),
  screenshot: z.string().nullable().default(null),
  region: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .nullable()
    .default(null),
  expected: z
    .object({
      detector: z
        .enum([
          "horizontalOverflow",
          "overlap",
          "textClipping",
          "stickyOcclusion",
          "accessibility",
        ])
        .optional(),
      culpritSelector: z.string().optional(),
      sourceFile: z.string().optional(),
      sourceLine: z.number().int().positive().optional(),
      sourceLineEnd: z.number().int().positive().optional(),
      property: z.string().optional(),
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    })
    .optional(),
});

export type IssueSpec = z.infer<typeof issueSchema>;
export type IssueAction = z.infer<typeof actionSchema>;
export type IssueAssertion = z.infer<typeof assertionSchema>;

export function parseIssue(input: unknown): IssueSpec {
  const result = issueSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid issue specification:\n${details}`);
  }
  return result.data;
}
