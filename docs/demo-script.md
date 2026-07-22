# Demo Script (60–90 seconds)

## Audience

Recruiters and engineers evaluating a portfolio project.

## Script

**0:00–0:10 — Problem**

“Visual bugs are easy to screenshot and hard to prove fixed. Pixel diffs don’t name the CSS rule. Coding agents propose patches without replaying the failure.”

**0:10–0:25 — Reproduce**

Open the flagship issue: desktop hero container stretch.

```bash
node packages/cli/dist/index.js run examples/issues/container-stretch.json \
  --config examples/configs/container-stretch.config.json \
  --provider mock
```

Show the before screenshot and document metrics: hero width / left edge vs shared container.

**0:25–0:40 — Evidence → source**

Point to ranked source candidates: file `styles.css`, selector `.hero`, property `max-width`/`width`, later override over `.container`.

**0:40–0:55 — Isolated repair**

Show patch policy acceptance, worktree path under `.reprosight/worktrees/`, and that the original fixture checkout hash is unchanged.

**0:55–1:15 — Verify**

Show after screenshot, pixel diff, original scenario Fixed, regression matrix across desktop/tablet/mobile, no new axe/console errors, terminal state `AWAITING_HUMAN_REVIEW`.

**1:15–1:30 — Close**

“ReproSight doesn’t merge itself. It produces evidence that the fix worked—and leaves approval to a human.”

## Second flagship (optional extra 30s)

Vietnamese tablet overflow: multi-signal root cause (`white-space: nowrap` + late grid override).
