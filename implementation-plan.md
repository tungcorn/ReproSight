# Implementation Plan

## Principles

1. Deterministic evidence before model reasoning
2. One coherent commit per completed checkpoint
3. Do not advance past a failed quality gate
4. Prefer smaller real modules over theatrical multi-agent systems

## Phases and gates

### Checkpoint 0 — Research and plan

**Deliverables:** research, architecture, evaluation, threat model, limitations, this plan, task list

**Gate:** Scope, non-goals, security assumptions, metrics, and phases are explicit

**Commit:** `docs: define ReproSight architecture and evaluation plan`

### Checkpoint 1 — Workspace, schemas, store

**Deliverables:** npm workspaces, strict TS, config/issue/pipeline schemas, artifact store, CLI shell, unit tests

**Gate:** `npm run typecheck`, `npm test`, `git diff --check`

**Commit:** `feat(core): add workspace schemas and run artifact model`

### Checkpoint 2 — Browser runner

**Deliverables:** process lifecycle, Chromium, state setup, stabilization, screenshots/traces/console

**Gate:** runner integration tests; clean start/stop; artifacts generated

**Commit:** `feat(runner): add deterministic browser reproduction`

### Checkpoint 3 — Detectors

**Deliverables:** overflow, overlap, clipping, sticky occlusion, axe, annotations

**Gate:** typecheck, tests, `benchmark:detectors`

**Commit:** `feat(detectors): detect and annotate visual defects`

### Checkpoint 4 — Source localization

**Deliverables:** CDP collection, URL mapping, scoring, localization artifacts

**Gate:** flagship fixtures resolve real rules; no fabricated locations

**Commit:** `feat(localizer): map rendered defects to authored CSS`

### Checkpoint 5 — Diagnosis and patch safety

**Deliverables:** ModelClient, mock + OpenAI-compatible, schema, redaction, patch policy

**Gate:** no network model calls in tests; dangerous patches rejected; abstention works

**Commit:** `feat(diagnosis): add secure model and patch contracts`

### Checkpoint 6 — Worktree patcher

**Deliverables:** cleanliness, linked worktree, apply, integrity hash, cleanup

**Gate:** original checkout unchanged; invalid patch cannot mutate

**Commit:** `feat(patcher): verify repairs in isolated worktrees`

### Checkpoint 7 — Verifier

**Deliverables:** target rerun, matrix, comparisons, verdicts

**Gate:** mock flagship fixes; regressions fail correctly

**Commit:** `feat(verifier): add target and regression verification`

### Checkpoint 8 — HTML report

**Deliverables:** self-contained report with full evidence chain

**Gate:** opens locally; reviewer can understand without raw JSON

**Commit:** `feat(report): generate evidence-backed repair reports`

### Checkpoint 9 — Dashboard

**Deliverables:** runs list, comparison, evidence, diff, approval metadata

**Gate:** typecheck, test, build, dashboard E2E

**Commit:** `feat(dashboard): add local run review interface`

### Checkpoint 10 — Benchmark and demos

**Deliverables:** 12+ fixtures, localization cases, e2e mock repairs, metrics, flagships

**Gate:** `benchmark:detectors`, `e2e:mock`; failures not hidden

**Commit:** `feat(benchmark): add ReproSight UI Bug Bench`

### Checkpoint 11 — CI and docs

**Deliverables:** GitHub Actions, README, demo script, final docs

**Gate:** full local verification suite green; clean git tree

**Commit:** `docs: complete ReproSight usage evaluation and demo guide`

## Dependency notes

- Playwright Chromium required for runner/detectors/e2e
- Mock provider required for CI
- Real provider optional and never required for green builds

## Deviation policy

Small justified boundary changes are allowed if documented in the final report. Skipping quality gates is not allowed.
