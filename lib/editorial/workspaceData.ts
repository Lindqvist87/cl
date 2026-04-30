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
  nextBestEditorialAction
} from "@/lib/editorial/nextAction";

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

export function aggregateEditorialWorkspaceData(input: EditorialWorkspaceInput) {
  const decisions = input.decisions ?? [];
  const decisionByFinding = latestDecisionByFinding(decisions);
  const unresolvedFindings = input.findings.filter((finding) => {
    const decision = decisionByFinding.get(finding.id);
    return !isResolvedDecisionStatus(decision?.status);
  });
  const keyIssues = unresolvedFindings
    .slice()
    .sort((a, b) => b.severity - a.severity || chapterOrder(input.chapters, a) - chapterOrder(input.chapters, b))
    .slice(0, 8)
    .map((finding) => ({
      id: finding.id,
      chapterId: finding.chapterId ?? null,
      severity: finding.severity,
      issueType: finding.issueType,
      problem: finding.problem,
      recommendation: finding.recommendation,
      decisionStatus: decisionByFinding.get(finding.id)?.status ?? null
    }));
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

  return {
    manuscript: input.manuscript,
    globalSummary: input.globalSummary ?? null,
    keyIssues,
    rewritePlanItems: rewritePlanItems(latestPlan),
    nextAction: nextBestEditorialAction({
      chapters: input.chapters,
      findings: input.findings,
      decisions,
      rewrites: input.rewrites,
      rewritePlans: input.rewritePlans
    }),
    chapterRows
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
