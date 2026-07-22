import type { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildAgentContract,
  buildAgentGuide,
  buildRequestFromFlags,
  agentRun,
  agentWorkspace,
  agentVerify,
  agentEvidence,
  agentStatus,
  agentReport,
  agentCleanup,
  prepareAgentSession,
  discoverRepository,
  agentOk,
  agentError,
  parseAgentRequest,
  type AgentResponse,
} from "@reprosight/core";

function printJson(response: AgentResponse): number {
  process.stdout.write(`${JSON.stringify(response)}\n`);
  return response.exitCode ?? 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function loadRequest(opts: {
  request?: string;
  stdin?: boolean;
  repo?: string;
  description?: string;
  screenshot?: string;
  route?: string;
  width?: string;
  height?: string;
  locale?: string;
  theme?: string;
  startCommand?: string;
  readyUrl?: string;
}): Promise<unknown> {
  if (opts.stdin) {
    const raw = await readStdin();
    return JSON.parse(raw);
  }
  if (opts.request) {
    const raw = await fs.readFile(path.resolve(opts.request), "utf8");
    return JSON.parse(raw);
  }
  if (opts.description) {
    return buildRequestFromFlags({
      repo: opts.repo,
      description: opts.description,
      screenshot: opts.screenshot,
      route: opts.route,
      width: opts.width ? Number(opts.width) : undefined,
      height: opts.height ? Number(opts.height) : undefined,
      locale: opts.locale,
      theme: opts.theme as "dark" | "light" | undefined,
      startCommand: opts.startCommand,
      readyUrl: opts.readyUrl,
    });
  }
  throw new Error("Provide --request, --stdin, or --description");
}

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command("agent")
    .description("Machine protocol for external coding agents");

  agent
    .command("contract")
    .description("Print the machine-readable protocol contract")
    .option("--json", "JSON stdout", true)
    .option("--format <fmt>", "json|tool-definitions", "json")
    .action((opts: { format?: string }) => {
      const fmt =
        opts.format === "tool-definitions" ? "tool-definitions" : "json";
      const response = buildAgentContract(fmt);
      process.exitCode = printJson(response);
    });

  agent
    .command("discover")
    .description("Discover repository project facts")
    .option("--repo <path>", "repository path", ".")
    .option("--json", "JSON stdout", true)
    .action(async (opts: { repo: string }) => {
      try {
        const discovery = await discoverRepository(opts.repo);
        const status =
          discovery.startCommandCandidates.length === 0
            ? "AGENT_ACTION_REQUIRED"
            : discovery.startCommandCandidates.length > 1 &&
                (discovery.startCommandCandidates[0]?.confidence ?? 0) < 0.9
              ? "AGENT_ACTION_REQUIRED"
              : "OK";
        process.exitCode = printJson(
          agentOk(status as "OK" | "AGENT_ACTION_REQUIRED", {
            ...discovery,
            recommendedAgentAction:
              status === "AGENT_ACTION_REQUIRED"
                ? {
                    type: "RESOLVE_PROJECT_FACTS",
                    then: "CALL_PREPARE",
                  }
                : discovery.recommendedAgentAction,
          }),
        );
      } catch (err) {
        process.exitCode = printJson(
          agentError(
            "ERROR",
            "DISCOVERY_FAILED",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    });

  agent
    .command("prepare")
    .description("Normalize request and generate canonical config/issue")
    .option("--request <file>", "request JSON file")
    .option("--stdin", "read request JSON from stdin")
    .option("--repo <path>", "repository path")
    .option("--description <text>", "task description")
    .option("--screenshot <path>", "screenshot path")
    .option("--route <route>", "route hint")
    .option("--width <n>", "viewport width")
    .option("--height <n>", "viewport height")
    .option("--locale <locale>", "locale hint")
    .option("--theme <theme>", "dark|light")
    .option("--start-command <cmd>", "start command hint")
    .option("--ready-url <url>", "ready URL hint")
    .option("--json", "JSON stdout", true)
    .action(async (opts) => {
      try {
        const request = await loadRequest(opts);
        const response = await prepareAgentSession({ request });
        process.exitCode = printJson(response);
      } catch (err) {
        process.exitCode = printJson(
          agentError(
            "INVALID_REQUEST",
            "INVALID_REQUEST",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    });

  agent
    .command("run")
    .description("Deterministic reproduction and evidence (no internal model patch)")
    .option("--request <file>", "request JSON file")
    .option("--stdin", "read request JSON from stdin")
    .option("--session <id>", "existing prepared session")
    .option("--repo <path>", "repository path")
    .option("--description <text>", "task description")
    .option("--screenshot <path>", "screenshot path")
    .option("--route <route>", "route hint")
    .option("--width <n>", "viewport width")
    .option("--height <n>", "viewport height")
    .option("--locale <locale>", "locale hint")
    .option("--theme <theme>", "dark|light")
    .option("--start-command <cmd>", "start command hint")
    .option("--ready-url <url>", "ready URL hint")
    .option("--headed", "headed browser")
    .option("--json", "JSON stdout", true)
    .action(async (opts) => {
      try {
        let request: unknown | undefined;
        if (!opts.session) {
          request = await loadRequest(opts);
        }
        const response = await agentRun({
          request,
          sessionId: opts.session,
          headed: Boolean(opts.headed),
        });
        process.exitCode = printJson(response);
      } catch (err) {
        process.exitCode = printJson(
          agentError(
            "ERROR",
            "RUN_FAILED",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    });

  agent
    .command("evidence")
    .description("Retrieve evidence sections for a run")
    .argument("<run-id>")
    .option("--section <name>", "summary|findings|source-candidates|console|accessibility|artifacts|all", "summary")
    .option("--json", "JSON stdout", true)
    .action(async (runId: string, opts: { section?: string }) => {
      const response = await agentEvidence({
        runId,
        section: opts.section,
      });
      process.exitCode = printJson(response);
    });

  agent
    .command("workspace")
    .description("Create isolated repair worktree for agent edits")
    .argument("<run-id>")
    .option("--session <id>", "session id")
    .option("--json", "JSON stdout", true)
    .action(async (runId: string, opts: { session?: string }) => {
      const response = await agentWorkspace({
        runId,
        sessionId: opts.session,
      });
      process.exitCode = printJson(response);
    });

  agent
    .command("verify")
    .description("Verify workspace edits or a patch file")
    .argument("<run-id>")
    .option("--workspace", "use current worktree diff", false)
    .option("--patch-file <file>", "unified diff file")
    .option("--patch-stdin", "read unified diff from stdin")
    .option("--session <id>", "session id")
    .option("--json", "JSON stdout", true)
    .action(async (runId: string, opts) => {
      try {
        let patchText: string | undefined;
        if (opts.patchStdin) patchText = await readStdin();
        const response = await agentVerify({
          runId,
          sessionId: opts.session,
          workspace: Boolean(opts.workspace),
          patchFile: opts.patchFile,
          patchText,
        });
        process.exitCode = printJson(response);
      } catch (err) {
        process.exitCode = printJson(
          agentError(
            "ERROR",
            "VERIFY_FAILED",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    });

  agent
    .command("status")
    .description("Session or run status")
    .argument("<session-or-run-id>")
    .option("--json", "JSON stdout", true)
    .action(async (id: string) => {
      process.exitCode = printJson(await agentStatus({ id }));
    });

  agent
    .command("report")
    .description("Report paths and verdict summary")
    .argument("<run-id>")
    .option("--json", "JSON stdout", true)
    .action(async (runId: string) => {
      process.exitCode = printJson(await agentReport({ runId }));
    });

  agent
    .command("cleanup")
    .description("Cleanup worktrees for a session/run")
    .argument("<session-or-run-id>")
    .option("--force", "force cleanup", false)
    .option("--json", "JSON stdout", true)
    .action(async (id: string, opts: { force?: boolean }) => {
      process.exitCode = printJson(
        await agentCleanup({ id, force: Boolean(opts.force) }),
      );
    });

  agent
    .command("guide")
    .description("Coding-agent instructions")
    .option("--format <fmt>", "markdown|json", "markdown")
    .option("--repo <path>", "optional repo for project snapshot")
    .option("--output <path>", "write to file")
    .option("--json", "force JSON envelope", false)
    .action(async (opts) => {
      const format = opts.format === "json" ? "json" : "markdown";
      const guide = await buildAgentGuide({ format, repo: opts.repo });
      if (opts.output) {
        const text =
          typeof guide === "string" ? guide : JSON.stringify(guide, null, 2);
        await fs.writeFile(path.resolve(opts.output), text);
      }
      if (format === "json" || opts.json) {
        process.exitCode = printJson(
          agentOk("OK", {
            guide,
          }),
        );
      } else {
        process.stdout.write(String(guide));
        if (!String(guide).endsWith("\n")) process.stdout.write("\n");
        process.exitCode = 0;
      }
    });
}

// silence unused import in some builds
void parseAgentRequest;
