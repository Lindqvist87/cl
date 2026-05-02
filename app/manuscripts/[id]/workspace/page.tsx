import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ClipboardList, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { aggregateEditorialWorkspaceData } from "@/lib/editorial/workspaceData";
import { getWorkspaceReadinessForManuscript } from "@/lib/pipeline/workspaceReadiness";
import { StructureReviewPanel } from "@/components/StructureReviewPanel";

export const dynamic = "force-dynamic";

export default async function ManuscriptWorkspacePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { order: "asc" } },
      findings: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] },
      decisions: { orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] },
      reports: { orderBy: { createdAt: "desc" }, take: 1 },
      rewritePlans: { orderBy: { createdAt: "desc" }, take: 1 },
      rewrites: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!manuscript) {
    notFound();
  }

  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: manuscript.id,
      title: manuscript.title,
      status: manuscript.status,
      analysisStatus: manuscript.analysisStatus,
      wordCount: manuscript.wordCount,
      chapterCount: manuscript.chapterCount
    },
    chapters: manuscript.chapters,
    findings: manuscript.findings,
    decisions: manuscript.decisions,
    rewrites: manuscript.rewrites,
    rewritePlans: manuscript.rewritePlans,
    globalSummary: manuscript.reports[0]?.executiveSummary ?? null
  });
  const pipelineReadiness = await getWorkspaceReadinessForManuscript(id);
  const nextAction = workspace.nextAction;
  const rewriteDraftCount = new Set(
    manuscript.rewrites
      .filter((rewrite) => ["DRAFT", "ACCEPTED"].includes(rewrite.status))
      .map((rewrite) => rewrite.chapterId)
  ).size;
  const rewriteDraftsComplete = rewriteDraftCount >= manuscript.chapterCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border border-line bg-white p-4 shadow-panel lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href={`/manuscripts/${id}`} className="text-sm text-accent hover:underline">
            Back to manuscript
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {workspace.manuscript.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatStatus(workspace.manuscript.status)} |{" "}
            {formatStatus(workspace.manuscript.analysisStatus ?? "NOT_STARTED")} |{" "}
            {(workspace.manuscript.wordCount ?? 0).toLocaleString()} words
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="Detected sections" value={String(workspace.structureRows.length)} />
          <Stat
            label="Open issues"
            value={String(
              workspace.issueGroups.reduce((total, group) => total + group.count, 0)
            )}
          />
          <Stat label="Plan items" value={String(workspace.rewritePlanItems.length)} />
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="border border-line bg-white p-4 shadow-panel">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Global Summary
            </h2>
            {workspace.globalSummary ? (
              <p className="mt-3 text-sm leading-6 text-slate-700">
                {workspace.globalSummary}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                No global summary is available yet. Run or resume the full manuscript
                analysis through the whole-book audit step to create it.
              </p>
            )}
          </section>

          <section className="border border-line bg-white shadow-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <TriangleAlert size={18} aria-hidden="true" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Key Editorial Issues
              </h2>
            </div>
            <div>
              {workspace.issueGroups.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">
                  No unresolved findings are available yet.
                </p>
              ) : (
                <div className="space-y-5 px-4 py-4">
                  <div>
                    <h3 className="text-sm font-semibold">Top Editorial Priorities</h3>
                    <div className="mt-3 space-y-3">
                      {workspace.editorialPriorities.slice(0, 8).map((priority) => (
                        <PrioritySummary key={priority.priorityId} priority={priority} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Raw finding detail</h3>
                    <div className="mt-3 divide-y divide-line border-y border-line">
                      {workspace.keyIssues.map((issue) => (
                        <IssueSummary key={issue.id} issue={issue} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Raw findings grouped by issue type</h3>
                    <div className="mt-3 space-y-3">
                      {workspace.issueGroups.map((group) => (
                        <section key={group.issueType} className="border border-line bg-paper p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold">{group.issueType}</div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span>{group.count} issue{group.count === 1 ? "" : "s"}</span>
                              <SeverityBadge severity={group.maxSeverity} />
                            </div>
                          </div>
                          <div className="mt-2 divide-y divide-line">
                            {group.topIssues.slice(0, 3).map((issue) => (
                              <IssueSummary key={issue.id} issue={issue} compact />
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="border border-line bg-white shadow-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <ClipboardList size={18} aria-hidden="true" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Prioritized Rewrite Plan
              </h2>
            </div>
            <div className="divide-y divide-line">
              {workspace.rewritePlanItems.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">
                  Rewrite plan not generated yet. The createRewritePlan pipeline
                  step creates this after the manuscript audit and comparison steps.
                </p>
              ) : (
                <>
                  {!rewriteDraftsComplete ? (
                    <p className="px-4 py-3 text-sm font-semibold text-accent">
                      Rewrite plan ready. Chapter rewrite drafts can be generated when needed.
                    </p>
                  ) : null}
                  {workspace.rewritePlanItems.map((item) => (
                    <div key={item.key} className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{item.title}</span>
                        {item.priority ? (
                          <span className="border border-line bg-paper px-2 py-1 text-xs">
                            Priority {item.priority}
                          </span>
                        ) : null}
                      </div>
                      {item.plan ? (
                        <p className="mt-2 text-sm leading-6 text-slate-700">{item.plan}</p>
                      ) : null}
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <ReadinessPanel
            readiness={workspace.readiness}
            pipeline={pipelineReadiness}
            rewriteDraftsComplete={rewriteDraftsComplete}
          />

          <section className="border border-line bg-white p-4 shadow-panel">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Next Best Editorial Action
            </h2>
            {nextAction && workspace.nextActionDisplay ? (
              <div className="mt-4 space-y-3">
                <PriorityBadge priority={nextAction.priority} />
                <div>
                  <h3 className="text-lg font-semibold">{nextAction.actionTitle}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {workspace.nextActionDisplay.selectedSection}
                  </p>
                </div>
                <NextActionFact label="Why this is first" value={workspace.nextActionDisplay.reason} />
                <NextActionFact
                  label="Raw severity"
                  value={`S${workspace.nextActionDisplay.severity}`}
                />
                <NextActionFact
                  label="Issue count"
                  value={String(workspace.nextActionDisplay.issueCount)}
                />
                <NextActionFact
                  label="First concrete step"
                  value={workspace.nextActionDisplay.suggestedFirstStep}
                />
                {workspace.nextActionDisplay.whatToIgnoreForNow ? (
                  <NextActionFact
                    label="What to ignore for now"
                    value={workspace.nextActionDisplay.whatToIgnoreForNow}
                  />
                ) : null}
                {workspace.nextActionDisplay.affectedSections.length > 0 ? (
                  <NextActionFact
                    label="Affected sections"
                    value={workspace.nextActionDisplay.affectedSections.join(", ")}
                  />
                ) : null}
                <Link
                  href={`/manuscripts/${id}/chapters/${nextAction.targetChapter.id}/workspace`}
                  className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-paper px-3 py-2 text-sm font-semibold"
                >
                  Open section workspace
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                No next action is available yet. Run or resume analysis to populate findings.
              </p>
            )}
          </section>

          <StructureReviewPanel
            rows={workspace.structureRows}
            getHref={(row) => `/manuscripts/${id}/chapters/${row.id}/workspace`}
          />
        </aside>
      </section>
    </div>
  );
}

function ReadinessPanel({
  readiness,
  pipeline,
  rewriteDraftsComplete
}: {
  readiness: {
    sectionsDetected: number;
    issuesFound: number;
    globalSummaryAvailable: boolean;
    rewritePlanAvailable: boolean;
    decisionsStored: boolean;
    analysisStatus: string;
  };
  pipeline: {
    state: string;
    workspaceReady: boolean;
    usableWholeBookOutput: boolean;
    actionableError: string | null;
    coreAnalysisComplete: boolean;
    optionalRewriteDraftsPending: boolean;
  };
  rewriteDraftsComplete: boolean;
}) {
  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        Workspace Readiness
      </h2>
      <div className="mt-3 divide-y divide-line border-y border-line text-sm">
        <ReadinessRow label="Sections detected" value={String(readiness.sectionsDetected)} />
        <ReadinessRow label="Issues found" value={String(readiness.issuesFound)} />
        <ReadinessRow
          label="Global summary"
          value={readiness.globalSummaryAvailable ? "Yes" : "No"}
        />
        <ReadinessRow
          label="Rewrite plan"
          value={readiness.rewritePlanAvailable ? "Yes" : "No"}
        />
        <ReadinessRow
          label="Decisions stored"
          value={readiness.decisionsStored ? "Yes" : "No"}
        />
        <ReadinessRow label="Analysis status" value={formatStatus(readiness.analysisStatus)} />
        <ReadinessRow label="Pipeline state" value={formatStatus(pipeline.state)} />
        <ReadinessRow
          label="Whole-book output"
          value={pipeline.usableWholeBookOutput ? "Usable" : "Unavailable"}
        />
        <ReadinessRow
          label="Workspace output"
          value={pipeline.workspaceReady ? "Ready" : "Not ready"}
        />
        <ReadinessRow
          label="Rewrite drafts"
          value={rewriteDraftsComplete ? "Generated" : "Deferred"}
        />
      </div>
      {!rewriteDraftsComplete && readiness.rewritePlanAvailable ? (
        <p className="mt-3 text-sm font-semibold text-accent">
          Rewrite plan ready. Chapter rewrite drafts can be generated when needed.
        </p>
      ) : null}
      {pipeline.actionableError ? (
        <p className="mt-3 text-sm text-danger">{pipeline.actionableError}</p>
      ) : null}
      {!readiness.decisionsStored ? (
        <p className="mt-3 text-sm text-slate-500">No editorial decisions yet.</p>
      ) : null}
    </section>
  );
}

function ReadinessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function IssueSummary({
  issue,
  compact = false
}: {
  issue: {
    chapterLabel: string;
    severity: number;
    issueType: string;
    problem: string;
    recommendation: string;
    decisionStatus: string | null;
  };
  compact?: boolean;
}) {
  return (
    <div className={compact ? "py-3" : "py-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <span className="text-sm font-semibold">{issue.issueType}</span>
        <span className="text-xs text-slate-500">{issue.chapterLabel}</span>
        {issue.decisionStatus ? (
          <span className="text-xs text-slate-500">
            {formatStatus(issue.decisionStatus)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-slate-700">{issue.problem}</p>
      {!compact ? (
        <p className="mt-1 text-sm text-slate-600">{issue.recommendation}</p>
      ) : null}
    </div>
  );
}

function PrioritySummary({
  priority
}: {
  priority: {
    title: string;
    displayPriority: string;
    rawSeverityRange: string;
    issueCount: number;
    affectedSectionLabels: string[];
    evidenceSummary: string;
    editorialImpact: string;
    recommendedAction: string;
    shouldActNow: boolean;
  };
}) {
  const affected =
    priority.affectedSectionLabels.length > 0
      ? priority.affectedSectionLabels.slice(0, 4).join(", ")
      : "Manuscript level";
  const remaining = Math.max(0, priority.affectedSectionLabels.length - 4);

  return (
    <section className="border border-line bg-paper p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={priority.displayPriority} />
            <span className="text-xs text-slate-500">{priority.rawSeverityRange} raw</span>
            {priority.shouldActNow ? (
              <span className="text-xs font-semibold text-accent">Act now</span>
            ) : null}
          </div>
          <h4 className="mt-2 text-sm font-semibold">{priority.title}</h4>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{priority.issueCount} issue{priority.issueCount === 1 ? "" : "s"}</div>
          <div>
            {priority.affectedSectionLabels.length || "Manuscript"} section
            {priority.affectedSectionLabels.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{priority.editorialImpact}</p>
      <p className="mt-2 text-sm leading-6 text-slate-700">{priority.recommendedAction}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        Affects {affected}{remaining > 0 ? ` and ${remaining} more` : ""}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{priority.evidenceSummary}</p>
    </section>
  );
}

function NextActionFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-paper px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: number }) {
  const className =
    severity >= 5
      ? "bg-danger text-white"
      : severity >= 4
        ? "bg-warn text-white"
        : severity >= 3
          ? "bg-accent text-white"
          : "bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex min-h-7 items-center px-2 text-xs font-semibold ${className}`}>
      S{severity}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className="inline-flex min-h-7 items-center border border-line bg-paper px-2 text-xs font-semibold uppercase tracking-wide">
      {priority}
    </span>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
