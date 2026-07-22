#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import {
  loadConfig,
  loadIssueFile,
  runFullPipeline,
  RunStore,
  defaultReproRoot,
  removeWorktree,
  parseIssue,
  parseConfig,
} from "@reprosight/core";

const program = new Command();

program
  .name("reprosight")
  .description("Evidence-driven AI visual repair")
  .version("0.1.0");

program
  .command("init")
  .description("Create a sample reprosight.config.json and example issue")
  .option("--dir <dir>", "target directory", ".")
  .action(async (opts: { dir: string }) => {
    const dir = path.resolve(opts.dir);
    const configPath = path.join(dir, "reprosight.config.json");
    const sample = {
      project: {
        name: "my-app",
        repoPath: dir,
        baseRef: "HEAD",
      },
      commands: {
        install: "npm ci",
        start: "npx --yes serve -l 4173 .",
        test: "npm test",
        build: "npm run build",
      },
      server: {
        readyUrl: "http://127.0.0.1:4173",
        timeoutMs: 60000,
      },
      routes: ["/"],
      states: {
        viewports: [
          { name: "desktop", width: 1440, height: 900 },
          { name: "tablet", width: 768, height: 1024 },
          { name: "mobile", width: 390, height: 844 },
        ],
        locales: ["en"],
        themes: ["dark", "light"],
      },
      detectors: {
        horizontalOverflow: true,
        overlap: true,
        textClipping: true,
        stickyOcclusion: true,
        accessibility: true,
      },
      patchPolicy: {
        allowedGlobs: [
          "src/**/*.{css,scss,html,tsx,ts,jsx,js}",
          "public/**/*.html",
          "**/*.{css,html}",
        ],
        deniedGlobs: [
          ".env*",
          "**/node_modules/**",
          "**/dist/**",
          "**/.git/**",
        ],
        maxFiles: 3,
        maxAddedLines: 120,
        maxDeletedLines: 120,
      },
    };
    await fs.writeFile(configPath, `${JSON.stringify(sample, null, 2)}\n`);
    await fs.mkdir(path.join(dir, "issues"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "issues", "example.json"),
      `${JSON.stringify(
        {
          id: "example-overflow",
          title: "Example overflow issue",
          description: "Replace with a real defect description.",
          route: "/",
          state: {
            viewport: { width: 768, height: 1024 },
            locale: "en",
            theme: "dark",
          },
          actions: [],
          assertions: [{ type: "noHorizontalOverflow" }],
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Wrote ${configPath}`);
    console.log(`Wrote issues/example.json`);
  });

function addCommon(cmd: Command): Command {
  return cmd
    .option("--config <path>", "path to reprosight config", "reprosight.config.json")
    .option("--provider <name>", "mock|openai-compatible", "mock")
    .option("--json", "print JSON result", false)
    .option("--headed", "run browser headed", false)
    .option("--keep-worktree", "keep target worktree", false)
    .option("--no-patch", "stop after evidence collection", false)
    .option("--model-base-url <url>", "OpenAI-compatible base URL")
    .option("--model-name <name>", "model name")
    .option("--api-key-env <name>", "API key environment variable name");
}

addCommon(
  program
    .command("run")
    .description("Full pipeline: reproduce → diagnose → repair → verify → report")
    .argument("<issue-file>", "issue JSON path"),
).action(async (issueFile: string, opts: Record<string, unknown>) => {
  await execPipeline(issueFile, opts);
});

addCommon(
  program
    .command("reproduce")
    .description("Reproduce issue and collect evidence (no patch)")
    .argument("<issue-file>", "issue JSON path"),
).action(async (issueFile: string, opts: Record<string, unknown>) => {
  await execPipeline(issueFile, { ...opts, noPatch: true });
});

program
  .command("report")
  .description("Print report path for a run")
  .argument("<run-id>")
  .action(async (runId: string) => {
    const store = new RunStore(defaultReproRoot());
    const run = await store.load(runId);
    const report = path.join(run.rootDir, "report", "index.html");
    console.log(report);
  });

program
  .command("export-patch")
  .description("Print or write the validated patch for a run")
  .argument("<run-id>")
  .option("--out <file>", "write patch to file")
  .action(async (runId: string, opts: { out?: string }) => {
    const store = new RunStore(defaultReproRoot());
    const patchPath = store.artifactPath(runId, "patch.diff");
    const text = await fs.readFile(patchPath, "utf8");
    if (opts.out) {
      await fs.writeFile(path.resolve(opts.out), text);
      console.log(`Wrote ${path.resolve(opts.out)}`);
    } else {
      process.stdout.write(text);
    }
  });

program
  .command("approve")
  .description("Mark run as approved (metadata only; no target commit)")
  .argument("<run-id>")
  .action(async (runId: string) => {
    const store = new RunStore(defaultReproRoot());
    const run = await store.load(runId);
    run.human = { status: "approved", at: new Date().toISOString() };
    await store.save(run);
    console.log(`Approved ${runId} (metadata only)`);
  });

program
  .command("reject")
  .description("Mark run as rejected")
  .argument("<run-id>")
  .requiredOption("--reason <reason>", "rejection reason")
  .action(async (runId: string, opts: { reason: string }) => {
    const store = new RunStore(defaultReproRoot());
    const run = await store.load(runId);
    run.human = {
      status: "rejected",
      reason: opts.reason,
      at: new Date().toISOString(),
    };
    await store.save(run);
    console.log(`Rejected ${runId}: ${opts.reason}`);
  });

program
  .command("clean")
  .description("Remove worktree for a run (warns if evidence missing)")
  .argument("<run-id>")
  .option("--force", "force remove", false)
  .action(async (runId: string, opts: { force?: boolean }) => {
    const store = new RunStore(defaultReproRoot());
    const run = await store.load(runId);
    if (!run.worktreePath) {
      console.log("No worktree recorded for run");
      return;
    }
    if (!opts.force && run.state !== "AWAITING_HUMAN_REVIEW" && run.human.status === "pending") {
      console.warn(
        "Warning: cleaning worktree before human export/approval. Use --force to acknowledge.",
      );
    }
    await removeWorktree({
      repoPath: path.resolve(run.repoPath),
      worktreePath: run.worktreePath,
      force: true,
    });
    run.worktreePath = null;
    await store.save(run);
    console.log(`Cleaned worktree for ${runId}`);
  });

program
  .command("serve")
  .description("Start or document the local dashboard artifact server")
  .action(() => {
    console.log("Local dashboard (serves .reprosight/runs via Vite middleware):");
    console.log("  npm run dev -w @reprosight/dashboard");
    console.log("Open http://127.0.0.1:5173");
    console.log("Deep link: http://127.0.0.1:5173/run/<run-id>");
    console.log("Artifact root: <workspace>/.reprosight/runs");
    console.log("CLI HTML reports remain usable without the dashboard.");
  });

program
  .command("benchmark")
  .description("Run detector/localization/e2e mock benchmarks")
  .action(async () => {
    console.log("Use: npm run benchmark:detectors && npm run e2e:mock");
    process.exitCode = 0;
  });

// Diagnose / repair / verify are stages of full run for MVP
for (const name of ["diagnose", "repair", "verify"] as const) {
  program
    .command(name)
    .description(`${name} stage (use full 'run' in MVP; this re-runs pipeline if needed)`)
    .argument("<run-or-issue>")
    .option("--config <path>", "config path", "reprosight.config.json")
    .option("--provider <name>", "provider", "mock")
    .action(async (target: string, opts: Record<string, unknown>) => {
      if (target.endsWith(".json") && !target.includes("run_")) {
        await execPipeline(target, opts);
      } else {
        console.log(
          `Stage command '${name}' on existing run '${target}' is represented by artifacts already stored under .reprosight/runs/${target}. Use 'reprosight run' for a fresh pipeline.`,
        );
      }
    });
}

async function execPipeline(issueFile: string, opts: Record<string, unknown>) {
  try {
    const configPath = path.resolve(String(opts.config ?? "reprosight.config.json"));
    const config = await loadConfig(configPath);
    // validate
    parseConfig(config);
    const issue = await loadIssueFile(issueFile);
    parseIssue(issue);
    const result = await runFullPipeline({
      config,
      issue,
      provider: (opts.provider as "mock" | "openai-compatible") ?? "mock",
      headless: opts.headed ? false : undefined,
      keepWorktree: Boolean(opts.keepWorktree),
      noPatch: Boolean(opts.noPatch),
      modelBaseUrl: opts.modelBaseUrl as string | undefined,
      modelName: opts.modelName as string | undefined,
      apiKeyEnvVar: opts.apiKeyEnv as string | undefined,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Run ${result.runId}`);
      console.log(`State ${result.state}`);
      console.log(`Exit ${result.exitCode}`);
      console.log(
        `Report: ${path.join(defaultReproRoot(), "runs", result.runId, "report", "index.html")}`,
      );
    }
    process.exitCode = result.exitCode;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Infrastructure failure: ${message}`);
    process.exitCode = 10;
  }
}

program.parseAsync(process.argv);
