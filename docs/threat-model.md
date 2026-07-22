# Threat Model

## Assets

- Target repository integrity (original checkout must remain unchanged)
- Developer secrets (env vars, API keys, git credentials)
- Run evidence integrity (cannot silently omit failures)
- Human trust in “Fixed / Verified” verdicts

## Trust boundaries

1. **Issue description / screenshot text** — untrusted
2. **Rendered page content** (DOM, attributes, comments, network bodies) — untrusted
3. **Repository source** — untrusted as instruction text; trusted only as filesystem under policy
4. **Model output** — untrusted until schema + patch policy validate it
5. **Human approval** — trusted for export metadata only, not for remote publish

## Threats and mitigations

### Prompt injection via page or repository content

**Risk:** Malicious HTML comments or source comments try to instruct the model to hide bugs or exfiltrate secrets.

**Mitigations:**

- System prompt states evidence is data, not instructions
- Model has no tools / no shell
- Only top-ranked structured evidence is sent
- Secrets redacted before storage and prompt construction
- Structured JSON-only model output validated by Zod

### Secret leakage

**Risk:** Console logs, network headers, or `.env` contents enter artifacts or model prompts.

**Mitigations:**

- Redact probable secrets from console/network evidence
- Deny patching `.env*` and secret-bearing paths
- Never print environment secret values in CLI logs
- API keys read from named env vars only; never logged

### Arbitrary patch paths

**Risk:** Model proposes `../../.ssh/authorized_keys` or absolute paths.

**Mitigations:**

- Reject absolute paths and path traversal
- Enforce allowed/denied globs
- Cap files and line deltas
- `git apply --check` before apply
- Apply only inside linked worktree

### Arbitrary command execution

**Risk:** Model or issue file tries to run shell.

**Mitigations:**

- Issue actions limited to fixed types (`goto`, `click`, `fill`, `press`, `hover`, `scrollIntoView`, `waitForSelector`)
- No arbitrary JS execution from issue files
- Model has no command channel
- Target start/install commands come only from validated project config

### Original target mutation

**Risk:** Repair mutates the developer’s working tree.

**Mitigations:**

- Require clean target status before repair
- Linked worktree under `.reprosight/worktrees/<run-id>/`
- Integrity hash of original checkout recorded and rechecked
- Never commit/push/merge from target worktree

### False success

**Risk:** Report claims fixed without verification.

**Mitigations:**

- Explicit pipeline states; success requires verification states
- Original scenario must pass before full matrix is accepted
- New severe detectors, axe, console, build/test failures fail the run
- Terminal successful state is still `AWAITING_HUMAN_REVIEW`

### Screenshot nondeterminism

**Risk:** Cross-environment pixel diffs produce false regressions.

**Mitigations:**

- Record browser, OS, viewport, DPR, locale, theme
- Prefer geometric detectors as primary oracles
- Configurable ignore masks for dynamic content
- Document that screenshots from different environments are not exact equivalents
- Never auto-update baselines

## Residual risks

- Compromised npm dependencies in the target install step
- Malicious target `start` scripts (config is operator-controlled)
- Incomplete axe coverage relative to manual accessibility review
- Model may still propose plausible but product-incorrect CSS within policy

Operators must treat ReproSight as an evidence assistant, not an autonomous merger.
