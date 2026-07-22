# ReproSight Task Tracker

## Product claim

ReproSight does not merely suggest a fix. It produces evidence showing whether the fix worked.

## Checkpoint status

| CP | Name | Status |
| --- | --- | --- |
| 0 | Research and plan | in progress |
| 1 | Workspace, schemas, store | pending |
| 2 | Browser runner | pending |
| 3 | Detectors | pending |
| 4 | Source localization | pending |
| 5 | Diagnosis + patch safety | pending |
| 6 | Worktree patcher | pending |
| 7 | Verification matrix | pending |
| 8 | HTML report | pending |
| 9 | Dashboard | pending |
| 10 | Benchmark + flagships | pending |
| 11 | CI + final docs | pending |

## Non-goals (MVP)

- Multi-agent debates
- Cloud SaaS
- Auto-merge / auto-PR
- Vector DB / Redis / Postgres
- CSS-in-JS rewriting
- Safari/Firefox repair

## Definition of done (summary)

CLI complete mock run → real fixture reproduced → evidence collected → CSS localized → patch policy pass → isolated worktree apply → original checkout unchanged → scenario + matrix verified → report generated → honest benchmarks → tests/typecheck/lint/build pass → incremental commits → clean tree.
