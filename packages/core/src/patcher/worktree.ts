import path from "node:path";
import { createHash } from "node:crypto";
import { execa } from "execa";
import fs from "node:fs/promises";
import { ensureDir, pathExists, writeAtomic } from "../store/fs.js";

export async function assertCleanGitRepo(repoPath: string): Promise<void> {
  const { stdout } = await execa("git", ["status", "--porcelain"], {
    cwd: repoPath,
  });
  if (stdout.trim().length > 0) {
    throw new Error(
      `Target repository is not clean. Commit or stash changes before repair:\n${stdout}`,
    );
  }
}

export async function hashCheckout(repoPath: string): Promise<string> {
  const { stdout } = await execa(
    "git",
    ["ls-files", "-z", "--with-tree=HEAD"],
    { cwd: repoPath },
  );
  // Prefer commit hash + status for speed/integrity
  const head = await execa("git", ["rev-parse", "HEAD"], { cwd: repoPath });
  const status = await execa("git", ["status", "--porcelain"], {
    cwd: repoPath,
  });
  return createHash("sha256")
    .update(head.stdout)
    .update("|")
    .update(status.stdout)
    .update("|")
    .update(stdout.slice(0, 2000))
    .digest("hex");
}

export async function createLinkedWorktree(opts: {
  repoPath: string;
  runId: string;
  baseRef: string;
  reproRoot: string;
}): Promise<{ worktreePath: string; branch: string }> {
  const worktreePath = path.join(
    opts.reproRoot,
    "worktrees",
    opts.runId,
  );
  if (await pathExists(worktreePath)) {
    await removeWorktree({
      repoPath: opts.repoPath,
      worktreePath,
      force: true,
    });
  }
  await ensureDir(path.dirname(worktreePath));
  const branch = `reprosight/${opts.runId}`;
  // remove branch if leftover
  await execa("git", ["branch", "-D", branch], {
    cwd: opts.repoPath,
    reject: false,
  });
  await execa(
    "git",
    ["worktree", "add", "-b", branch, worktreePath, opts.baseRef],
    { cwd: opts.repoPath },
  );
  return { worktreePath, branch };
}

export async function applyPatchInWorktree(opts: {
  worktreePath: string;
  unifiedDiff: string;
  checkOnly?: boolean;
}): Promise<{ ok: boolean; output: string }> {
  const patchPath = path.join(opts.worktreePath, ".reprosight-patch.diff");
  await writeAtomic(patchPath, opts.unifiedDiff);
  // --recount helps when context lines differ slightly; whitespace ignore aids CRLF hosts
  const args = opts.checkOnly
    ? ["apply", "--check", "--recount", "--whitespace=nowarn", patchPath]
    : ["apply", "--recount", "--whitespace=nowarn", patchPath];
  const result = await execa("git", args, {
    cwd: opts.worktreePath,
    reject: false,
  });
  if (!opts.checkOnly) {
    await fs.unlink(patchPath).catch(() => undefined);
  }
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  };
}

export async function removeWorktree(opts: {
  repoPath: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  await execa(
    "git",
    [
      "worktree",
      "remove",
      ...(opts.force ? ["--force"] : []),
      opts.worktreePath,
    ],
    { cwd: opts.repoPath, reject: false },
  );
  // prune
  await execa("git", ["worktree", "prune"], {
    cwd: opts.repoPath,
    reject: false,
  });
  // try delete branch
  const base = path.basename(opts.worktreePath);
  await execa("git", ["branch", "-D", `reprosight/${base}`], {
    cwd: opts.repoPath,
    reject: false,
  });
}

export async function verifyOriginalUnchanged(
  repoPath: string,
  expectedHash: string,
): Promise<{ ok: boolean; currentHash: string }> {
  const currentHash = await hashCheckout(repoPath);
  return { ok: currentHash === expectedHash, currentHash };
}
