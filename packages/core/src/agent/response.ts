import {
  AGENT_EXIT_CODES,
  PROTOCOL_VERSION,
  TOOL_VERSION,
  type AgentExitCode,
  type AgentStatus,
  exitCodeForStatus,
} from "./statuses.js";

export type ProvenanceSource =
  | "external-agent"
  | "user-description"
  | "user-screenshot"
  | "repository-manifest"
  | "repository-source"
  | "framework-default"
  | "package-script"
  | "browser-probe"
  | "runtime-evidence"
  | "reprosight-detector";

export type InferredField<T> = {
  value: T;
  source: ProvenanceSource;
  confidence: number;
  requiresConfirmation?: boolean;
  reason?: string;
};

export type RecommendedAgentAction = {
  type: string;
  command?: string;
  arguments?: Record<string, unknown>;
  then?: string;
  humanApprovalStillRequired?: boolean;
};

export type AgentResponse = {
  protocolVersion: typeof PROTOCOL_VERSION;
  tool: { name: string; version: string };
  status: AgentStatus;
  exitCode: AgentExitCode;
  message?: string;
  code?: string;
  sessionId?: string;
  runId?: string;
  recommendedAgentAction?: RecommendedAgentAction;
  unresolved?: Array<{
    field: string;
    reason: string;
    candidates?: Array<{
      value: unknown;
      confidence: number;
      source?: string;
      reason?: string;
    }>;
  }>;
  humanQuestion?: string;
  [key: string]: unknown;
};

export function agentOk(
  status: AgentStatus,
  body: Omit<
    AgentResponse,
    "protocolVersion" | "tool" | "status" | "exitCode"
  > = {},
): AgentResponse {
  return {
    protocolVersion: PROTOCOL_VERSION,
    tool: { name: "ReproSight", version: TOOL_VERSION },
    status,
    exitCode: exitCodeForStatus(status),
    ...body,
  };
}

export function agentError(
  status: AgentStatus,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): AgentResponse {
  return agentOk(status, {
    code,
    message,
    ...extra,
  });
}

export { AGENT_EXIT_CODES, exitCodeForStatus };
