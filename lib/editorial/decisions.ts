export const EDITORIAL_DECISION_STATUSES = [
  "ACCEPTED",
  "REJECTED",
  "DEFERRED",
  "NEEDS_REVIEW"
] as const;

export type EditorialDecisionStatus = (typeof EDITORIAL_DECISION_STATUSES)[number];

export const EDITORIAL_DECISION_SCOPES = [
  "MANUSCRIPT",
  "CHAPTER",
  "SCENE",
  "PARAGRAPH"
] as const;

export type EditorialDecisionScope = (typeof EDITORIAL_DECISION_SCOPES)[number];

export type EditorialDecisionRecord = {
  id?: string;
  manuscriptId?: string;
  chapterId?: string | null;
  findingId?: string | null;
  rewritePlanId?: string | null;
  title: string;
  rationale?: string | null;
  status: EditorialDecisionStatus;
  scope: EditorialDecisionScope;
  metadata?: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export function isEditorialDecisionStatus(
  value: unknown
): value is EditorialDecisionStatus {
  return (
    typeof value === "string" &&
    EDITORIAL_DECISION_STATUSES.includes(value as EditorialDecisionStatus)
  );
}

export function isEditorialDecisionScope(
  value: unknown
): value is EditorialDecisionScope {
  return (
    typeof value === "string" &&
    EDITORIAL_DECISION_SCOPES.includes(value as EditorialDecisionScope)
  );
}

export function assertEditorialDecisionStatus(
  value: unknown
): EditorialDecisionStatus {
  if (!isEditorialDecisionStatus(value)) {
    throw new Error(`Invalid editorial decision status: ${String(value)}`);
  }

  return value;
}

export function assertEditorialDecisionScope(
  value: unknown
): EditorialDecisionScope {
  if (!isEditorialDecisionScope(value)) {
    throw new Error(`Invalid editorial decision scope: ${String(value)}`);
  }

  return value;
}

export function transitionDecisionStatus<T extends { status: EditorialDecisionStatus }>(
  decision: T,
  status: EditorialDecisionStatus
): T {
  return {
    ...decision,
    status
  };
}

export function isResolvedDecisionStatus(status?: EditorialDecisionStatus | null) {
  return status === "ACCEPTED" || status === "REJECTED" || status === "DEFERRED";
}

export function latestDecisionByFinding(
  decisions: EditorialDecisionRecord[]
): Map<string, EditorialDecisionRecord> {
  const latest = new Map<string, EditorialDecisionRecord>();

  for (const decision of decisions) {
    if (!decision.findingId) {
      continue;
    }

    const previous = latest.get(decision.findingId);
    if (!previous || decisionTimestamp(decision) >= decisionTimestamp(previous)) {
      latest.set(decision.findingId, decision);
    }
  }

  return latest;
}

export function decisionTimestamp(decision: Pick<EditorialDecisionRecord, "createdAt" | "updatedAt">) {
  const value = decision.updatedAt ?? decision.createdAt;

  if (!value) {
    return 0;
  }

  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
