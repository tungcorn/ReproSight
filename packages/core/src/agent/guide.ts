import { PROTOCOL_VERSION, TOOL_VERSION } from "./statuses.js";
import { discoverRepository } from "./discover.js";

export async function buildAgentGuide(opts: {
  format: "markdown" | "json";
  repo?: string;
}): Promise<string | Record<string, unknown>> {
  const project = opts.repo
    ? await discoverRepository(opts.repo)
    : null;

  const markdown = `# ReproSight Coding Agent Guide

Tool: ReproSight ${TOOL_VERSION}
Protocol: v${PROTOCOL_VERSION}

## Role

You (the coding agent) operate ReproSight for the human.

The human must NOT:
- run ReproSight commands
- write config/issue JSON
- choose detectors/selectors/ports
- edit the original checkout for repair

You MUST:
1. Read \`reprosight agent contract --json\`
2. Discover the repository
3. Generate the request yourself
4. Run deterministic reproduction
5. Create an isolated repair workspace
6. Edit only that workspace
7. Verify after every repair attempt
8. Report success only for \`TARGET_FIXED_REGRESSIONS_PASSED\`
9. Leave human approval required

## Recommended workflow

\`\`\`text
contract → discover → run → evidence → workspace → edit → verify → report
\`\`\`

### Commands

\`\`\`bash
reprosight agent contract --json
reprosight agent discover --repo . --json
reprosight agent run --repo . --description "<user problem>" --screenshot <path> --json
reprosight agent evidence <runId> --section all --json
reprosight agent workspace <runId> --json
# edit files only in workspace.path
reprosight agent verify <runId> --workspace --json
reprosight agent report <runId> --json
reprosight agent cleanup <runId> --json
\`\`\`

## Success rule

Never claim the UI bug is fixed unless verification returns:

\`verificationVerdict: "TARGET_FIXED_REGRESSIONS_PASSED"\`

and \`integrity.originalCheckoutUnchanged: true\`.

## Human escalation

Ask the human only for:
- credentials
- genuine product/design ambiguity
- private data unavailable from the repository

Do not ask the human to write start commands, ports, selectors, or JSON when
repository/browser evidence can resolve them.

${project ? `## Project snapshot\n\n\`\`\`json\n${JSON.stringify({
  packageManager: project.project.packageManager,
  framework: project.project.framework,
  startCommandCandidates: project.startCommandCandidates,
  readyUrlCandidates: project.readyUrlCandidates,
}, null, 2)}\n\`\`\`\n` : ""}
`;

  if (opts.format === "json") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      version: TOOL_VERSION,
      markdown,
      project,
      shortUserPrompt:
        "Use ReproSight to fix and verify the UI bug in this screenshot. Operate ReproSight yourself and only report success after its regression checks pass.",
    };
  }
  return markdown;
}
