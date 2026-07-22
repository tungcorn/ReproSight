# Agent verdicts

## Pipeline / agent statuses

| Status | Meaning |
| --- | --- |
| `REPRODUCED` | Target defect observed |
| `NOT_REPRODUCED` | Scenario completed without expected failure |
| `AGENT_ACTION_REQUIRED` | Coding agent must resolve ambiguity |
| `HUMAN_INPUT_REQUIRED` | Genuine human decision/credentials |
| `WORKSPACE_READY` | Isolated worktree ready for edits |
| `HUMAN_REVIEW_REQUIRED` | Repair verified; human approval still required |
| `PATCH_POLICY_REJECTED` | Diff unsafe or out of policy |
| `TARGET_STILL_FAILING` | Repair did not fix original scenario |
| `REGRESSION_INTRODUCED` | Target fixed but matrix failed |
| `VERIFICATION_INFRASTRUCTURE_FAILURE` | Process/browser/git failure |

## Verification verdict field

`verificationVerdict` (when present):

- `TARGET_FIXED_REGRESSIONS_PASSED`
- `TARGET_STILL_FAILING`
- `REGRESSION_INTRODUCED`
- `PATCH_POLICY_REJECTED`
- `NEW_ACCESSIBILITY_FAILURE`
- `NEW_CONSOLE_ERROR`
- `ORIGINAL_CHECKOUT_CHANGED`

Agents must not invent success if this field is absent or not `TARGET_FIXED_REGRESSIONS_PASSED`.
