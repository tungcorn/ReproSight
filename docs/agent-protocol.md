# ReproSight Agent Protocol

Protocol version: **1**

## Purpose

Machine-operated interface for external coding agents (Claude Code, Codex, Cursor, Copilot agents, etc.).

End users talk to their coding agent. The coding agent operates ReproSight.

## Commands

| Command | Role |
| --- | --- |
| `reprosight agent contract --json` | Full protocol contract |
| `reprosight agent discover --repo . --json` | Static project discovery |
| `reprosight agent prepare ... --json` | Normalize request → config/issue |
| `reprosight agent run ... --json` | Deterministic reproduce + evidence (no internal model patch) |
| `reprosight agent evidence <runId> --json` | Focused evidence sections |
| `reprosight agent workspace <runId> --json` | Isolated Git worktree for edits |
| `reprosight agent verify <runId> --workspace --json` | Policy + target + regressions |
| `reprosight agent status <id> --json` | Session/run recovery |
| `reprosight agent report <runId> --json` | Human report path + verdict |
| `reprosight agent cleanup <id> --json` | Remove worktrees; keep evidence |
| `reprosight agent guide --format markdown` | Agent instructions |

All machine commands emit **one JSON object on stdout** when used with `--json`.

## Request schema

See `schemas/reprosight-agent-request.schema.json`.

Minimum:

```json
{
  "version": 1,
  "repository": { "path": "." },
  "task": { "description": "Mobile checkout button is covered." }
}
```

Optional hints: screenshot, route, viewport, locale, theme, startCommand, readyUrl, actions, suspectedSelectors.

## Escalation

1. Deterministic resolution
2. `AGENT_ACTION_REQUIRED` — coding agent inspects repo/browser and retries
3. `HUMAN_INPUT_REQUIRED` — credentials / product decision only

## Verification outcomes

- `TARGET_FIXED_REGRESSIONS_PASSED` → report to user; human approval still required
- `TARGET_STILL_FAILING` / `REGRESSION_INTRODUCED` / `PATCH_POLICY_REJECTED` → revise repair
- Integrity: `originalCheckoutUnchanged` must remain true

## Safety

- Localhost ready URLs only
- No `.env` reads
- No shell chaining in start commands
- Patch policy enforced
- Worktree-only edits for repair
