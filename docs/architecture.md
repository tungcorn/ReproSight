# ReproSight Architecture

## One-sentence system shape

ReproSight is a TypeScript monorepo that runs an explicit pipeline: reproduce → collect evidence → localize CSS → diagnose (optional model) → validate patch → apply in isolated worktree → verify → report.

## Package boundaries

```
apps/dashboard          Local React UI that reads run artifacts (no repair execution)
packages/cli            User-facing commands; thin orchestration entry
packages/core           All pipeline logic, schemas, security, store
packages/benchmark      Fixture harness and metric aggregation
fixtures/*              Deterministic buggy mini-sites
examples/*              Sample configs and issues
```

`packages/core` is the only package that talks to Playwright, CDP, Git worktrees, and model providers. The CLI and dashboard depend on core; core does not depend on them.

## Pipeline state machine

```mermaid
stateDiagram-v2
  [*] --> CREATED
  CREATED --> PREPARING
  PREPARING --> REPRODUCING
  REPRODUCING --> NOT_REPRODUCED
  REPRODUCING --> REPRODUCED
  REPRODUCED --> COLLECTING_EVIDENCE
  COLLECTING_EVIDENCE --> EVIDENCE_READY
  EVIDENCE_READY --> DIAGNOSING
  DIAGNOSING --> ABSTAINED
  DIAGNOSING --> PATCH_PROPOSED
  PATCH_PROPOSED --> VALIDATING_PATCH
  VALIDATING_PATCH --> PATCH_REJECTED
  VALIDATING_PATCH --> WORKTREE_READY
  WORKTREE_READY --> VERIFYING_TARGET
  VERIFYING_TARGET --> TARGET_FAILED
  VERIFYING_TARGET --> TARGET_FIXED
  TARGET_FIXED --> VERIFYING_REGRESSIONS
  VERIFYING_REGRESSIONS --> REGRESSION_INTRODUCED
  VERIFYING_REGRESSIONS --> VERIFIED
  VERIFIED --> AWAITING_HUMAN_REVIEW
  NOT_REPRODUCED --> [*]
  ABSTAINED --> [*]
  PATCH_REJECTED --> [*]
  TARGET_FAILED --> [*]
  REGRESSION_INTRODUCED --> [*]
  AWAITING_HUMAN_REVIEW --> [*]
```

Each transition is persisted with timestamp, previous state, new state, reason, and artifact IDs.

## Module map

```mermaid
flowchart LR
  CLI[packages/cli] --> ORCH[orchestrator]
  ORCH --> CFG[config + issue schemas]
  ORCH --> RUN[runner]
  ORCH --> DET[detectors]
  ORCH --> LOC[source-locator]
  ORCH --> DIAG[diagnosis]
  ORCH --> PATCH[patcher]
  ORCH --> VER[verifier]
  ORCH --> REP[reporting]
  ORCH --> STORE[store]
  DIAG --> SEC[security]
  PATCH --> SEC
  RUN --> PW[Playwright + CDP]
  PATCH --> GIT[Git worktree]
  DASH[apps/dashboard] --> STORE
```

## Target worktree isolation

```mermaid
sequenceDiagram
  participant Core as packages/core
  participant Origin as Target checkout
  participant WT as .reprosight/worktrees/run-id
  participant App as Target app process

  Core->>Origin: require clean working tree
  Core->>Origin: git worktree add WT baseRef
  Core->>WT: npm install (configured)
  Core->>WT: git apply validated.patch
  Core->>App: start from WT only
  Core->>App: reproduce + regress
  Note over Origin: original checkout never mutated
  Core->>WT: keep or clean via CLI
```

## Artifact flow

```
.reprosight/runs/<run-id>/
  run.json
  issue.json
  config.snapshot.json
  environment.json
  reproduction.json
  evidence.json
  diagnosis.json
  patch.diff
  patch-validation.json
  verification.json
  report/index.html
  artifacts/*
```

Missing artifacts are represented explicitly in `run.json` rather than omitted silently.

## Determinism boundaries

| Layer | Deterministic? | Notes |
| --- | --- | --- |
| Config / issue validation | Yes | Zod schemas |
| Browser setup / actions | Yes | Fixed action types only |
| Detectors | Yes | Geometry + axe |
| Source localization | Yes | CDP + scoring |
| Model diagnosis | No | Provider-dependent; mock used in CI |
| Patch policy | Yes | Diff parse + globs + limits |
| Worktree apply | Yes | native git |
| Verification | Yes | same detectors/assertions |
| Human review | Manual | required for approval |

## Security boundaries

- Model receives structured evidence only; page/repo content is untrusted data
- Model has no shell tool and returns JSON only
- Patch paths must be relative, non-traversing, and glob-allowed
- Secrets are redacted from stored console/network evidence
- Original target checkout is integrity-checked around repair

## Extension points

- Additional detectors implement a shared detector interface
- Model providers implement `ModelClient`
- Reports and dashboard read the same artifact schema
- Benchmark cases are plain fixtures + issue JSON + expected metadata
