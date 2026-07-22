import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { pathExists, readJsonFile } from "../store/fs.js";
import { parseConfig, type ReproSightConfig } from "./schema.js";

const require = createRequire(import.meta.url);

function resolveRepoPath(
  config: ReproSightConfig,
  _configFilePath: string,
): ReproSightConfig {
  const repoPath = path.isAbsolute(config.project.repoPath)
    ? config.project.repoPath
    : path.resolve(process.cwd(), config.project.repoPath);
  // Prefer cwd-relative resolution; if missing, try beside config file
  return {
    ...config,
    project: {
      ...config.project,
      repoPath,
    },
  };
}

export async function loadConfig(configPath: string): Promise<ReproSightConfig> {
  const absolute = path.resolve(configPath);
  if (!(await pathExists(absolute))) {
    throw new Error(`Config not found: ${absolute}`);
  }

  if (absolute.endsWith(".json")) {
    const json = await readJsonFile<unknown>(absolute);
    const parsed = parseConfig(json);
    const withRepo = resolveRepoPath(parsed, absolute);
    // If cwd-relative path missing, fall back to config-adjacent relative path
    if (!(await pathExists(withRepo.project.repoPath))) {
      const alt = path.resolve(
        path.dirname(absolute),
        parsed.project.repoPath,
      );
      if (await pathExists(alt)) {
        return {
          ...withRepo,
          project: { ...withRepo.project, repoPath: alt },
        };
      }
    }
    return withRepo;
  }

  // Support .ts/.js configs via dynamic import (tsx/node --experimental or compiled)
  if (absolute.endsWith(".ts") || absolute.endsWith(".mts")) {
    try {
      // Prefer tsx if available for TypeScript configs
      require.resolve("tsx/cjs");
      require("tsx/cjs/api").register();
    } catch {
      // fall through to native import; may fail without loader
    }
  }

  const mod = await import(pathToFileURL(absolute).href);
  const raw = mod.default ?? mod.config ?? mod;
  return resolveRepoPath(parseConfig(raw), absolute);
}
