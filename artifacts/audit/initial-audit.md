# Initial Evidence Audit (pre-edit)

Date: 2026-07-22  
HEAD: `5c79ad7`  
Branch: `main`

## Environment

- Node: v22.15.0
- npm: 10.9.2
- Git root: `D:/Hoc/MyProjects/ReproSight`

## Git status (pre-edit)

```
?? .reprosight/
```

Ignored sample:

```
!! .reprosight/runs/
!! .reprosight/worktrees/
!! node_modules/
!! packages/*/dist/
!! fixtures/*/.gitattributes
```

`git check-ignore -v .reprosight` → no match (root not ignored)  
`git check-ignore -v .reprosight/runs` → matched  
`git check-ignore -v .reprosight/worktrees` → matched  
`git check-ignore -v .reprosight/provider-logs` → no match

## Commands

| Command | Exit | Duration (s) | Notes |
| --- | ---: | ---: | --- |
| npm ci | 0 | 7.0 | 149 packages |
| typecheck | 0 | 10.9 | tsc --noEmit all packages |
| lint | 0 | 6.4 | **alias of tsc only — not real lint** |
| test | 0 | 5.5 | 23/23 core unit tests |
| build | 0 | 10.4 | core/cli/benchmark/dashboard |
| benchmark:detectors | 0 | 36.2 | detector hit **12/12**; loc top1 75%; top3 91.7% |
| e2e:mock | 0 | 68.6 | **6/6** AWAITING_HUMAN_REVIEW |

## Detector per-case (this audit)

All 12 expected primary detectors hit. Sticky passed in this run.

Localization misses: locale-overflow (top3 only), grid-mincontent (miss), mobile-nav (top3 only).

## Claims to harden

1. Ignore entire `.reprosight/` runtime root
2. Replace fake lint with ESLint (keep typecheck separate)
3. Prove detector 12/12 across 10 consecutive runs
4. Localization error analysis artifact
5. Mock clean-room matrix + real-provider gate
