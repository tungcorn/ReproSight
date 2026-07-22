# Frozen real-provider evaluation protocol

## Evaluation identity

Official holdout evaluation ID is assigned at run time in:

`artifacts/evaluation/holdout/<evaluationId>/manifest.json`

Once a manifest is written for an official run:

- Do not change prompt text, model name, temperature, candidate ranking, fixtures, or scoring under the same evaluation ID.
- Any product change requires a new evaluation ID and a full re-run.

## Separation of categories

1. Deterministic detector benchmark
2. Deterministic source-localization benchmark
3. Mock orchestration benchmark
4. Real-provider repair evaluation (this holdout)

Never combine into one success percentage.

## Model input policy

The model receives only:

- Issue description / route / state / actions / assertions
- Deterministic detector evidence
- Ranked source candidates and limited source snippets
- Patch policy constraints

The model must **not** receive:

- Reference patch
- Expected file / selector / verdict
- Answer-key metadata
- API secrets

## Retry policy (official)

- `providerFailureRetries`: 0 for logical model mistakes
- Infrastructure-only retries recorded separately; default official path is one attempt per case
- No manual patch editing
- No silent malformed-JSON retry counted as success

## Result categories

`FULL_SUCCESS` · `LOCALIZED_BUT_NO_VALID_PATCH` · `VALID_PATCH_TARGET_FAILED` · `TARGET_FIXED_REGRESSION_INTRODUCED` · `APPROPRIATE_ABSTENTION` · `UNNECESSARY_ABSTENTION` · `WRONG_ROOT_CAUSE` · `PATCH_POLICY_REJECTED` · `MALFORMED_MODEL_RESPONSE` · `PROVIDER_FAILURE`
