# Holdout real-provider evaluation

- evaluationId: `holdout-real-2026-07-23T09-52-11-473Z-ee244245`
- model: `meta/llama-3.3-70b-instruct`
- host: `integrate.api.nvidia.com`
- cases: 6
- FULL_SUCCESS: 0/6 (0.0%)
- file top-1: 33.3%
- file top-3: 33.3%
- valid patch rate: 33.3%
- target fixed: 0.0%
- regression-free: 0.0%
- appropriate abstention: 0
- unnecessary abstention: 0
- manual intervention rate: 0
- median input tokens: 3166
- median output tokens: 312
- total estimated cost: 0
- median provider latency ms: 115872.5
- median e2e runtime ms: 97623

## Category counts

- VALID_PATCH_TARGET_FAILED: 2
- PROVIDER_FAILURE: 4

## Per-case

| Case | Category | Top1 file | Top3 file | Patch accepted | Target fixed | Regressions |
| --- | --- | --- | --- | --- | --- | --- |
| holdout-btn-clip-vi | VALID_PATCH_TARGET_FAILED | true | true | true | false | null |
| holdout-cascade-shift | PROVIDER_FAILURE | null | null | null | null | null |
| holdout-flex-minwidth | PROVIDER_FAILURE | null | null | null | null | null |
| holdout-grid-token | PROVIDER_FAILURE | null | null | null | null | null |
| holdout-sticky-docs | PROVIDER_FAILURE | null | null | null | null | null |
| holdout-support-widget | VALID_PATCH_TARGET_FAILED | true | true | true | false | null |

This holdout is an MVP evaluation set, not a broad scientific benchmark.
