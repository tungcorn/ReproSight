# Agent security

External coding agents are powerful and **untrusted by default**.

## Validated

- Repository paths
- Screenshot paths
- Start commands (no chaining / destructive patterns)
- Ready URLs (localhost / 127.0.0.1 only)
- Selectors and allow-listed actions
- Patch paths and patch policy
- Worktree isolation

## Rejected

- Path traversal
- Non-local ready URLs
- Shell chaining in start commands
- `.env` access via request paths
- Patching denied globs
- Global overflow-hiding “fixes” (policy)
- Mutating the original checkout for repair

## Secrets

Probable secrets are redacted from stored console/network evidence and agent payloads where applicable.

API keys for optional standalone model providers are read from environment variables and never logged.
