# Demo Script (60–90 seconds) — evidence walkthrough

## Status of video capture

**No in-repo WebM was recorded in this hardening pass.**  
Recommended external path if captured later:

`artifacts/demo/reprosight-flagship-demo.webm` (gitignored by size policy)

Until a real capture exists, use this live walkthrough with actual CLI/report output.

## Narrative (container-stretch)

**0:00–0:10 — Broken state**

Open the fixture at 1440×900. Show the hero edge-to-edge vs the constrained body content.

**0:10–0:25 — Reproduce**

```bash
node packages/cli/dist/index.js run examples/issues/container-stretch.json \
  --config examples/configs/container-stretch.config.json \
  --provider mock
```

Point to terminal: state transitions and run id.

**0:25–0:40 — Evidence**

Open `.reprosight/runs/<id>/report/index.html` (self-contained data-URI images).

Show:

- Before + annotated screenshot
- Document metrics / overflow offenders
- Ranked CSS candidates: `styles.css`, `.hero`, `max-width` / `min-width`

**0:40–0:55 — Patch + isolation**

Show unified diff (remove bad hero override only), policy accepted, worktree path under `.reprosight/worktrees/…`, original checkout hash unchanged.

**0:55–1:15 — Verify**

After screenshot, pixel diff, target Fixed, regression matrix, no new axe/console, terminal state `AWAITING_HUMAN_REVIEW`.

**1:15–1:30 — Close**

“ReproSight doesn’t merge itself. It produces evidence that the fix worked—and leaves approval to a human.”

## Optional second beat (30s)

Vietnamese tablet overflow: multi-signal root cause (`white-space: nowrap` + late grid override). Report: `artifacts/demo/report-locale-overflow.html`.
