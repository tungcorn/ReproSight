import { z } from "zod";

const viewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const setupStrategySchema = z.object({
  strategy: z.enum(["selector", "none"]).default("none"),
  selector: z.string().optional(),
});

export const reprosightConfigSchema = z
  .object({
    project: z.object({
      name: z.string().min(1),
      repoPath: z.string().min(1),
      baseRef: z.string().min(1).default("HEAD"),
    }),
    commands: z.object({
      install: z.string().min(1).default("npm ci"),
      start: z.string().min(1),
      test: z.string().optional(),
      build: z.string().optional(),
    }),
    server: z.object({
      readyUrl: z.string().url(),
      timeoutMs: z.number().int().positive().default(60_000),
    }),
    browser: z
      .object({
        name: z.literal("chromium").default("chromium"),
        headless: z.boolean().default(true),
        colorScheme: z.enum(["dark", "light", "no-preference"]).default("dark"),
        deviceScaleFactor: z.number().positive().default(1),
      })
      .default({}),
    routes: z.array(z.string().min(1)).min(1).default(["/"]),
    states: z
      .object({
        viewports: z.array(viewportSchema).min(1),
        locales: z.array(z.string().min(1)).min(1).default(["en"]),
        themes: z.array(z.enum(["dark", "light"])).min(1).default(["dark"]),
      })
      .default({
        viewports: [
          { name: "desktop", width: 1440, height: 900 },
          { name: "tablet", width: 768, height: 1024 },
          { name: "mobile", width: 390, height: 844 },
        ],
        locales: ["en"],
        themes: ["dark"],
      }),
    setup: z
      .object({
        locale: setupStrategySchema.default({ strategy: "none" }),
        theme: setupStrategySchema.default({ strategy: "none" }),
      })
      .default({}),
    stabilization: z
      .object({
        waitForFonts: z.boolean().default(true),
        waitForImages: z.boolean().default(true),
        disableAnimations: z.boolean().default(true),
        settleFrames: z.number().int().positive().default(2),
        timeoutMs: z.number().int().positive().default(10_000),
      })
      .default({}),
    detectors: z
      .object({
        horizontalOverflow: z.boolean().default(true),
        overlap: z.boolean().default(true),
        textClipping: z.boolean().default(true),
        stickyOcclusion: z.boolean().default(true),
        accessibility: z.boolean().default(true),
      })
      .default({}),
    ignores: z
      .object({
        selectors: z.array(z.string()).default([]),
        overlapPairs: z
          .array(z.object({ a: z.string(), b: z.string() }))
          .default([]),
      })
      .default({}),
    patchPolicy: z
      .object({
        allowedGlobs: z
          .array(z.string())
          .default([
            "src/**/*.{css,scss,html,tsx,ts,jsx,js}",
            "public/**/*.html",
            "css/**/*.css",
            "*.css",
            "*.html",
          ]),
        deniedGlobs: z
          .array(z.string())
          .default([
            ".env*",
            "**/node_modules/**",
            "**/dist/**",
            "**/.git/**",
            "**/*lock*",
            "**/package-lock.json",
            "**/pnpm-lock.yaml",
            "**/yarn.lock",
          ]),
        maxFiles: z.number().int().positive().default(3),
        maxAddedLines: z.number().int().positive().default(120),
        maxDeletedLines: z.number().int().positive().default(120),
      })
      .default({}),
    regressionMatrix: z
      .object({
        includeAllConfiguredStates: z.boolean().default(true),
      })
      .default({}),
    worktree: z
      .object({
        preserveOnFailure: z.boolean().default(true),
      })
      .default({}),
  })
  .superRefine((cfg, ctx) => {
    if (
      cfg.setup.locale.strategy === "selector" &&
      !cfg.setup.locale.selector
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["setup", "locale", "selector"],
        message: "locale.selector is required when strategy is 'selector'",
      });
    }
    if (cfg.setup.theme.strategy === "selector" && !cfg.setup.theme.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["setup", "theme", "selector"],
        message: "theme.selector is required when strategy is 'selector'",
      });
    }
  });

export type ReproSightConfig = z.infer<typeof reprosightConfigSchema>;

export function parseConfig(input: unknown): ReproSightConfig {
  const result = reprosightConfigSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid ReproSight config:\n${details}`);
  }
  return result.data;
}
