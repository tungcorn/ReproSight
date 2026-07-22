import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { InferredField } from "./response.js";
import { assertSafeRepoPath } from "./security.js";


export type DiscoveryResult = {
  repository: {
    root: string;
    clean: boolean;
    commit: string | null;
    isGit: boolean;
  };
  project: {
    name: InferredField<string>;
    packageManager: InferredField<string>;
    framework: InferredField<string | null>;
  };
  scripts: Record<string, string>;
  installCommandCandidates: Array<{
    command: string;
    confidence: number;
    reason: string;
  }>;
  startCommandCandidates: Array<{
    command: string;
    confidence: number;
    reason: string;
  }>;
  buildCommands: string[];
  testCommands: string[];
  readyUrlCandidates: Array<{
    url: string;
    confidence: number;
    reason: string;
  }>;
  routeCandidates: Array<{
    route: string;
    confidence: number;
    source: string;
  }>;
  entryPoints: string[];
  existingReproSightConfig: string | null;
  unresolved: string[];
  recommendedAgentAction: {
    type: string;
    arguments?: Record<string, unknown>;
  };
};

function readJsonSafe(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectPackageManager(root: string): InferredField<string> {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return {
      value: "pnpm",
      source: "repository-manifest",
      confidence: 1,
      reason: "pnpm-lock.yaml",
    };
  }
  if (fs.existsSync(path.join(root, "yarn.lock"))) {
    return {
      value: "yarn",
      source: "repository-manifest",
      confidence: 1,
      reason: "yarn.lock",
    };
  }
  if (
    fs.existsSync(path.join(root, "bun.lock")) ||
    fs.existsSync(path.join(root, "bun.lockb"))
  ) {
    return {
      value: "bun",
      source: "repository-manifest",
      confidence: 0.95,
      reason: "bun lockfile",
    };
  }
  if (fs.existsSync(path.join(root, "package-lock.json"))) {
    return {
      value: "npm",
      source: "repository-manifest",
      confidence: 1,
      reason: "package-lock.json",
    };
  }
  if (fs.existsSync(path.join(root, "package.json"))) {
    return {
      value: "npm",
      source: "framework-default",
      confidence: 0.7,
      reason: "package.json present",
    };
  }
  return {
    value: "npm",
    source: "framework-default",
    confidence: 0.3,
    requiresConfirmation: true,
    reason: "no lockfile",
  };
}

function detectFramework(
  pkg: Record<string, unknown> | null,
  root: string,
): InferredField<string | null> {
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };
  const has = (name: string) => Boolean(deps[name]);
  if (
    fs.existsSync(path.join(root, "vite.config.ts")) ||
    fs.existsSync(path.join(root, "vite.config.js")) ||
    has("vite")
  ) {
    if (has("react") || has("react-dom")) {
      return {
        value: "vite-react",
        source: "repository-manifest",
        confidence: 0.96,
        reason: "vite + react",
      };
    }
    return {
      value: "vite",
      source: "repository-manifest",
      confidence: 0.9,
      reason: "vite config/dependency",
    };
  }
  if (has("next") || fs.existsSync(path.join(root, "next.config.js"))) {
    return {
      value: "next",
      source: "repository-manifest",
      confidence: 0.95,
      reason: "next dependency/config",
    };
  }
  if (has("react")) {
    return {
      value: "react",
      source: "repository-manifest",
      confidence: 0.7,
      reason: "react dependency",
    };
  }
  // static site heuristic
  if (
    fs.existsSync(path.join(root, "index.html")) &&
    !fs.existsSync(path.join(root, "package.json"))
  ) {
    return {
      value: "static-html",
      source: "repository-source",
      confidence: 0.85,
      reason: "index.html without package.json",
    };
  }
  if (fs.existsSync(path.join(root, "index.html"))) {
    return {
      value: "static-or-bundled-html",
      source: "repository-source",
      confidence: 0.6,
      reason: "index.html present",
    };
  }
  return {
    value: null,
    source: "framework-default",
    confidence: 0.2,
    requiresConfirmation: true,
    reason: "unknown framework",
  };
}

function extractRoutes(root: string): DiscoveryResult["routeCandidates"] {
  const routes: DiscoveryResult["routeCandidates"] = [{ route: "/", confidence: 0.5, source: "default" }];
  const candidates = [
    "src/App.tsx",
    "src/App.jsx",
    "src/main.tsx",
    "src/router.tsx",
    "src/routes.tsx",
    "app/page.tsx",
    "pages/index.tsx",
  ];
  const routeRe = /["'`](\/[A-Za-z0-9_\-./]*)["'`]/g;
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    try {
      const text = fs.readFileSync(full, "utf8");
      let m: RegExpExecArray | null;
      while ((m = routeRe.exec(text))) {
        const r = m[1]!;
        if (r.length > 1 && !routes.some((x) => x.route === r)) {
          routes.push({
            route: r,
            confidence: 0.7,
            source: rel,
          });
        }
      }
    } catch {
      // ignore
    }
  }
  return routes.slice(0, 30);
}

export async function discoverRepository(
  repoPathInput: string,
): Promise<DiscoveryResult> {
  const root = assertSafeRepoPath(repoPathInput);
  const pkgPath = path.join(root, "package.json");
  const pkg = fs.existsSync(pkgPath) ? readJsonSafe(pkgPath) : null;
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};

  let isGit = false;
  let clean = true;
  let commit: string | null = null;
  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    isGit = true;
    const st = await execa("git", ["status", "--porcelain"], { cwd: root });
    clean = st.stdout.trim().length === 0;
    const head = await execa("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      reject: false,
    });
    commit = head.exitCode === 0 ? head.stdout.trim() : null;
  } catch {
    isGit = false;
  }

  const packageManager = detectPackageManager(root);
  const framework = detectFramework(pkg, root);
  const name: InferredField<string> = {
    value: String(pkg?.name ?? path.basename(root)),
    source: pkg?.name ? "repository-manifest" : "framework-default",
    confidence: pkg?.name ? 1 : 0.5,
  };

  const installCommandCandidates = [
    {
      command:
        packageManager.value === "pnpm"
          ? "pnpm install"
          : packageManager.value === "yarn"
            ? "yarn install"
            : packageManager.value === "bun"
              ? "bun install"
              : "npm ci",
      confidence: 0.9,
      reason: `package manager ${packageManager.value}`,
    },
  ];

  const startCommandCandidates: DiscoveryResult["startCommandCandidates"] = [];
  if (scripts.dev) {
    startCommandCandidates.push({
      command: `${packageManager.value === "npm" ? "npm run" : packageManager.value} dev -- --host 127.0.0.1`,
      confidence: 0.94,
      reason: "package.json scripts.dev",
    });
  }
  if (scripts.start) {
    startCommandCandidates.push({
      command: `${packageManager.value === "npm" ? "npm run" : packageManager.value} start`,
      confidence: 0.8,
      reason: "package.json scripts.start",
    });
  }
  if (scripts.preview) {
    startCommandCandidates.push({
      command: `${packageManager.value === "npm" ? "npm run" : packageManager.value} preview -- --host 127.0.0.1`,
      confidence: 0.42,
      reason: "requires prior production build",
    });
  }
  if (fs.existsSync(path.join(root, "index.html")) && startCommandCandidates.length === 0) {
    // monorepo helper if present at caller cwd; path may be absolute later
    startCommandCandidates.push({
      command: "node scripts/static-serve.mjs 4173 .",
      confidence: 0.7,
      reason: "static index.html fallback via ReproSight static-serve",
    });
  }

  const readyUrlCandidates = [
    {
      url: "http://127.0.0.1:5173",
      confidence: framework.value?.includes("vite") ? 0.85 : 0.4,
      reason: "common Vite port",
    },
    {
      url: "http://127.0.0.1:4173",
      confidence: 0.55,
      reason: "common preview/static port",
    },
    {
      url: "http://127.0.0.1:3000",
      confidence: framework.value === "next" ? 0.85 : 0.35,
      reason: "common Next/React port",
    },
  ];

  const entryPoints = [
    "index.html",
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/App.tsx",
  ].filter((p) => fs.existsSync(path.join(root, p)));

  const existingConfigs = [
    "reprosight.config.json",
    "reprosight.config.ts",
  ].find((p) => fs.existsSync(path.join(root, p)));

  const unresolved: string[] = [];
  if (startCommandCandidates.length === 0) {
    unresolved.push("startCommand");
  }
  if (startCommandCandidates.length > 1) {
    // not unresolved if ranked — agent can choose
  }
  if (!framework.value) unresolved.push("framework");

  return {
    repository: { root, clean, commit, isGit },
    project: { name, packageManager, framework },
    scripts,
    installCommandCandidates,
    startCommandCandidates,
    buildCommands: [scripts.build].filter(Boolean) as string[],
    testCommands: [scripts.test].filter(Boolean) as string[],
    readyUrlCandidates,
    routeCandidates: extractRoutes(root),
    entryPoints,
    existingReproSightConfig: existingConfigs
      ? path.join(root, existingConfigs)
      : null,
    unresolved,
    recommendedAgentAction: {
      type: "CALL_PREPARE",
      arguments: {},
    },
  };
}
