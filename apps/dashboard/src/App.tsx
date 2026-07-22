import { useCallback, useEffect, useMemo, useState } from "react";

type RunSummary = {
  id: string;
  createdAt: string;
  state: string;
  issueId: string;
  projectName: string;
  finalVerdict: string | null;
  human: { status: string; reason?: string };
  rootDir: string;
};

type LoadedRun = {
  run: RunSummary & Record<string, unknown>;
  issue?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  diagnosis?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  patch?: string;
  sourceCandidates?: unknown[];
};

function runIdFromLocation(): string | null {
  const path = window.location.pathname;
  const m = path.match(/\/run\/([^/]+)/);
  if (m?.[1]) return decodeURIComponent(m[1]);
  const q = new URLSearchParams(window.location.search).get("run");
  return q;
}

/**
 * Local run review UI.
 * Artifact root: monorepo `.reprosight/runs` served by Vite middleware.
 * Start: `npm run dev -w @reprosight/dashboard`
 */
export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualRoot, setManualRoot] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) throw new Error(`Failed to list runs: ${res.status}`);
      const data = (await res.json()) as RunSummary[];
      setRuns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const loadRun = useCallback(async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      const base = `/runs/${id}`;
      const run = await fetchJson(`${base}/run.json`);
      const issue = await fetchJsonOptional(`${base}/issue.json`);
      const evidence = await fetchJsonOptional(`${base}/evidence.json`);
      const diagnosis = await fetchJsonOptional(`${base}/diagnosis.json`);
      const verification = await fetchJsonOptional(`${base}/verification.json`);
      const patch = await fetchTextOptional(`${base}/patch.diff`);
      const sourceCandidatesRaw = await fetchJsonOptional(
        `${base}/artifacts/source-candidates.json`,
      );
      const sourceCandidates = Array.isArray(sourceCandidatesRaw)
        ? (sourceCandidatesRaw as unknown[])
        : ((evidence as { sourceCandidates?: unknown[] } | undefined)
            ?.sourceCandidates ?? undefined);
      setLoaded({
        run: run as LoadedRun["run"],
        issue,
        evidence,
        diagnosis,
        verification,
        patch: patch ?? undefined,
        sourceCandidates,
      });
      setSelected(id);
      const next = `/run/${encodeURIComponent(id)}`;
      if (window.location.pathname !== next) {
        window.history.pushState({}, "", next);
      }
    } catch (err) {
      setLoaded(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const initial = runIdFromLocation();
    if (initial) void loadRun(initial);
    const onPop = () => {
      const id = runIdFromLocation();
      if (id) void loadRun(id);
      else {
        setSelected(null);
        setLoaded(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadRun]);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selected) ?? null,
    [runs, selected],
  );

  const verification = loaded?.verification as
    | {
        target?: { verdict?: string; failures?: string[] };
        regressions?: Array<Record<string, unknown>>;
        overall?: string;
      }
    | undefined;

  return (
    <>
      <header>
        <div>
          <strong>ReproSight</strong>{" "}
          <span className="muted">local run review</span>
        </div>
        <span className="badge">approval does not commit target repos</span>
      </header>
      <main>
        <section className="list">
          <div className="card" style={{ margin: 12 }}>
            <div className="muted" style={{ marginBottom: 8 }}>
              Artifact root: <code>.reprosight/runs</code> via Vite middleware.
              Command: <code>npm run dev -w @reprosight/dashboard</code>
            </div>
            <button type="button" onClick={() => void refreshRuns()} style={{ width: "100%", marginBottom: 8 }}>
              Refresh runs
            </button>
            <input
              style={{ width: "100%", marginBottom: 8 }}
              placeholder="run id"
              value={manualRoot}
              onChange={(e) => setManualRoot(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void loadRun(manualRoot.trim())}
              style={{ width: "100%" }}
              disabled={!manualRoot.trim() || busy}
            >
              Load run
            </button>
          </div>
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              className={selected === r.id ? "active" : ""}
              onClick={() => void loadRun(r.id)}
            >
              <div>{r.issueId || r.id}</div>
              <div className="muted">
                {r.state} · {r.finalVerdict ?? "—"}
              </div>
            </button>
          ))}
          {!runs.length && (
            <div className="muted" style={{ padding: 14 }}>
              No runs under <code>.reprosight/runs</code>. Run{" "}
              <code>npm run e2e:mock</code> or{" "}
              <code>node packages/cli/dist/index.js run …</code> first.
            </div>
          )}
        </section>
        <section className="detail">
          {error && (
            <div className="card">
              <strong>Honest incomplete/invalid state</strong>
              <div className="muted">{error}</div>
            </div>
          )}
          {!loaded && !error && (
            <div className="card muted">
              Select a run to inspect before/after evidence, source candidates,
              patch, and regression matrix.
            </div>
          )}
          {loaded && (
            <>
              <div className="card">
                <h2 style={{ marginTop: 0 }}>
                  {String(loaded.issue?.title ?? loaded.run.issueId)}
                </h2>
                <div className="muted">
                  {loaded.run.id} · {String(loaded.run.state)} · human{" "}
                  {String(
                    (loaded.run.human as { status?: string } | undefined)
                      ?.status ?? "pending",
                  )}
                </div>
              </div>
              <div className="grid">
                <div className="card">
                  <strong>Before</strong>
                  <div>
                    <img
                      src={`/runs/${loaded.run.id}/artifacts/before.png`}
                      alt="before"
                    />
                  </div>
                </div>
                <div className="card">
                  <strong>After</strong>
                  <div>
                    <img
                      src={`/runs/${loaded.run.id}/artifacts/after.png`}
                      alt="after"
                    />
                  </div>
                </div>
                <div className="card">
                  <strong>Diff</strong>
                  <div>
                    <img
                      src={`/runs/${loaded.run.id}/artifacts/diff.png`}
                      alt="diff"
                    />
                  </div>
                </div>
              </div>
              <div className="card">
                <strong>Source candidates</strong>
                <pre>
                  {JSON.stringify(loaded.sourceCandidates ?? [], null, 2)}
                </pre>
              </div>
              <div className="card">
                <strong>Unified diff</strong>
                <pre>{loaded.patch ?? "(no patch)"}</pre>
              </div>
              <div className="card">
                <strong>Verification / regressions</strong>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Overall: {verification?.overall ?? "n/a"} · Target:{" "}
                  {verification?.target?.verdict ?? "n/a"}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Pass</th>
                      <th>Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(verification?.regressions ?? []).map((r, i) => (
                      <tr key={i}>
                        <td>{String(r.name ?? "")}</td>
                        <td>{r.passed ? "pass" : "fail"}</td>
                        <td>
                          {Array.isArray(r.failures)
                            ? (r.failures as string[]).join("; ")
                            : ""}
                        </td>
                      </tr>
                    ))}
                    {!verification?.regressions?.length && (
                      <tr>
                        <td colSpan={3}>No regression rows</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {selectedRun && (
                <div className="card muted">
                  Project: {selectedRun.projectName} · created{" "}
                  {selectedRun.createdAt}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

async function fetchJsonOptional(
  url: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(url);
  if (!res.ok) return undefined;
  return (await res.json()) as Record<string, unknown>;
}

async function fetchTextOptional(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}
