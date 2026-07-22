# Coding agent integration

## Intended UX

User:

> The checkout CTA is covered on mobile. Use ReproSight to fix it and verify the result.

Coding agent:

1. Reads `reprosight agent contract --json`
2. Discovers the repository
3. Generates the agent request (no user JSON)
4. Runs deterministic reproduction
5. Creates isolated workspace
6. Edits repair
7. Verifies until `TARGET_FIXED_REGRESSIONS_PASSED` or escalates honestly
8. Returns report path + remaining uncertainty

## Entry points

```bash
# Machine contract (first call)
node packages/cli/dist/index.js agent contract --json

# Discover
node packages/cli/dist/index.js agent discover --repo . --json

# One-shot reproduce
node packages/cli/dist/index.js agent run \
  --repo . \
  --description "The support widget covers checkout on mobile" \
  --json
```

## Tool definitions export

```bash
node packages/cli/dist/index.js agent contract --format tool-definitions --json
```

Generic schemas only — adapters may map to MCP/Claude/Codex tool formats later.

## Simulation harness (CI)

```bash
npm run e2e:agent
```

Simulates an external agent without a network model.
