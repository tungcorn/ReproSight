# Failure / abstention story (protocol)

## Real-provider status

The official holdout real-provider evaluation is **blocked** because no
`OPENAI_API_KEY` was available. Mock results are **not** substituted.

See `artifacts/evaluation/holdout-latest.md`.

## What this means for portfolio honesty

When credentials are present, a representative failure/abstention case should
document:

1. Evidence available to the model (detectors + top source candidates only)
2. Model conclusion / patch or abstention reason
3. Which deterministic gate rejected a false success
   (schema, patch policy, target verification, regression matrix)
4. Proof that the original target checkout hash remained unchanged

## Holdout case designed for possible abstention

`holdout-cascade-shift` is intentionally multi-factor (`width` + `transform`).
Answer key marks `abstentionAcceptable: true` when the model cannot safely
choose a single minimal fix.

Until a real-provider run exists, this file records the **protocol**, not a
fabricated model failure.
