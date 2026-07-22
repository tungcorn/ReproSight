import type { RunRecord } from "../store/run-store.js";
import type { IssueSpec } from "../scenario/issue.js";
import type { EvidencePack } from "../evidence/types.js";
import type { DiagnosisOutput } from "../diagnosis/types.js";
import type { PatchValidationResult } from "../patcher/policy.js";
import type { VerificationResult } from "../verifier/verify.js";
import { writeAtomic } from "../store/fs.js";
import path from "node:path";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function generateHtmlReport(opts: {
  run: RunRecord;
  issue: IssueSpec;
  evidence: EvidencePack | null;
  diagnosis: DiagnosisOutput | null;
  patchValidation: PatchValidationResult | null;
  patchDiff: string | null;
  verification: VerificationResult | null;
  outPath: string;
}): Promise<string> {
  const { run, issue, evidence, diagnosis, patchValidation, patchDiff, verification } =
    opts;

  const artifact = (rel: string) => `../${rel.replace(/\\/g, "/")}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ReproSight Report — ${esc(run.id)}</title>
<style>
  :root { color-scheme: light dark; --bg:#0b1220; --card:#121a2b; --text:#e5eefc; --muted:#9fb0c7; --accent:#38bdf8; --ok:#34d399; --bad:#f87171; --warn:#fbbf24; --border:#243247; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial; background:var(--bg); color:var(--text); }
  header { padding:24px 28px; border-bottom:1px solid var(--border); background:linear-gradient(180deg,#121a2b,#0b1220); }
  h1 { margin:0 0 6px; font-size:22px; }
  h2 { margin:28px 0 12px; font-size:16px; color:var(--accent); }
  .meta { color:var(--muted); display:flex; flex-wrap:wrap; gap:12px 18px; }
  main { padding:20px 28px 60px; max-width:1100px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; border:1px solid var(--border); }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); }
  img { max-width:100%; border-radius:8px; border:1px solid var(--border); background:#000; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid var(--border); vertical-align:top; }
  pre { background:#0a101b; border:1px solid var(--border); border-radius:8px; padding:12px; overflow:auto; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
  .kv { display:grid; grid-template-columns:160px 1fr; gap:6px 10px; }
  .kv div:nth-child(odd) { color:var(--muted); }
  footer { margin-top:36px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>ReproSight Evidence Report</h1>
  <div class="meta">
    <span>Run <code>${esc(run.id)}</code></span>
    <span>Issue <code>${esc(issue.id)}</code></span>
    <span>Project <code>${esc(run.projectName)}</code></span>
    <span>State <span class="badge">${esc(run.state)}</span></span>
    <span>Verdict <span class="badge">${esc(run.finalVerdict ?? "n/a")}</span></span>
    <span>Human <span class="badge">${esc(run.human.status)}</span></span>
  </div>
</header>
<main>
  <h2>1. Summary</h2>
  <div class="card">
    <div class="kv">
      <div>Title</div><div>${esc(issue.title)}</div>
      <div>Description</div><div>${esc(issue.description)}</div>
      <div>Route / state</div><div><code>${esc(issue.route)}</code> · ${issue.state.viewport.width}×${issue.state.viewport.height} · ${esc(issue.state.locale)} · ${esc(issue.state.theme)}</div>
      <div>Base ref</div><div><code>${esc(run.baseRef)}</code></div>
      <div>Provider</div><div>${esc(run.provider)}</div>
      <div>Worktree</div><div><code>${esc(run.worktreePath ?? "n/a")}</code></div>
      <div>Original checkout hash</div><div><code>${esc(run.originalCheckoutHash ?? "n/a")}</code></div>
    </div>
  </div>

  <h2>2. Reproduction</h2>
  <div class="grid">
    <div class="card">
      <strong>Before</strong>
      <div><img src="${artifact("artifacts/before.png")}" alt="before"/></div>
    </div>
    <div class="card">
      <strong>Before annotated</strong>
      <div><img src="${artifact("artifacts/before-annotated.png")}" alt="before annotated"/></div>
    </div>
  </div>
  <div class="card" style="margin-top:12px">
    <strong>Document metrics</strong>
    <pre><code>${esc(JSON.stringify(evidence?.detectors.documentMetrics ?? {}, null, 2))}</code></pre>
    <strong>Detector findings</strong>
    <pre><code>${esc(JSON.stringify({
      overflow: evidence?.detectors.horizontalOverflow ?? [],
      overlap: evidence?.detectors.overlap ?? [],
      clipping: evidence?.detectors.textClipping ?? [],
      sticky: evidence?.detectors.stickyOcclusion ?? [],
      axe: evidence?.detectors.accessibility ?? null,
    }, null, 2))}</code></pre>
  </div>

  <h2>3. Root cause & source candidates</h2>
  <div class="card">
    <p>${esc(diagnosis?.summary ?? "No diagnosis")}</p>
    <p>Confidence: <strong>${diagnosis?.rootCause.confidence ?? "n/a"}</strong></p>
    <table>
      <thead><tr><th>Rank</th><th>File</th><th>Line</th><th>Selector</th><th>Property</th><th>Value</th><th>Reason</th></tr></thead>
      <tbody>
      ${(evidence?.sourceCandidates ?? []).slice(0, 15).map((c) => `
        <tr>
          <td>${c.rank}</td>
          <td><code>${esc(c.file ?? "unresolved")}</code></td>
          <td>${c.line ?? "—"}</td>
          <td><code>${esc(c.selector)}</code></td>
          <td><code>${esc(c.property)}</code></td>
          <td><code>${esc(c.value)}</code></td>
          <td>${esc(c.reason)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${evidence?.sourceCandidates.some((c) => !c.file) ? `<p class="warn">Some authored sources could not be resolved to repository paths.</p>` : ""}
  </div>

  <h2>4. Patch</h2>
  <div class="card">
    <p>${esc(diagnosis?.patch.rationale ?? "")}</p>
    <p>Policy: <span class="${patchValidation?.accepted ? "ok" : "bad"}">${patchValidation?.accepted ? "accepted" : "rejected"}</span>
    ${(patchValidation?.reasons ?? []).map((r) => esc(r)).join("; ")}</p>
    <p>Files: ${(patchValidation?.files ?? []).map((f) => `<code>${esc(f)}</code>`).join(", ") || "n/a"}
    · +${patchValidation?.addedLines ?? 0}/-${patchValidation?.deletedLines ?? 0}</p>
    <pre><code>${esc(patchDiff ?? diagnosis?.patch.unifiedDiff ?? "(no patch)")}</code></pre>
    ${diagnosis?.abstainReason ? `<p class="warn">Abstained: ${esc(diagnosis.abstainReason)}</p>` : ""}
  </div>

  <h2>5. Verification</h2>
  <div class="grid">
    <div class="card">
      <strong>After</strong>
      <div><img src="${artifact("artifacts/after.png")}" alt="after"/></div>
    </div>
    <div class="card">
      <strong>Diff</strong>
      <div><img src="${artifact("artifacts/diff.png")}" alt="diff"/></div>
    </div>
  </div>
  <div class="card" style="margin-top:12px">
    <div class="kv">
      <div>Target verdict</div><div class="${verification?.target.verdict === "Fixed" ? "ok" : "bad"}">${esc(verification?.target.verdict ?? "n/a")}</div>
      <div>Target failures</div><div>${esc((verification?.target.failures ?? []).join("; ") || "none")}</div>
      <div>Overall</div><div>${esc(verification?.overall ?? "n/a")}</div>
      <div>Axe before→after</div><div>${verification?.axeComparison.before ?? "?"} → ${verification?.axeComparison.after ?? "?"}</div>
      <div>New axe</div><div>${esc((verification?.axeComparison.newViolationIds ?? []).join(", ") || "none")}</div>
      <div>New console errors</div><div>${esc((verification?.consoleComparison.newErrors ?? []).join(" | ") || "none")}</div>
      <div>Screenshot note</div><div>Screenshots from different environments are not exact equivalents.</div>
    </div>
    <h3>Regression matrix</h3>
    <table>
      <thead><tr><th>State</th><th>Viewport</th><th>Locale</th><th>Theme</th><th>Pass</th><th>Failures</th></tr></thead>
      <tbody>
      ${(verification?.regressions ?? []).map((r) => `
        <tr>
          <td>${esc(r.name)}</td>
          <td>${r.viewport.width}×${r.viewport.height}</td>
          <td>${esc(r.locale)}</td>
          <td>${esc(r.theme)}</td>
          <td class="${r.passed ? "ok" : "bad"}">${r.passed ? "pass" : "fail"}</td>
          <td>${esc(r.failures.join("; ") || "")}</td>
        </tr>`).join("") || `<tr><td colspan="6">No regression matrix (target not fixed or not run)</td></tr>`}
      </tbody>
    </table>
  </div>

  <h2>6. Decision</h2>
  <div class="card">
    <p>Human review is required. Approval updates ReproSight metadata and allows patch export only. It does not commit, merge, or push the target repository.</p>
    <pre><code>reprosight export-patch ${esc(run.id)}
reprosight approve ${esc(run.id)}
reprosight reject ${esc(run.id)} --reason "..."
reprosight clean ${esc(run.id)}</code></pre>
  </div>

  <footer>
    Generated by ReproSight · pipeline transitions: ${run.transitions.length} ·
    artifacts present: ${run.artifacts.filter((a) => a.present).length}/${run.artifacts.length}
  </footer>
</main>
</body>
</html>`;

  await writeAtomic(opts.outPath, html);
  return opts.outPath;
}

export function reportPathForRun(runDir: string): string {
  return path.join(runDir, "report", "index.html");
}
