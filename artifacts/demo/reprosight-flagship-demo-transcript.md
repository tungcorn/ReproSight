# Flagship demo transcript (storyboard)

**Persistent label shown throughout:**  
`Deterministic mock provider — pipeline demonstration, not model accuracy`

**Video status:** missing (no capture tool / no fabricated WebM).  
**Frames (tracked demo assets, not a duplicate storyboard dump):**

| t | Frame | Narration |
| --- | --- | --- |
| 0:00 | Broken hero at 1440×900 | “At desktop width the hero stretches edge-to-edge.” |
| 0:10 | CLI command | Run `reprosight run … --provider mock` (see commands file). |
| 0:20 | `artifacts/demo/container-stretch-before.png` | Exact failing viewport captured. |
| 0:28 | `artifacts/demo/container-stretch-annotated.png` | Deterministic overflow offenders annotated. |
| 0:38 | `artifacts/demo/report-container-stretch.html` | Authored CSS candidate in `styles.css` / `.hero`. |
| 0:48 | Patch section in report | Minimal unified diff only. |
| 0:55 | Worktree path in report | Patch applied under `.reprosight/worktrees/<run-id>/`. |
| 1:00 | Original checkout hash | Original fixture checkout hash unchanged. |
| 1:05 | `container-stretch-after.png` + `container-stretch-diff.png` | Target fixed; visual diff as evidence only. |
| 1:15 | Regression rows in report | Desktop/tablet/mobile pass. |
| 1:20 | Verdict | `AWAITING_HUMAN_REVIEW` — human approval required. |

Source run: `run_2026-07-22T05-02-53-032Z_8dda7585`  
Target verdict: Fixed · Overall: VERIFIED
