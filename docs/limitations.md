# Limitations

## Explicitly unsupported in this MVP

- Authentication-heavy applications and multi-step login flows
- Native mobile applications
- Safari / Firefox repair loops (Chromium only)
- Next.js server-component / server-action internals
- CSS-in-JS runtime source rewriting (styled-components, Emotion runtime)
- Shadow DOM repair
- Cross-origin iframe inspection
- Production cloud deployment / multi-tenant SaaS
- Multiple simultaneous agent workers
- Automatic pull requests, merges, or pushes
- Database-backed persistence (filesystem artifacts only)
- Team accounts, billing, cloud browser farms
- Full WCAG certification or manual accessibility audits
- Guarantees of design correctness

## Known technical limits

- Screenshot comparisons are environment-sensitive (fonts, OS, GPU, antialiasing)
- Authored CSS localization depends on local dev server source maps / stylesheet URLs
- Plain CSS and style tags are supported; advanced preprocessor source maps may be partial
- Decorative fixed elements can still produce noise; ignore selectors are required in some apps
- Intentional ellipsis / line-clamp may need configuration to avoid false clipping findings
- Mock provider covers flagship fixtures; real-model quality varies by provider and model
- Target repositories must be clean Git checkouts for repair isolation
- Windows local development and Linux CI are first-class; other OS combinations are best-effort

## Product honesty

ReproSight does not claim:

- That a green verification means product managers would ship the visual result
- That axe findings equal accessibility compliance
- That the MVP benchmark generalizes to all websites
- That the model cannot make mistakes within allowed patch globs

Human review remains mandatory.
