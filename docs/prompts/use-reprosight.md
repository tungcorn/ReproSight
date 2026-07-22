# Copy-paste prompt for your coding agent

Use ReproSight to reproduce, repair, and verify this visual UI defect.

Problem:
<the user's problem>

Screenshot:
<optional screenshot path or attached image>

You are responsible for operating ReproSight.

Do not ask me to write config, issue, intake, selector, route, viewport, or detector files.

First read:

```bash
reprosight agent contract --json
```

Then discover this repository, generate the ReproSight request yourself, and run deterministic reproduction.

Use the evidence and source candidates to make a repair only inside the ReproSight isolated workspace.

Run ReproSight verification after every repair attempt.

Do not claim the issue is fixed unless ReproSight reports:

`TARGET_FIXED_REGRESSIONS_PASSED`

Report:

- reproduced state
- detector evidence
- root cause
- files changed
- verification result
- regression result
- original-checkout integrity
- human report path
- remaining uncertainty

Ask me a question only when repository and browser evidence cannot resolve a genuine product, credential, or design ambiguity.

---

## Short form

Use ReproSight to fix and verify the UI bug in this screenshot. Operate ReproSight yourself and only report success after its regression checks pass.
