import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ClipboardList, FileText, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { aggregateEditorialWorkspaceData } from "@/lib/editorial/workspaceData";

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
  const nextAction = workspace.nextAction;

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
          <Stat label="Chapters" value={String(workspace.chapterRows.length)} />
          <Stat label="Open issues" value={String(workspace.keyIssues.length)} />
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
                No global summary is available yet.
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
            <div className="divide-y divide-line">
              {workspace.keyIssues.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">
                  No unresolved findings are available yet.
                </p>
              ) : (
                workspace.keyIssues.map((issue) => (
                  <div key={issue.id} className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={issue.severity} />
                      <span className="text-sm font-semibold">{issue.issueType}</span>
                      {issue.decisionStatus ? (
                        <span className="text-xs text-slate-500">
                          {formatStatus(issue.decisionStatus)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{issue.problem}</p>
                    <p className="mt-1 text-sm text-slate-600">{issue.recommendation}</p>
                  </div>
                ))
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
                  No rewrite plan is available yet.
                </p>
              ) : (
                workspace.rewritePlanItems.map((item) => (
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
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="border border-line bg-white p-4 shadow-panel">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Next Best Editorial Action
            </h2>
            {nextAction ? (
              <div className="mt-4 space-y-3">
                <PriorityBadge priority={nextAction.priority} />
                <div>
                  <h3 className="text-lg font-semibold">{nextAction.actionTitle}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Chapter {nextAction.targetChapter.order}: {nextAction.targetChapter.title}
                  </p>
                </div>
                <p className="text-sm leading-6 text-slate-700">{nextAction.reason}</p>
                {nextAction.affectedChapters.length > 0 ? (
                  <p className="text-xs text-slate-500">
                    Affects {nextAction.affectedChapters.join(", ")}
                  </p>
                ) : null}
                <Link
                  href={`/manuscripts/${id}/chapters/${nextAction.targetChapter.id}/workspace`}
                  className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-paper px-3 py-2 text-sm font-semibold"
                >
                  Open chapter workspace
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                No next action is available yet. Run or resume analysis to populate findings.
              </p>
            )}
          </section>

          <section className="border border-line bg-white shadow-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <FileText size={18} aria-hidden="true" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Chapters
              </h2>
            </div>
            <div className="divide-y divide-line">
              {workspace.chapterRows.map((chapter) => (
                <Link
                  key={chapter.id}
                  href={`/manuscripts/${id}/chapters/${chapter.id}/workspace`}
                  className="block px-4 py-3 hover:bg-paper"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {chapter.order}. {chapter.title}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatStatus(chapter.status)} | {chapter.wordCount.toLocaleString()} words
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-semibold">{chapter.issueCount} issues</div>
                      {chapter.maxSeverity > 0 ? (
                        <div className="mt-1 text-slate-500">S{chapter.maxSeverity}</div>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </section>
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
