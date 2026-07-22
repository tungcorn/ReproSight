import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { repoRoot } from "./fixture-server.js";

/**
 * Open generated flagship HTML reports in Chromium and verify:
 * - page loads without pageerror
 * - images present (data URI or loadable)
 * - key sections exist
 */
async function main() {
  const demoDir = path.join(repoRoot, "artifacts", "demo");
  const reports = [
    "report-container-stretch.html",
    "report-locale-overflow.html",
  ];

  // Prefer latest run reports if present
  const runsRoot = path.join(repoRoot, ".reprosight", "runs");
  const latestReports: string[] = [];
  try {
    const dirs = await fs.readdir(runsRoot);
    for (const id of dirs.slice(-6)) {
      const p = path.join(runsRoot, id, "report", "index.html");
      try {
        await fs.access(p);
        latestReports.push(p);
      } catch {
        // skip
      }
    }
  } catch {
    // no runs
  }

  const targets = [
    ...reports.map((r) => path.join(demoDir, r)),
    ...latestReports.slice(0, 2),
  ];

  const browser = await chromium.launch({ headless: true });
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const file of targets) {
      try {
        await fs.access(file);
      } catch {
        results.push({ file, ok: false, error: "missing" });
        continue;
      }
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      const url = `file:///${file.replace(/\\/g, "/")}`;
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const checks = await page.evaluate(() => {
        const imgs = Array.from(document.images);
        const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0);
        const dataUri = imgs.filter((i) =>
          (i.getAttribute("src") || "").startsWith("data:image"),
        );
        const text = document.body.innerText;
        return {
          title: document.title,
          imgCount: imgs.length,
          imgsLoaded: loaded.length,
          dataUriImages: dataUri.length,
          hasRootCause: /Root cause/i.test(text),
          hasPatch: /Patch/i.test(text),
          hasRegression: /Regression matrix/i.test(text),
          hasHuman: /Human/i.test(text),
          hasDecision: /Decision/i.test(text),
          hasTraceNote: /Trace before/i.test(text) || /optional/i.test(text),
        };
      });
      const ok =
        pageErrors.length === 0 &&
        checks.hasRootCause &&
        checks.hasPatch &&
        checks.hasRegression &&
        checks.hasHuman &&
        (checks.dataUriImages > 0 || checks.imgsLoaded > 0);
      results.push({
        file,
        ok,
        pageErrors,
        consoleErrors: consoleErrors.slice(0, 10),
        checks,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const out = path.join(repoRoot, "artifacts", "benchmark", "report-integrity.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify({ results }, null, 2)}\n`);
  console.log(JSON.stringify({ results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
