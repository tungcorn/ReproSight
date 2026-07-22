# Evaluation Plan

## Verdict vocabulary

| Verdict | Meaning |
| --- | --- |
| Confirmed | Detector found the expected defect class |
| Likely | Signals present but below high-confidence threshold |
| Not reproduced | Scenario completed without the expected failure |
| Unsupported | Case outside MVP capability |
| Abstained | Model refused to patch due to insufficient evidence |
| Patch proposed | Model returned a unified diff |
| Patch rejected | Policy or `git apply --check` failed |
| Worktree ready | Patch applied in isolated worktree |
| Fixed | Original failing scenario now passes |
| Still failing | Original scenario still fails after patch |
| Regression introduced | Target fixed but matrix found new severe failures |
| Verified | Target fixed and regressions clean |
| Human review required | Terminal successful path awaiting approval |

Do not use informal success language when a required state was skipped.

## Benchmark tiers

### Tier A — Reproduction / detection (minimum 12 cases)

Metrics:

- Reproduction success rate = cases reproduced / cases expected to reproduce
- Detector precision = true positives / (true positives + false positives)
- Detector recall = true positives / (true positives + false negatives)

A true positive requires matching detector family and overlapping offender selector when specified.

### Tier B — Source localization (minimum 8 cases)

Metrics:

- Top-1 localization = known culprit rule in rank 1
- Top-3 localization = known culprit rule in ranks 1–3

A match requires correct file and overlapping line range or exact selector+property when line ranges are unstable.

### Tier C — End-to-end mock repair (minimum 6 cases)

Metrics:

- Patch policy acceptance rate
- Target repair success
- Regression-free repair rate
- Abstention rate
- Median files changed
- Median changed lines
- Median runtime
- Model token usage / estimated cost when available

Mock provider is mandatory in CI. Real providers are optional manual runs.

## Failure taxonomy

| Code | Meaning | Exit code family |
| --- | --- | --- |
| SUCCESS | Verified or approved path completed | 0 |
| NOT_REPRODUCED | Issue did not reproduce | 2 |
| ABSTAINED | Diagnosis abstained | 3 |
| PATCH_REJECTED | Patch policy failed | 4 |
| TARGET_FAILED | Patch did not fix target | 5 |
| REGRESSION | Target fixed but regressions found | 6 |
| INFRA | Process/browser/git infrastructure failure | 10 |

## Honesty constraints

- Do not hide failed cases in aggregate tables
- Do not claim scientific validity from the MVP fixture set
- Do not update visual baselines automatically
- Do not count unsupported cases as successes
- Environment metadata must accompany screenshot comparisons

## Flagship acceptance scenarios

1. **Container stretch** — desktop hero loses shared container max-width due to later override
2. **Locale overflow** — Vietnamese tablet label overflows due to responsive override + `white-space: nowrap`

Each flagship must demonstrate reproduction, localization, minimal patch, target fix, clean regressions, unchanged original checkout, and human-review terminal state.
