# ReproSight — Evidence-driven AI Visual Repair

ReproSight reproduces visual frontend defects, collects deterministic browser evidence, localizes likely root-cause CSS rules, proposes a minimal patch inside an isolated Git worktree, reruns the failing scenario plus a regression matrix, and produces a reviewable proof report.

**The system does not merely suggest a fix. It produces evidence showing whether the fix worked.**

## 30-second explanation

1. Describe a visual bug (route, viewport, locale/theme, actions, assertions).
2. ReproSight starts the target app, replays the scenario in Chromium, and measures overflow/overlap/clipping/sticky/axe.
3. CDP + deterministic scoring ranks authored CSS candidates.
4. A model (or mock provider in CI) proposes a minimal unified diff.
5. The patch is policy-checked and applied only in a linked Git worktree.
6. The original failure and a regression matrix are re-run.
7. A self-contained HTML report awaits human approval. Nothing is merged automatically.

## Why screenshot diff alone is insufficient

- Diffs do not identify the offending DOM node or authored CSS rule
- Intentional redesign vs breakage is ambiguous
- Locale/theme/viewport matrices explode baseline surface area
- A green pixel match is not a geometric proof that overflow/occlusion is gone

## Architecture

```
Bug / issue JSON
   → deterministic browser reproduction
   → detectors + CDP source localization
   → model diagnosis (optional; mock in CI)
   → patch policy
   → isolated git worktree
   → target + regression verification
   → HTML report + dashboard review
   → human approval / export only
```

See [docs/architecture.md](docs/architecture.md).

## Quick start

Requirements: Node.js 20+ (LTS), Git, npm.

```bash
npm ci
npm run build
npx playwright install chromium

# Unit tests / typecheck
npm test
npm run typecheck

# Detector benchmark (12 fixtures)
npm run benchmark:detectors

# End-to-end mock provider runs (flagship + more)
npm run e2e:mock
```

### Run a flagship demo (mock provider)

Initialize fixture git repos once (benchmark e2e does this automatically):

```bash
# Example after fixtures are git-initialized by e2e:mock
node packages/cli/dist/index.js run examples/issues/container-stretch.json \
  --config examples/configs/container-stretch.config.json \
  --provider mock
```

Open the printed `report/index.html`.

### Dashboard

```bash
npm run dev -w @reprosight/dashboard
```

Serve or copy run artifacts under the dashboard `public/runs/<id>/` tree for browser access. The CLI HTML report works without the dashboard.

## Example issue

See [examples/issues/container-stretch.json](examples/issues/container-stretch.json).

## Safety model

- Issue actions are a fixed allow-list (no arbitrary JS)
- Page/repo content is untrusted data to the model
- Secrets are redacted from console/network evidence
- Patches: relative paths only, glob policy, size limits, forbid global `overflow-x: hidden` on `html,body`
- Target original checkout must be clean; repairs apply only in `.reprosight/worktrees/<run-id>/`
- Approval updates ReproSight metadata / export only — never commit/merge/push the target

## Benchmark (MVP)

```bash
npm run benchmark:detectors
npm run e2e:mock
```

Results write to `artifacts/benchmark/`. This is an MVP fixture bench (12 detection cases, localization subset, 6 mock e2e cases). It is **not** a claim of broad scientific validity.

## CLI

```text
reprosight init
reprosight reproduce <issue-file>
reprosight run <issue-file>
reprosight report <run-id>
reprosight export-patch <run-id>
reprosight approve <run-id>
reprosight reject <run-id> --reason "..."
reprosight clean <run-id>
reprosight serve
reprosight benchmark
```

Exit codes: `0` success/awaiting review, `2` not reproduced, `3` abstained, `4` patch rejected, `5` target failed, `6` regression, `10` infrastructure.

## Limitations

See [docs/limitations.md](docs/limitations.md). Unsupported: auth-heavy apps, Safari/Firefox repair, CSS-in-JS rewriting, Shadow DOM, auto-PR/merge, cloud SaaS.

## Documentation

- [Research](docs/research.md)
- [Architecture](docs/architecture.md)
- [Evaluation](docs/evaluation.md)
- [Threat model](docs/threat-model.md)
- [Limitations](docs/limitations.md)
- [Demo script](docs/demo-script.md)
- [Implementation plan](implementation-plan.md)

## License

MIT
