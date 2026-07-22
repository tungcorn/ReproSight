# ReproSight — Evidence-driven AI Visual Repair

**Visual defect → deterministic evidence → authored CSS candidate → proposed patch → isolated verification → regression result → human review.**

ReproSight does not merely suggest a fix. It produces evidence showing whether the fix worked.

## Flagship proof (container stretch)

| Before | Annotated | After | Diff |
| --- | --- | --- | --- |
| ![](artifacts/demo/container-stretch-before.png) | ![](artifacts/demo/container-stretch-annotated.png) | ![](artifacts/demo/container-stretch-after.png) | ![](artifacts/demo/container-stretch-diff.png) |

Self-contained report: [artifacts/demo/report-container-stretch.html](artifacts/demo/report-container-stretch.html)

**Demo media:** WebM **not recorded** (no capture tool; file not fabricated).  
Storyboard + transcript: [artifacts/demo/storyboard/](artifacts/demo/storyboard/) · [transcript](artifacts/demo/reprosight-flagship-demo-transcript.md)

Label for that demonstration:  
**Deterministic mock provider — pipeline demonstration, not model accuracy**

## Four separate evaluation categories

Never combined into one success rate.

### 1) Deterministic detector benchmark

- **12/12** primary detectors
- Ten consecutive full runs previously recorded (`artifacts/audit/detector-10x.txt`)
- Command: `npm run benchmark:detectors`

### 2) Deterministic source-localization benchmark

From `artifacts/benchmark/localization-analysis.json`:

| Metric | Value |
| --- | ---: |
| Cases | 12 |
| Top-1 | **83.3%** |
| Top-3 | **100%** |

Known misses: `ambiguous-cascade` ×2 (not hidden).

### 3) Mock orchestration benchmark

Label: **Orchestration and verification success with deterministic mock provider**

- **6/6** pipeline cases → `AWAITING_HUMAN_REVIEW`
- Worktree-only apply · original checkout unchanged · regressions clean
- Commands: `npm run e2e:mock`, `npm run evaluation:mock-matrix`

**Not AI repair accuracy.**

### 4) Real-provider repair evaluation (frozen holdout)

| Field | Value |
| --- | --- |
| Holdout cases | **6** new fixtures (not used to tune mock patches / scoring demos) |
| Deterministic holdout validation | **6/6** (`npm run evaluation:holdout-validate`) |
| Official real-provider run | **BLOCKED** — no `OPENAI_API_KEY` |
| Mock substitution | **Forbidden** for this gate |

Frozen protocol: [evaluation/holdout/protocol.md](evaluation/holdout/protocol.md)  
Latest status: [artifacts/evaluation/holdout-latest.md](artifacts/evaluation/holdout-latest.md)

```bat
set OPENAI_API_KEY=***
set REPROSIGHT_MODEL_BASE_URL=https://api.openai.com/v1
set REPROSIGHT_MODEL_NAME=gpt-4o-mini
npm run evaluation:holdout-real
```

Holdout set includes English + Vietnamese, mobile/tablet/desktop, multi-rule cascade, and an abstention-acceptable case (`holdout-cascade-shift`).

## Success vs failure stories

- **Success (mock pipeline demo):** container-stretch → Fixed / VERIFIED / human review required (storyboard).
- **Failure/abstention (real model):** not available until credentials exist; protocol + abstention-designed holdout documented in [artifacts/evaluation/holdout-failure-story.md](artifacts/evaluation/holdout-failure-story.md).

## Quick start

```bash
npm ci
npx playwright install chromium
npm run typecheck
npm run lint
npm test
npm run build
npm run benchmark:detectors
npm run evaluation:mock-matrix
npm run e2e:mock
npm run evaluation:holdout-validate
npm run evaluation:holdout-real
```

### Dashboard

```bash
npm run dev -w @reprosight/dashboard
# http://127.0.0.1:5173  ·  /run/<run-id>
# serves .reprosight/runs without manual copy
```

## Safety model

- Fixed issue action allow-list (no arbitrary JS)
- Untrusted page/repo content for the model
- Secret redaction · patch path policy · isolated Git worktrees only
- Human approval never commits/merges/pushes the target

## Honest limitations

- MVP fixtures ≠ scientific benchmark
- Localization top-1 is not 100%
- Axe is partial; pixel diffs are environment-sensitive
- Real-model accuracy unmeasured without provider credentials
- Demo WebM missing (storyboard only)
- No claim of general autonomous production repair

## License

MIT
