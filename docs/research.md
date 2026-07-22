# ReproSight Research Notes

## Problem framing

Frontend visual defects are often intermittent across viewport, locale, and theme. Teams currently rely on:

1. Manual QA and screenshots in chat
2. Pixel-diff visual regression tools (Chromatic, Percy, Playwright screenshots)
3. Generic coding agents that propose CSS changes without verifying the original failure

These approaches leave a gap between **detecting that something looks wrong** and **proving that a proposed fix repaired the exact failure without regressions**.

## Visual regression vs visual repair

| Concern | Visual regression | Visual repair (ReproSight) |
| --- | --- | --- |
| Primary question | Did pixels change? | Why did layout fail, and does this patch fix it? |
| Oracle | Baseline image | Deterministic detectors + scenario assertions |
| Output | Diff image / pass-fail | Evidence pack + ranked CSS candidates + verified patch |
| Autonomy | None (review diffs) | Assisted diagnosis; human approval required |
| Risk | False positives from animation/font noise | False success if verification is weak |

Screenshot diff alone is insufficient because:

- It does not identify the offending DOM node or authored CSS rule
- It cannot distinguish intentional redesign from layout breakage
- Locale/theme/viewport matrices explode the baseline surface area
- It does not prove a proposed CSS change fixed the original measurement failure

## Deterministic evidence vs model reasoning

ReproSight splits responsibilities:

**Deterministic code owns:**

- Process lifecycle, browser launch, route/state setup
- Layout measurements (overflow, overlap, clipping, sticky occlusion)
- Accessibility scans (axe), console and network failures
- CDP-authored CSS collection and candidate scoring
- Patch path policy, worktree isolation, verification matrix

**The language model owns only:**

- Interpreting natural-language issue text
- Selecting which evidence items matter
- Explaining root cause in human language
- Proposing a minimal unified diff
- Suggesting focused regression scenarios
- Abstaining when evidence is insufficient

This split reduces prompt-injection surface area and makes every claim machine-checkable.

## Screenshot-to-source localization

Localization pipeline:

1. Reproduce the failing state in Chromium
2. Detect geometric offenders (rectangles, overflow amounts, intersections)
3. For each offender, query CDP for box model, computed styles, and matched CSS rules
4. Map stylesheet URLs from the local dev server back to repository-relative paths
5. Rank rules by property relevance, media-query context, and selector specificity signals
6. Emit source candidates with file, line range, selector, property, and reason

The model never invents file paths or line numbers. If authored source cannot be resolved, the system reports that explicitly.

## Why human approval remains required

Even with strong evidence:

- Visual intent is product judgment, not pure geometry
- A “fixed” overflow can still harm design balance
- Locale copy changes may require design-system decisions
- Automated axe findings are incomplete relative to WCAG manual audit
- Patch policy can reject dangerous diffs but cannot certify product correctness

ReproSight therefore ends every successful repair in `AWAITING_HUMAN_REVIEW`. Approval updates ReproSight metadata and allows patch export only. It never commits, merges, or pushes into the target repository.

## Related prior art (conceptual)

- Visual regression services: good at change detection, weak at root-cause localization
- Browser DevTools: excellent for interactive diagnosis, not for closed-loop repair evidence
- Coding agents: strong at generating diffs, weak at deterministic reproduction and regression proof
- Accessibility engines (axe): valuable signals, not a complete audit or layout oracle

ReproSight is positioned as an evidence-driven repair loop, not a replacement for any single tool above.

## Research conclusions for the MVP

1. Deterministic detectors must be independent of the model.
2. Source localization must use CDP matched rules, not model guesses.
3. Patches must apply only in isolated Git worktrees.
4. Verification must re-run the original scenario before the broader matrix.
5. Reports must make the evidence chain reviewable by an engineer in under a few minutes.
6. Benchmark fixtures must be small, deterministic, and honest about coverage limits.
