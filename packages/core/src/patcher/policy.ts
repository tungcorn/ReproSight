import parseDiff from "parse-diff";
import {
  isAbsoluteOrTraversal,
  matchesAnyGlob,
  toRepoRelative,
} from "../security/paths.js";
import type { ReproSightConfig } from "../config/schema.js";

export type PatchValidationResult = {
  accepted: boolean;
  reasons: string[];
  files: string[];
  addedLines: number;
  deletedLines: number;
  forbiddenPatterns: string[];
};

const FORBIDDEN_DIFF_SNIPPETS = [
  {
    id: "global-overflow-hidden",
    re: /(html|body)\s*,\s*(html|body)\s*\{[^}]*overflow-x\s*:\s*hidden/i,
    message:
      "Rejected global overflow-x:hidden on html/body (hides rather than fixes)",
  },
  {
    id: "skip-test",
    re: /\b(it|test|describe)\.(skip|only)\b/,
    message: "Rejected test skip/only modifications",
  },
];

export function validateUnifiedDiff(
  unifiedDiff: string,
  policy: ReproSightConfig["patchPolicy"],
): PatchValidationResult {
  const reasons: string[] = [];
  const forbiddenPatterns: string[] = [];

  if (!unifiedDiff || !unifiedDiff.trim()) {
    return {
      accepted: false,
      reasons: ["Empty patch"],
      files: [],
      addedLines: 0,
      deletedLines: 0,
      forbiddenPatterns,
    };
  }

  let files: ReturnType<typeof parseDiff>;
  try {
    files = parseDiff(unifiedDiff);
  } catch (err) {
    return {
      accepted: false,
      reasons: [
        `Failed to parse unified diff: ${err instanceof Error ? err.message : String(err)}`,
      ],
      files: [],
      addedLines: 0,
      deletedLines: 0,
      forbiddenPatterns,
    };
  }

  if (files.length === 0) {
    reasons.push("No file hunks found in diff");
  }

  const changedFiles: string[] = [];
  let addedLines = 0;
  let deletedLines = 0;

  for (const file of files) {
    const filePath = toRepoRelative(
      file.to === "/dev/null" ? file.from || "" : file.to || file.from || "",
    );
    if (!filePath || filePath === "/dev/null") {
      reasons.push("Diff contains unreadable file path");
      continue;
    }
    if (isAbsoluteOrTraversal(filePath)) {
      reasons.push(`Path rejected (absolute or traversal): ${filePath}`);
      continue;
    }
    if (matchesAnyGlob(filePath, policy.deniedGlobs)) {
      reasons.push(`Path denied by policy: ${filePath}`);
      continue;
    }
    if (
      policy.allowedGlobs.length > 0 &&
      !matchesAnyGlob(filePath, policy.allowedGlobs)
    ) {
      reasons.push(`Path not in allowed globs: ${filePath}`);
      continue;
    }
    changedFiles.push(filePath);
    for (const chunk of file.chunks) {
      for (const change of chunk.changes) {
        if (change.type === "add") addedLines += 1;
        if (change.type === "del") deletedLines += 1;
      }
    }
  }

  if (changedFiles.length > policy.maxFiles) {
    reasons.push(
      `Too many files changed: ${changedFiles.length} > ${policy.maxFiles}`,
    );
  }
  if (addedLines > policy.maxAddedLines) {
    reasons.push(
      `Too many added lines: ${addedLines} > ${policy.maxAddedLines}`,
    );
  }
  if (deletedLines > policy.maxDeletedLines) {
    reasons.push(
      `Too many deleted lines: ${deletedLines} > ${policy.maxDeletedLines}`,
    );
  }

  for (const rule of FORBIDDEN_DIFF_SNIPPETS) {
    if (rule.re.test(unifiedDiff)) {
      forbiddenPatterns.push(rule.id);
      reasons.push(rule.message);
    }
  }

  // Binary markers
  if (/^GIT binary patch/m.test(unifiedDiff) || /Binary files /m.test(unifiedDiff)) {
    reasons.push("Binary patches are not allowed");
  }

  return {
    accepted: reasons.length === 0 && changedFiles.length > 0,
    reasons,
    files: [...new Set(changedFiles)],
    addedLines,
    deletedLines,
    forbiddenPatterns,
  };
}
