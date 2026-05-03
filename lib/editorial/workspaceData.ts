import {
  type EditorialDecisionRecord,
  isResolvedDecisionStatus,
  latestDecisionByFinding
} from "@/lib/editorial/decisions";
import {
  type EditorialChapterInput,
  type EditorialFindingInput,
  type EditorialRewriteInput,
  type EditorialRewritePlanInput,
  type NextEditorialAction,
  nextBestEditorialAction
} from "@/lib/editorial/nextAction";
import { aggregateEditorialFindingPriorities } from "@/lib/editorial/findingAggregation";
import { buildStructureReviewRows } from "@/lib/editorial/structureReview";
import type { EditorialEvidenceAnchor } from "@/lib/editorial/evidence";

export type EditorialWorkspaceInput = {
  manuscript: {
    id: string;
    title: string;
    status: string;
    analysisStatus?: string;
    wordCount?: number;
    chapterCount?: number;
  };
  chapters: EditorialChapterInput[];
  findings: EditorialFindingInput[];
  decisions?: EditorialDecisionRecord[];
  rewrites?: EditorialRewriteInput[];
  rewritePlans?: EditorialRewritePlanInput[];
  globalSummary?: string | null;
};

export type WorkspaceReadiness = {
  sectionsDetected: number;
  issuesFound: number;
  globalSummaryAvailable: boolean;
  rewritePlanAvailable: boolean;
  decisionsStored: boolean;
  analysisStatus: string;
};

export type EditorialIssueDisplay = {
  id: string;
  chapterId: string | null;
  chapterLabel: string;
  severity: number;
  issueType: string;
  problem: string;
  evidence: string | null;
  recommendation: string;
  decisionStatus: EditorialDecisionRecord["status"] | null;
};

export type EditorialIssueGroup = {
  issueType: string;
  count: number;
  maxSeverity: number;
  topIssues: EditorialIssueDisplay[];
};

export type NextEditorialActionDisplay = {
  selectedSection: string;
  reason: string;
  severity: number;
  issueCount: number;
  suggestedFirstStep: string;
  whyThisBeforeEverythingElse: string;
  smallestUsefulFirstAction: string;
  whatToIgnoreForNow: string | null;
  affectedSections: string[];
  supportingEvidence: EditorialEvidenceAnchor[];
  priority: NextEditorialAction["priority"];
};

export function aggregateEditorialWorkspaceData(input: EditorialWorkspaceInput) {
  const decisions = input.decisions ?? [];
  const decisionByFinding = latestDecisionByFinding(decisions);
  const unresolvedFindings = input.findings.filter((finding) => {
    const decision = decisionByFinding.get(finding.id);
    return !isResolvedDecisionStatus(decision?.status);
  });
  const topPriorityIssues = unresolvedFindings
    .slice()
    .sort((a, b) => compareFindingsByPriority(input.chapters, a, b))
    .slice(0, 5)
    .map((finding) => displayIssue(input.chapters, decisionByFinding, finding));
  const editorialPriorities = aggregateEditorialFindingPriorities({
    chapters: input.chapters,
    findings: input.findings,
    decisions
  });
  const chapterRows = input.chapters.map((chapter) => {
    const chapterFindings = unresolvedFindings.filter(
      (finding) => finding.chapterId === chapter.id
    );
    const chapterDecisions = decisions.filter((decision) => decision.chapterId === chapter.id);

    return {
      id: chapter.id,
      order: chapter.order,
      title: chapter.title,
      status: chapter.status ?? "PENDING",
      wordCount: chapter.wordCount ?? 0,
      issueCount: chapterFindings.length,
      maxSeverity: chapterFindings.reduce(
        (max, finding) => Math.max(max, finding.severity),
        0
      ),
      decisionCounts: {
        accepted: chapterDecisions.filter((decision) => decision.status === "ACCEPTED").length,
        rejected: chapterDecisions.filter((decision) => decision.status === "REJECTED").length,
        deferred: chapterDecisions.filter((decision) => decision.status === "DEFERRED").length,
        needsReview: chapterDecisions.filter((decision) => decision.status === "NEEDS_REVIEW").length
      }
    };
  });
  const latestPlan = latestRewritePlan(input.rewritePlans ?? []);
  const nextAction = nextBestEditorialAction({
    chapters: input.chapters,
    findings: input.findings,
    decisions,
    rewrites: input.rewrites,
    rewritePlans: input.rewritePlans,
    aggregatedPriorities: editorialPriorities
  });

  return {
    manuscript: input.manuscript,
    globalSummary: input.globalSummary ?? null,
    readiness: calculateWorkspaceReadiness({
      manuscript: input.manuscript,
      chapters: input.chapters,
      findings: input.findings,
      decisions,
      rewritePlans: input.rewritePlans,
      globalSummary: input.globalSummary
    }),
    keyIssues: topPriorityIssues,
    editorialPriorities,
    issueGroups: groupEditorialIssuesByType({
      chapters: input.chapters,
      findings: input.findings,
      decisions
    }),
    rewritePlanItems: rewritePlanItems(latestPlan),
    nextAction,
    nextActionDisplay: buildNextActionDisplayData(nextAction),
    chapterRows,
    structureRows: buildStructureReviewRows({
      chapters: input.chapters,
      findings: input.findings
    })
  };
}

export function calculateWorkspaceReadiness(input: EditorialWorkspaceInput): WorkspaceReadiness {
  return {
    sectionsDetected: input.chapters.length,
    issuesFound: input.findings.length,
    globalSummaryAvailable: Boolean(input.globalSummary?.trim()),
    rewritePlanAvailable: Boolean(latestRewritePlan(input.rewritePlans ?? [])),
    decisionsStored: Boolean(input.decisions?.length),
    analysisStatus: input.manuscript.analysisStatus ?? "NOT_STARTED"
  };
}

export function groupEditorialIssuesByType({
  chapters,
  findings,
  decisions = []
}: {
  chapters: EditorialChapterInput[];
  findings: EditorialFindingInput[];
  decisions?: EditorialDecisionRecord[];
}): EditorialIssueGroup[] {
  const decisionByFinding = latestDecisionByFinding(decisions);
  const unresolvedFindings = findings.filter((finding) => {
    const decision = decisionByFinding.get(finding.id);
    return !isResolvedDecisionStatus(decision?.status);
  });
  const groups = new Map<string, EditorialIssueDisplay[]>();

  for (const finding of unresolvedFindings
    .slice()
    .sort((a, b) => compareFindingsByPriority(chapters, a, b))) {
    const issueType = finding.issueType || "Editorial";
    const group = groups.get(issueType) ?? [];
    group.push(displayIssue(chapters, decisionByFinding, finding));
    groups.set(issueType, group);
  }

  return Array.from(groups.entries())
    .map(([issueType, issues]) => ({
      issueType,
      count: issues.length,
      maxSeverity: issues.reduce((max, issue) => Math.max(max, issue.severity), 0),
      topIssues: issues.slice(0, 5)
    }))
    .sort(
      (a, b) =>
        b.maxSeverity - a.maxSeverity ||
        b.count - a.count ||
        a.issueType.localeCompare(b.issueType)
    );
}

export function buildNextActionDisplayData(
  action: NextEditorialAction | null
): NextEditorialActionDisplay | null {
  if (!action) {
    return null;
  }

  return {
    selectedSection: `Section ${action.targetChapter.order}: ${action.targetChapter.title}`,
    reason: action.reason,
    severity: action.severity,
    issueCount: action.issueCount,
    suggestedFirstStep: action.suggestedFirstStep,
    whyThisBeforeEverythingElse: action.whyThisBeforeEverythingElse,
    smallestUsefulFirstAction: action.smallestUsefulFirstAction,
    whatToIgnoreForNow: action.whatToIgnoreForNow ?? null,
    affectedSections: action.affectedChapters,
    supportingEvidence: action.supportingEvidence,
    priority: action.priority
  };
}

function rewritePlanItems(plan?: EditorialRewritePlanInput) {
  if (!plan || !Array.isArray(plan.chapterPlans)) {
    return [];
  }

  return plan.chapterPlans
    .filter(isRecord)
    .slice(0, 10)
    .map((chapterPlan, index) => ({
      key: String(chapterPlan.chapterId ?? chapterPlan.title ?? index),
      chapterId: typeof chapterPlan.chapterId === "string" ? chapterPlan.chapterId : null,
      title: String(chapterPlan.title ?? `Chapter plan ${index + 1}`),
      priority:
        chapterPlan.priority === undefined || chapterPlan.priority === null
          ? null
          : String(chapterPlan.priority),
      plan: String(chapterPlan.plan ?? chapterPlan.action ?? chapterPlan.recommendation ?? "")
    }));
}

function latestRewritePlan(plans: EditorialRewritePlanInput[]) {
  return plans
    .slice()
    .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))[0];
}

function displayIssue(
  chapters: EditorialChapterInput[],
  decisionByFinding: Map<string, EditorialDecisionRecord>,
  finding: EditorialFindingInput
): EditorialIssueDisplay {
  return {
    id: finding.id,
    chapterId: finding.chapterId ?? null,
    chapterLabel: chapterLabel(chapters, finding),
    severity: finding.severity,
    issueType: finding.issueType || "Editorial",
    problem: finding.problem,
    evidence: finding.evidence ?? null,
    recommendation: finding.recommendation,
    decisionStatus: decisionByFinding.get(finding.id)?.status ?? null
  };
}

function compareFindingsByPriority(
  chapters: EditorialChapterInput[],
  a: EditorialFindingInput,
  b: EditorialFindingInput
) {
  return (
    b.severity - a.severity ||
    chapterOrder(chapters, a) - chapterOrder(chapters, b) ||
    timestamp(a.createdAt) - timestamp(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function chapterLabel(chapters: EditorialChapterInput[], finding: EditorialFindingInput) {
  if (!finding.chapterId) {
    return "Manuscript level";
  }

  const chapter = chapters.find((candidate) => candidate.id === finding.chapterId);

  if (!chapter) {
    return "Unlinked section";
  }

  return `Section ${chapter.order}: ${chapter.title}`;
}

function chapterOrder(chapters: EditorialChapterInput[], finding: EditorialFindingInput) {
  const chapter = chapters.find((candidate) => candidate.id === finding.chapterId);
  return chapter?.order ?? Number.MAX_SAFE_INTEGER;
}

function timestamp(value?: Date | string) {
  if (!value) {
    return 0;
  }

  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
