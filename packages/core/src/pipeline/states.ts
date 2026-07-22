export const PIPELINE_STATES = [
  "CREATED",
  "PREPARING",
  "REPRODUCING",
  "NOT_REPRODUCED",
  "REPRODUCED",
  "COLLECTING_EVIDENCE",
  "EVIDENCE_READY",
  "DIAGNOSING",
  "ABSTAINED",
  "PATCH_PROPOSED",
  "VALIDATING_PATCH",
  "PATCH_REJECTED",
  "WORKTREE_READY",
  "VERIFYING_TARGET",
  "TARGET_FAILED",
  "TARGET_FIXED",
  "VERIFYING_REGRESSIONS",
  "VERIFIED",
  "REGRESSION_INTRODUCED",
  "AWAITING_HUMAN_REVIEW",
] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];

export type Transition = {
  at: string;
  from: PipelineState;
  to: PipelineState;
  reason: string;
  artifactIds: string[];
};

const ALLOWED: Record<PipelineState, PipelineState[]> = {
  CREATED: ["PREPARING"],
  PREPARING: ["REPRODUCING"],
  REPRODUCING: ["NOT_REPRODUCED", "REPRODUCED"],
  NOT_REPRODUCED: [],
  REPRODUCED: ["COLLECTING_EVIDENCE"],
  COLLECTING_EVIDENCE: ["EVIDENCE_READY"],
  EVIDENCE_READY: ["DIAGNOSING"],
  DIAGNOSING: ["ABSTAINED", "PATCH_PROPOSED"],
  ABSTAINED: [],
  PATCH_PROPOSED: ["VALIDATING_PATCH"],
  VALIDATING_PATCH: ["PATCH_REJECTED", "WORKTREE_READY"],
  PATCH_REJECTED: [],
  WORKTREE_READY: ["VERIFYING_TARGET"],
  VERIFYING_TARGET: ["TARGET_FAILED", "TARGET_FIXED"],
  TARGET_FAILED: [],
  TARGET_FIXED: ["VERIFYING_REGRESSIONS"],
  VERIFYING_REGRESSIONS: ["VERIFIED", "REGRESSION_INTRODUCED"],
  VERIFIED: ["AWAITING_HUMAN_REVIEW"],
  REGRESSION_INTRODUCED: [],
  AWAITING_HUMAN_REVIEW: [],
};

export function canTransition(from: PipelineState, to: PipelineState): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: PipelineState, to: PipelineState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal pipeline transition: ${from} → ${to}`);
  }
}

export function isTerminal(state: PipelineState): boolean {
  return ALLOWED[state].length === 0;
}

export function createTransition(
  from: PipelineState,
  to: PipelineState,
  reason: string,
  artifactIds: string[] = [],
): Transition {
  assertTransition(from, to);
  return {
    at: new Date().toISOString(),
    from,
    to,
    reason,
    artifactIds,
  };
}
