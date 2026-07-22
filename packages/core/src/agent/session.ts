import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonAtomic,
  writeAtomic,
} from "../store/fs.js";
import { defaultReproRoot } from "../store/run-store.js";
import type { AgentRequest } from "./request.js";
import type { AgentStatus } from "./statuses.js";
import type { ReproSightConfig } from "../config/schema.js";
import type { IssueSpec } from "../scenario/issue.js";

export type VerificationAttempt = {
  attemptId: string;
  at: string;
  verdict: string;
  patchPolicyAccepted?: boolean;
  changedFiles?: string[];
  notes?: string[];
  artifacts?: Record<string, string | null>;
};

export type AgentSessionRecord = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  rootDir: string;
  status: AgentStatus;
  repoPath: string;
  runId: string | null;
  worktreePath: string | null;
  originalCheckoutHash: string | null;
  attempts: VerificationAttempt[];
  requestPath: string;
  generatedConfigPath: string | null;
  generatedIssuePath: string | null;
  discoveryPath: string | null;
  preparationPath: string | null;
  lastError: string | null;
};

export class AgentSessionStore {
  constructor(private readonly reproRoot: string) {}

  get sessionsRoot(): string {
    return path.join(this.reproRoot, "agent-sessions");
  }

  sessionDir(sessionId: string): string {
    return path.join(this.sessionsRoot, sessionId);
  }

  async create(opts: {
    request: AgentRequest;
    repoPath: string;
    sessionId?: string;
  }): Promise<AgentSessionRecord> {
    const sessionId =
      opts.sessionId ??
      `session_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
    const rootDir = this.sessionDir(sessionId);
    await ensureDir(rootDir);
    const now = new Date().toISOString();
    const requestPath = path.join(rootDir, "request.original.json");
    await writeJsonAtomic(requestPath, opts.request);
    const record: AgentSessionRecord = {
      sessionId,
      createdAt: now,
      updatedAt: now,
      rootDir,
      status: "OK",
      repoPath: opts.repoPath,
      runId: null,
      worktreePath: null,
      originalCheckoutHash: null,
      attempts: [],
      requestPath: "request.original.json",
      generatedConfigPath: null,
      generatedIssuePath: null,
      discoveryPath: null,
      preparationPath: null,
      lastError: null,
    };
    await writeJsonAtomic(path.join(rootDir, "session.json"), record);
    return record;
  }

  async load(sessionId: string): Promise<AgentSessionRecord> {
    return readJsonFile<AgentSessionRecord>(
      path.join(this.sessionDir(sessionId), "session.json"),
    );
  }

  async save(record: AgentSessionRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await writeJsonAtomic(
      path.join(record.rootDir, "session.json"),
      record,
    );
  }

  async writeJson(
    sessionId: string,
    relativePath: string,
    value: unknown,
  ): Promise<string> {
    const full = path.join(this.sessionDir(sessionId), relativePath);
    await writeJsonAtomic(full, value);
    return full;
  }

  async writeText(
    sessionId: string,
    relativePath: string,
    value: string,
  ): Promise<string> {
    const full = path.join(this.sessionDir(sessionId), relativePath);
    await writeAtomic(full, value);
    return full;
  }

  async exists(sessionId: string): Promise<boolean> {
    return pathExists(path.join(this.sessionDir(sessionId), "session.json"));
  }

  resolvePath(sessionId: string, relativePath: string): string {
    return path.join(this.sessionDir(sessionId), relativePath);
  }
}

export function defaultAgentStore(cwd = process.cwd()): AgentSessionStore {
  return new AgentSessionStore(defaultReproRoot(cwd));
}

export type PreparedArtifacts = {
  config: ReproSightConfig;
  issue: IssueSpec;
  discovery: unknown;
  preparation: unknown;
};
