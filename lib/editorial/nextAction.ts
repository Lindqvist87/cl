import {
  type EditorialDecisionRecord,
  isResolvedDecisionStatus,
  latestDecisionByFinding
} from "@/lib/editorial/decisions";
import type { EditorialPriority } from "@/lib/editorial/findingAggregation";
import {
  normalizeEvidenceAnchors,
  type EditorialEvidenceAnchor,
  type EvidenceSourceChunk
} from "@/lib/editorial/evidence";

export type EditorialChapterInput = {
  id: string;
  order: number;
  title: string;
  heading?: string | null;
  status?: string | null;
  summary?: string | null;
  wordCount?: number;
};

export type EditorialFindingInput = {
  id: string;
  manuscriptId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  paragraphId?: string | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  chunkId?: string | null;
  issueType: string;
  severity: number;
  confidence?: number | null;
  problem: string;
  problemTitle?: string | null;
  problemType?: string | null;
  whyItMatters?: string | null;
  doThisNow?: string | null;
  evidence?: string | null;
  sourceTextExcerpt?: string | null;
  evidenceReason?: string | null;
  evidenceAnchors?: unknown;
  recommendation: string;
  rewriteInstruction?: string | null;
  scope?: "local" | "chapter" | "global" | null;
  chunk?: EvidenceSourceChunk | null;
  createdAt?: Date | string;
};

export type EditorialRewriteInput = {
  id: string;
  chapterId: string;
  status: string;
  createdAt?: Date | string;
};

export type EditorialRewritePlanInput = {
  id: string;
  chapterPlans: unknown;
  createdAt?: Date | string;
};

export type NextEditorialActionInput = {
  chapters: EditorialChapterInput[];
  findings: EditorialFindingInput[];
  decisions?: EditorialDecisionRecord[];
  rewrites?: EditorialRewriteInput[];
  rewritePlans?: EditorialRewritePlanInput[];
  aggregatedPriorities?: EditorialPriority[];
};

export type NextEditorialAction = {
  targetChapter: {
    id: string;
    order: number;
    title: string;
  };
  actionTitle: string;
  reason: string;
  severity: number;
  issueCount: number;
  suggestedFirstStep: string;
  whyThisBeforeEverythingElse: string;
  smallestUsefulFirstAction: string;
  whatToIgnoreForNow?: string;
  priority: "critical" | "high" | "medium" | "low";
  score: number;
  relatedIssueIds: string[];
  affectedChapters: string[];
  supportingEvidence: EditorialEvidenceAnchor[];
  sourcePriorityId?: string;
};

type Candidate = NextEditorialAction & {
  decisionBoost: number;
};

export function nextBestEditorialAction(
  input: NextEditorialActionInput
): NextEditorialAction | null {
  if (input.chapters.length === 0) {
    return null;
  }

  const priorityAction = nextActionFromAggregatedPriorities(
    input.chapters,
    input.aggregatedPriorities ?? []
  );

  if (priorityAction) {
    return priorityAction;
  }

  const decisions = input.decisions ?? [];
  const decisionByFinding = latestDecisionByFinding(decisions);
  const latestPlan = latestRewritePlan(input.rewritePlans ?? []);
  const latestRewriteByChapter = latestRewriteStatusByChapter(input.rewrites ?? []);
  const candidates = input.chapters
    .map((chapter, index): Candidate | null => {
      const localFindings = input.findings.filter((finding) => finding.chapterId === chapter.id);
      const unresolvedFindings = localFindings.filter((finding) => {
        const decision = decisionByFinding.get(finding.id);
        return !isResolvedDecisionStatus(decision?.status);
      });
      const planInfo = latestPlan
        ? chapterPlanInfo(latestPlan, chapter)
        : emptyPlanInfo();
      const latestRewriteStatus = latestRewriteByChapter.get(chapter.id);
      const hasAcceptedRewrite =
        latestRewriteStatus === "ACCEPTED" || chapter.status === "REWRITE_ACCEPTED";
      const hasDraftRewrite = latestRewriteStatus === "DRAFT";
      const topFinding = unresolvedFindings
        .slice()
        .sort((a, b) => b.severity - a.severity || timestamp(a.createdAt) - timestamp(b.createdAt))[0];
      const maxSeverity = unresolvedFindings.reduce(
        (max, finding) => Math.max(max, finding.severity),
        0
      );
      const chapterDecision = latestChapterDecision(decisions, chapter.id, latestPlan?.id);
      const chapterPlanResolved = isResolvedDecisionStatus(chapterDecision?.status);

      if (unresolvedFindings.length === 0 && (!planInfo.hasPlan || chapterPlanResolved)) {
        return null;
      }

      const severityScore = unresolvedFindings.reduce(
        (total, finding) => total + Math.max(1, finding.severity) * 12,
        0
      );
      const issueCountScore = unresolvedFindings.length * 5;
      const rewriteStatusScore = hasAcceptedRewrite ? 0 : hasDraftRewrite ? 8 : 4;
      const positionScore = Math.max(0, input.chapters.length - index) * 0.25;
      const decisionBoost = unresolvedFindings.some(
        (finding) => decisionByFinding.get(finding.id)?.status === "NEEDS_REVIEW"
      )
        ? 10
        : 0;
      const score =
        severityScore +
        issueCountScore +
        planInfo.priorityScore +
        rewriteStatusScore +
        positionScore +
        decisionBoost;

      if (score <= 0) {
        return null;
      }

      const relatedIssueIds = unresolvedFindings.map((finding) => finding.id);
      const actionTitle = topFinding
        ? `Resolve ${topFinding.issueType.toLowerCase()}: ${truncate(topFinding.problem, 80)}`
        : `Review rewrite plan for ${chapter.title}`;
      const reason = buildReason({
        unresolvedCount: unresolvedFindings.length,
        maxSeverity: topFinding?.severity,
        planPriority: planInfo.priorityLabel,
        latestRewriteStatus,
        chapterDecisionStatus: chapterDecision?.status,
        decisionBoost
      });
      const supportingEvidence = topFinding
        ? normalizeEvidenceAnchors({ finding: topFinding }).slice(0, 5)
        : [];
      const firstStep = suggestedFirstStep(topFinding, planInfo.suggestedFirstStep);

      return {
        targetChapter: {
          id: chapter.id,
          order: chapter.order,
          title: chapter.title
        },
        actionTitle,
        reason,
        severity: maxSeverity,
        issueCount: unresolvedFindings.length,
        suggestedFirstStep: firstStep,
        whyThisBeforeEverythingElse: fallbackWhyThisFirst({
          unresolvedCount: unresolvedFindings.length,
          maxSeverity,
          planPriority: planInfo.priorityLabel
        }),
        smallestUsefulFirstAction: firstStep,
        whatToIgnoreForNow: undefined,
        priority: priorityForScore(score),
        score,
        relatedIssueIds,
        affectedChapters: planInfo.affectedChapters,
        supportingEvidence,
        decisionBoost
      } satisfies Candidate;
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.decisionBoost - a.decisionBoost ||
        a.targetChapter.order - b.targetChapter.order
    );

  const best = candidates[0];

  if (!best) {
    return null;
  }

  return {
    targetChapter: best.targetChapter,
    actionTitle: best.actionTitle,
    reason: best.reason,
    severity: best.severity,
    issueCount: best.issueCount,
    suggestedFirstStep: best.suggestedFirstStep,
    whyThisBeforeEverythingElse: best.whyThisBeforeEverythingElse,
    smallestUsefulFirstAction: best.smallestUsefulFirstAction,
    whatToIgnoreForNow: best.whatToIgnoreForNow,
    priority: best.priority,
    score: Math.round(best.score * 10) / 10,
    relatedIssueIds: best.relatedIssueIds,
    affectedChapters: best.affectedChapters,
    supportingEvidence: best.supportingEvidence,
    sourcePriorityId: best.sourcePriorityId
  };
}

function nextActionFromAggregatedPriorities(
  chapters: EditorialChapterInput[],
  priorities: EditorialPriority[]
): NextEditorialAction | null {
  const firstActionablePriority = priorities.find((priority) => priority.shouldActNow) ??
    priorities[0];

  if (!firstActionablePriority) {
    return null;
  }

  const targetChapter =
    firstActionablePriority.affectedSectionIds
      .map((sectionId) => chapters.find((chapter) => chapter.id === sectionId))
      .find((chapter): chapter is EditorialChapterInput => Boolean(chapter)) ??
    chapters[0];

  if (!targetChapter) {
    return null;
  }

  const reasonParts = [
    `${firstActionablePriority.issueCount} related finding${firstActionablePriority.issueCount === 1 ? "" : "s"}`,
    `${firstActionablePriority.affectedSectionIds.length || "manuscript-level"} affected section${firstActionablePriority.affectedSectionIds.length === 1 ? "" : "s"}`,
    `display priority ${firstActionablePriority.displayPriority}`,
    `raw severity ${firstActionablePriority.rawSeverityRange}`
  ];

  if (firstActionablePriority.hasFragmentContext) {
    reasonParts.push("short/title-like section issues are contextualized");
  }

  return {
    targetChapter: {
      id: targetChapter.id,
      order: targetChapter.order,
      title: targetChapter.title
    },
    actionTitle: firstActionablePriority.recommendedAction,
    reason: reasonParts.join("; "),
    severity: firstActionablePriority.rawSeverityMax,
    issueCount: firstActionablePriority.issueCount,
    suggestedFirstStep: firstActionablePriority.firstConcreteStep,
    whyThisBeforeEverythingElse: priorityWhyThisFirst(firstActionablePriority),
    smallestUsefulFirstAction: firstActionablePriority.firstConcreteStep,
    whatToIgnoreForNow: firstActionablePriority.whatToIgnoreForNow,
    priority: firstActionablePriority.displayPriority,
    score: firstActionablePriority.displayScore,
    relatedIssueIds: firstActionablePriority.rawFindingIds,
    affectedChapters: firstActionablePriority.affectedSectionLabels,
    supportingEvidence: firstActionablePriority.evidenceAnchors,
    sourcePriorityId: firstActionablePriority.priorityId
  };
}

function priorityWhyThisFirst(priority: EditorialPriority) {
  if (priority.structuralPattern === "unclear-dramatic-contract") {
    return "This comes first because the reader promise governs which later scene fixes are worth making.";
  }

  if (priority.affectedSectionIds.length >= 3) {
    return "This comes first because the same pattern affects multiple sections, so one editorial rule can unlock several later fixes.";
  }

  return "This comes first because it has the strongest combined editorial impact among the open findings.";
}

function fallbackWhyThisFirst({
  unresolvedCount,
  maxSeverity,
  planPriority
}: {
  unresolvedCount: number;
  maxSeverity: number;
  planPriority?: string;
}) {
  if (maxSeverity >= 4) {
    return "This comes first because it carries the highest open severity and can distort later revision choices.";
  }

  if (planPriority) {
    return "This comes first because it is already marked as important in the rewrite plan.";
  }

  return `This comes first because ${unresolvedCount} open finding${unresolvedCount === 1 ? "" : "s"} point to the same section.`;
}

function buildReason({
  unresolvedCount,
  maxSeverity,
  planPriority,
  latestRewriteStatus,
  chapterDecisionStatus,
  decisionBoost
}: {
  unresolvedCount: number;
  maxSeverity?: number;
  planPriority?: string;
  latestRewriteStatus?: string;
  chapterDecisionStatus?: string;
  decisionBoost: number;
}) {
  const parts = [
    `${unresolvedCount} unresolved issue${unresolvedCount === 1 ? "" : "s"}`
  ];

  if (maxSeverity) {
    parts.push(`highest severity ${maxSeverity}`);
  }

  if (planPriority) {
    parts.push(`rewrite plan priority ${planPriority}`);
  }

  if (latestRewriteStatus && latestRewriteStatus !== "ACCEPTED") {
    parts.push(`latest rewrite status ${latestRewriteStatus.toLowerCase()}`);
  }

  if (chapterDecisionStatus) {
    parts.push(`chapter decision ${chapterDecisionStatus.toLowerCase()}`);
  }

  if (decisionBoost > 0) {
    parts.push("marked needs review");
  }

  return parts.join("; ");
}

function priorityForScore(score: number): NextEditorialAction["priority"] {
  if (score >= 90) {
    return "critical";
  }
  if (score >= 55) {
    return "high";
  }
  if (score >= 25) {
    return "medium";
  }
  return "low";
}

function latestRewritePlan(plans: EditorialRewritePlanInput[]) {
  return plans
    .slice()
    .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))[0];
}

function latestRewriteStatusByChapter(rewrites: EditorialRewriteInput[]) {
  const latest = new Map<string, EditorialRewriteInput>();

  for (const rewrite of rewrites) {
    const previous = latest.get(rewrite.chapterId);
    if (!previous || timestamp(rewrite.createdAt) >= timestamp(previous.createdAt)) {
      latest.set(rewrite.chapterId, rewrite);
    }
  }

  return new Map(
    Array.from(latest.entries()).map(([chapterId, rewrite]) => [chapterId, rewrite.status])
  );
}

function latestChapterDecision(
  decisions: EditorialDecisionRecord[],
  chapterId: string,
  rewritePlanId?: string
) {
  return decisions
    .filter(
      (decision) =>
        decision.chapterId === chapterId &&
        !decision.findingId &&
        (!rewritePlanId || !decision.rewritePlanId || decision.rewritePlanId === rewritePlanId)
    )
    .sort((a, b) => timestamp(b.updatedAt ?? b.createdAt) - timestamp(a.updatedAt ?? a.createdAt))[0];
}

function chapterPlanInfo(plan: EditorialRewritePlanInput, chapter: EditorialChapterInput) {
  const plans = Array.isArray(plan.chapterPlans) ? plan.chapterPlans : [];
  const match = plans.find((candidate) => matchesChapterPlan(candidate, chapter));

  if (!isRecord(match)) {
    return emptyPlanInfo();
  }

  return {
    hasPlan: true,
    priorityScore: priorityScore(match.priority),
    priorityLabel: priorityLabel(match.priority),
    affectedChapters: extractAffectedChapters(match),
    suggestedFirstStep: firstString(
      match.firstStep,
      match.suggestedFirstStep,
      match.action,
      match.plan,
      match.recommendation
    )
  };
}

function emptyPlanInfo() {
  return {
    hasPlan: false,
    priorityScore: 0,
    priorityLabel: undefined as string | undefined,
    affectedChapters: [] as string[],
    suggestedFirstStep: undefined as string | undefined
  };
}

function suggestedFirstStep(
  finding: EditorialFindingInput | undefined,
  planStep: string | undefined
) {
  if (finding?.rewriteInstruction) {
    return finding.rewriteInstruction;
  }

  if (finding?.recommendation) {
    return finding.recommendation;
  }

  if (planStep) {
    return planStep;
  }

  return "Open the section workspace and review the available findings before drafting changes.";
}

function matchesChapterPlan(candidate: unknown, chapter: EditorialChapterInput) {
  if (!isRecord(candidate)) {
    return false;
  }

  return (
    candidate.chapterId === chapter.id ||
    candidate.id === chapter.id ||
    candidate.chapterIndex === chapter.order ||
    candidate.order === chapter.order ||
    normalize(candidate.title) === normalize(chapter.title)
  );
}

function priorityScore(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, 6 - Math.min(5, Math.max(1, value))) * 8;
  }

  const normalized = normalize(value);
  if (normalized === "critical") {
    return 40;
  }
  if (normalized === "high") {
    return 30;
  }
  if (normalized === "medium") {
    return 18;
  }
  if (normalized === "low") {
    return 8;
  }

  return 0;
}

function priorityLabel(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return String(value);
}

function extractAffectedChapters(plan: Record<string, unknown>) {
  const values = [
    plan.affectedChapters,
    plan.continuityDependencies,
    plan.echoImpact,
    plan.dependentChapters
  ];

  return values.flatMap((value) => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item) => String(item)).filter(Boolean);
  });
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value?: Date | string) {
  if (!value) {
    return 0;
  }

  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
