import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Download, FileText, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { AuditButton } from "@/components/AuditButton";
import { LivePipelineProgress } from "@/components/LivePipelineProgress";
import { PipelineActionButton } from "@/components/PipelineActionButton";
import { StructureReviewPanel } from "@/components/StructureReviewPanel";
import { executionModeLabel } from "@/lib/pipeline/jobRules";
import type { AuditReportJson } from "@/lib/types";
import { buildPipelineStatusDisplay } from "@/lib/pipeline/display";
import { getInngestRuntimeConfig } from "@/src/inngest/events";
import { buildStructureReviewRows } from "@/lib/editorial/structureReview";

export const dynamic = "force-dynamic";

export default async function ManuscriptPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    include: {
      chapters: {
        orderBy: { order: "asc" },
        include: { _count: { select: { findings: true } } }
      },
      reports: { orderBy: { createdAt: "desc" }, take: 1 },
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      rewritePlans: { orderBy: { createdAt: "desc" }, take: 1 },
      rewrites: { orderBy: { createdAt: "desc" } },
      findings: { take: 1 },
      pipelineJobs: { orderBy: { createdAt: "asc" }, take: 60 }
    }
  });

  if (!manuscript) {
    notFound();
  }

  const report = manuscript.reports[0];
  const structured = report?.structured as AuditReportJson | undefined;
  const latestRun = manuscript.runs[0];
  const latestRewritePlan = manuscript.rewritePlans[0];
  const latestRewrite = manuscript.rewrites[0];
  const rewriteDraftCount = new Set(
    manuscript.rewrites
      .filter((rewrite) => ["DRAFT", "ACCEPTED"].includes(rewrite.status))
      .map((rewrite) => rewrite.chapterId)
  ).size;
  const rewriteDraftsComplete = rewriteDraftCount >= manuscript.chapterCount;
  const pipelineStatus = buildPipelineStatusDisplay({
    run: latestRun,
    jobs: manuscript.pipelineJobs,
    totals: {
      chunks: manuscript.chunkCount,
      chapters: manuscript.chapterCount,
      sections: manuscript.chapterCount,
      auditTargets: manuscript.chapterCount
    }
  });
  const inngestConfig = getInngestRuntimeConfig();
  const lastInngestEvent = await prisma.inngestEventLog.findFirst({
    where: { manuscriptId: manuscript.id },
    orderBy: { createdAt: "desc" }
  });
  const jobCounts = pipelineStatus.jobCounts;
  const structureRows = buildStructureReviewRows({
    chapters: manuscript.chapters,
    issueCountByChapterId: new Map(
      manuscript.chapters.map((chapter) => [chapter.id, chapter._count.findings])
    )
  });

  const recommendedAction = buildRecommendedAction({
    analysisStatus: manuscript.analysisStatus,
    coreAnalysisComplete: pipelineStatus.coreAnalysisComplete,
    manuscriptId: manuscript.id,
    rewriteDraftsComplete,
    rewritePlanReady: Boolean(latestRewritePlan)
  });

  return (
    <div className="space-y-8">
      <Link href="/" className="ghost-button px-0">
        Back to manuscripts
      </Link>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="paper-card p-7 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="page-kicker">Manuscript</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-ink">
                {manuscript.title}
              </h1>
              <p className="mt-2 text-sm text-muted">{manuscript.sourceFileName}</p>
              {[manuscript.authorName, manuscript.targetGenre, manuscript.targetAudience].some(Boolean) ? (
                <p className="mt-2 text-sm text-muted">
                  {[manuscript.authorName, manuscript.targetGenre, manuscript.targetAudience]
                    .filter(Boolean)
                    .join(" | ")}
                </p>
              ) : null}
            </div>
            <StatusBadge status={manuscript.analysisStatus} />
          </div>

          {latestRun?.error ? (
            <p className="mt-5 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
              {latestRun.error}
            </p>
          ) : null}

          <div className="mt-8 grid gap-3 sm:grid-cols-4">
            <MetricTile label="Words" value={manuscript.wordCount.toLocaleString()} />
            <MetricTile label="Book structure" value={String(manuscript.chapterCount)} />
            <MetricTile label="Progress" value={`${pipelineStatus.percent}%`} />
            <MetricTile label="Analysis" value={formatStatus(manuscript.analysisStatus)} />
          </div>
        </div>

        <RecommendedActionCard
          action={recommendedAction}
          manuscriptId={manuscript.id}
          diagnosticsRefreshManuscriptId={manuscript.id}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ActionGroup title="Manuscript work" description="Review and revise the book-facing material.">
          <Link href={`/manuscripts/${manuscript.id}/structure`} className="secondary-button justify-between">
            <span className="inline-flex items-center gap-2">
              <BookOpen size={16} aria-hidden="true" />
              Review structure
            </span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link href={`/manuscripts/${manuscript.id}/workspace`} className="secondary-button justify-between">
            <span>Open editorial workspace</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link href={`/manuscripts/${manuscript.id}/audit`} className="ghost-button justify-between">
            <span>View editorial report</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </ActionGroup>

        <ActionGroup title="Exports" description="Download the current editorial or rewrite output.">
          <a href={`/api/manuscripts/${manuscript.id}/report/markdown`} className="secondary-button justify-between">
            <span className="inline-flex items-center gap-2">
              <Download size={16} aria-hidden="true" />
              Report Markdown
            </span>
            <ArrowRight size={15} aria-hidden="true" />
          </a>
          <a href={`/api/manuscripts/${manuscript.id}/report/docx`} className="secondary-button justify-between">
            <span className="inline-flex items-center gap-2">
              <FileText size={16} aria-hidden="true" />
              Report DOCX
            </span>
            <ArrowRight size={15} aria-hidden="true" />
          </a>
          <details className="rounded-lg border border-line bg-paper-alt">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
              More export formats
            </summary>
            <div className="grid gap-2 border-t border-line p-3">
              <a href={`/api/manuscripts/${manuscript.id}/report/json`} className="ghost-button justify-start">
                Report JSON
              </a>
              <a href={`/api/manuscripts/${manuscript.id}/rewritten/markdown`} className="ghost-button justify-start">
                Full rewritten Markdown
              </a>
              <a href={`/api/manuscripts/${manuscript.id}/rewritten/json`} className="ghost-button justify-start">
                Full rewritten JSON
              </a>
            </div>
          </details>
        </ActionGroup>

        <section className="paper-card p-5">
          <details>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink hover:text-accent">
              <Wrench size={16} aria-hidden="true" />
              Advanced tools
            </summary>
            <div className="mt-4 space-y-5 border-t border-line pt-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Background processing
                </h3>
                <p className="mt-2 text-sm font-semibold">
                  {executionModeLabel({
                    inngestEnabled: inngestConfig.enabled,
                    hasCronFallback: false
                  })}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Last processing event:{" "}
                  {lastInngestEvent
                    ? `${lastInngestEvent.eventName} at ${lastInngestEvent.createdAt.toLocaleString()}`
                    : "none recorded"}
                </p>
                {inngestConfig.warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-danger">
                    {inngestConfig.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricTile label="Queued" value={String(jobCounts.queued)} compact />
                <MetricTile label="Running" value={String(jobCounts.running)} compact />
                <MetricTile label="Blocked" value={String(jobCounts.blocked)} compact />
                <MetricTile label="Failed" value={String(jobCounts.failed)} compact />
                <MetricTile label="Completed" value={String(jobCounts.completed)} compact />
              </div>
              <div className="space-y-2">
                <PipelineActionButton
                  endpoint={`/api/manuscripts/${manuscript.id}/resume-pipeline`}
                  label="Resume analysis"
                  runningLabel="Resuming..."
                  variant="secondary"
                />
                <PipelineActionButton
                  endpoint={`/api/admin/manuscripts/${manuscript.id}/run-jobs`}
                  label="Continue background work"
                  runningLabel="Continuing..."
                  variant="secondary"
                  diagnosticsRefreshManuscriptId={manuscript.id}
                  refreshPageOnComplete={false}
                />
              </div>
            </div>
          </details>
        </section>
      </section>

      <div id="analysis-progress">
        <LivePipelineProgress
          manuscriptId={manuscript.id}
          initialStatus={pipelineStatus}
        />
      </div>

      {manuscript.pipelineJobs.length > 0 ? (
        <details className="detail-toggle">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
            Troubleshooting history
          </summary>
          <div className="divide-y divide-line border-t border-line">
            {manuscript.pipelineJobs.slice(0, 12).map((job) => (
              <div
                key={job.id}
                className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_120px_120px]"
              >
                <div>
                  <div className="font-semibold">{job.type}</div>
                  {job.error ? (
                    <div className="mt-1 text-xs text-danger">{job.error}</div>
                  ) : null}
                </div>
                <div>{formatStatus(job.status)}</div>
                <div className="text-xs text-slate-500">
                  Attempts {job.attempts}/{job.maxAttempts}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[minmax(420px,0.9fr)_1fr]">
        <StructureReviewPanel
          rows={structureRows}
          title="Book structure"
          getHref={(row) => `/manuscripts/${manuscript.id}/chapters/${row.id}/workspace`}
        />

        <div className="space-y-6">
          {report && structured ? (
            <ReportPanel
              manuscriptId={manuscript.id}
              report={structured}
              createdAt={report.createdAt}
            />
          ) : (
            <div className="border border-line bg-white p-6 text-sm text-slate-600 shadow-panel">
              No editorial report yet. Start analysis to generate the summary,
              editorial notes, section guidance, and rewrite strategy.
            </div>
          )}

          {latestRewrite ? (
            <section className="border border-line bg-white shadow-panel">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Latest chapter 1 rewrite
                </h2>
              </div>
              <div className="max-h-[540px] overflow-auto whitespace-pre-wrap px-4 py-4 text-sm leading-7">
                {latestRewrite.rewrittenText || latestRewrite.content}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

type RecommendedAction =
  | {
      kind: "link";
      body: string;
      href: string;
      label: string;
      title: string;
    }
  | {
      kind: "analysis";
      body: string;
      label: string;
      title: string;
    }
  | {
      kind: "rewrite";
      body: string;
      label: string;
      title: string;
    };

function RecommendedActionCard({
  action,
  diagnosticsRefreshManuscriptId,
  manuscriptId
}: {
  action: RecommendedAction;
  diagnosticsRefreshManuscriptId: string;
  manuscriptId: string;
}) {
  return (
    <aside className="active-card p-6">
      <p className="page-kicker">Recommended next step</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-normal text-ink">
        {action.title}
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-700">{action.body}</p>
      <div className="mt-6">
        {action.kind === "link" ? (
          <Link href={action.href} className="primary-button w-full">
            {action.label}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : null}
        {action.kind === "analysis" ? (
          <AuditButton manuscriptId={manuscriptId} />
        ) : null}
        {action.kind === "rewrite" ? (
          <PipelineActionButton
            endpoint={`/api/admin/manuscripts/${manuscriptId}/generate-rewrite-drafts`}
            label={action.label}
            runningLabel="Generating..."
            variant="primary"
            fullWidth
            diagnosticsRefreshManuscriptId={diagnosticsRefreshManuscriptId}
            refreshPageOnComplete={false}
          />
        ) : null}
      </div>
    </aside>
  );
}

function buildRecommendedAction({
  analysisStatus,
  coreAnalysisComplete,
  manuscriptId,
  rewriteDraftsComplete,
  rewritePlanReady
}: {
  analysisStatus: string;
  coreAnalysisComplete: boolean;
  manuscriptId: string;
  rewriteDraftsComplete: boolean;
  rewritePlanReady: boolean;
}): RecommendedAction {
  if (rewritePlanReady && !rewriteDraftsComplete) {
    return {
      kind: "rewrite",
      title: "Generate rewrite drafts",
      body: "The revision plan is ready. Generate chapter drafts when you are ready to compare rewritten text against the original.",
      label: "Generate rewrite drafts"
    };
  }

  if (analysisStatus === "COMPLETED" || coreAnalysisComplete) {
    return {
      kind: "link",
      href: `/manuscripts/${manuscriptId}/workspace`,
      title: "Open the editorial workspace",
      body: "Start with the guided recommendation, then move through the priority cards in order.",
      label: "Open workspace"
    };
  }

  if (analysisStatus === "RUNNING") {
    return {
      kind: "link",
      href: "#analysis-progress",
      title: "Follow analysis progress",
      body: "The manuscript is being analyzed. Watch the current step and continue once the workspace is ready.",
      label: "View progress"
    };
  }

  if (analysisStatus === "FAILED") {
    return {
      kind: "analysis",
      title: "Continue analysis",
      body: "The last run needs attention. Start analysis again after reviewing the message on this page.",
      label: "Continue analysis"
    };
  }

  return {
    kind: "analysis",
    title: "Start analysis",
    body: "Begin the editorial pass after confirming that the imported book structure looks right.",
    label: "Start analysis"
  };
}

function ActionGroup({
  children,
  description,
  title
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="paper-card p-5">
      <h2 className="text-base font-semibold tracking-normal text-ink">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-4 grid gap-2">{children}</div>
    </section>
  );
}

function MetricTile({
  compact = false,
  label,
  value
}: {
  compact?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="metric-tile">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={compact ? "mt-1 text-base font-semibold" : "mt-2 text-xl font-semibold"}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "COMPLETED"
      ? "border-success/20 bg-success/5 text-success"
      : status === "RUNNING"
        ? "border-accent/25 bg-accent/10 text-accent"
        : status === "FAILED"
          ? "border-danger/20 bg-danger/5 text-danger"
          : "border-line bg-paper-alt text-muted";

  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${className}`}>
      {formatStatus(status)}
    </span>
  );
}

function ReportPanel({
  manuscriptId,
  report,
  createdAt
}: {
  manuscriptId: string;
  report: AuditReportJson;
  createdAt: Date;
}) {
  return (
    <section className="paper-card p-0">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">
            Editorial report
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Generated {createdAt.toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/manuscripts/${manuscriptId}/report/markdown`}
            className="secondary-button min-h-9 px-3"
          >
            <Download size={16} aria-hidden="true" />
            Markdown
          </a>
          <a
            href={`/api/manuscripts/${manuscriptId}/report/docx`}
            className="secondary-button min-h-9 px-3"
          >
            <FileText size={16} aria-hidden="true" />
            DOCX
          </a>
          <details className="rounded-lg border border-line bg-paper-alt">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink hover:text-accent">
              Export details
            </summary>
            <div className="border-t border-line p-2">
              <a
                href={`/api/manuscripts/${manuscriptId}/report/json`}
                className="ghost-button justify-start"
              >
                <Download size={16} aria-hidden="true" />
                JSON
              </a>
            </div>
          </details>
        </div>
      </div>

      <div className="space-y-6 px-4 py-4">
        <div>
          <h3 className="text-lg font-semibold">Executive Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {report.executiveSummary}
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold">Issues to review</h3>
          <div className="mt-3 grid gap-3">
            {report.topIssues.map((issue, index) => (
              <div key={`${issue.title}-${index}`} className="rounded-lg border border-line bg-paper-alt p-3">
                <SeverityBadge severity={issue.severity} />
                <div>
                  <div className="font-semibold">{issue.title}</div>
                  {issue.chapter ? (
                    <div className="mt-1 text-xs text-slate-500">{issue.chapter}</div>
                  ) : null}
                  <p className="mt-2 text-sm text-slate-700">{issue.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold">Section notes</h3>
          <div className="mt-3 space-y-3">
            {report.chapterNotes.map((chapter) => (
              <div key={chapter.chapter} className="rounded-lg border border-line bg-paper-alt p-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-semibold">{chapter.chapter}</h4>
                  <SeverityBadge severity={chapter.priority} />
                </div>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {chapter.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold">Recommended Rewrite Strategy</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {report.rewriteStrategy}
          </p>
        </div>
      </div>
    </section>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const className =
    severity === "critical"
      ? "bg-danger text-white"
      : severity === "high"
        ? "bg-warn text-white"
        : severity === "medium"
          ? "bg-accent text-white"
          : "bg-paper-alt text-slate-700";

  return (
    <span
      className={`inline-flex min-h-7 w-fit items-center justify-center rounded-full px-3 text-xs font-semibold ${className}`}
    >
      {formatSeverityLabel(severity)}
    </span>
  );
}

function formatSeverityLabel(severity: string) {
  switch (severity) {
    case "critical":
      return "Highest priority";
    case "high":
      return "High priority";
    case "medium":
      return "Medium priority";
    default:
      return "Lower priority";
  }
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
