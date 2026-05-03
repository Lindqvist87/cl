import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Download,
  FileText,
  Settings2
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { AuditButton } from "@/components/AuditButton";
import { LivePipelineProgress } from "@/components/LivePipelineProgress";
import { PipelineAutoContinue } from "@/components/PipelineAutoContinue";
import { PipelineActionButton } from "@/components/PipelineActionButton";
import { StructureReviewPanel } from "@/components/StructureReviewPanel";
import { executionModeLabel } from "@/lib/pipeline/jobRules";
import type { AuditReportJson } from "@/lib/types";
import { buildPipelineStatusDisplay } from "@/lib/pipeline/display";
import { authorAnalysisAction } from "@/lib/pipeline/authorActions";
import { getChunkSummaryProgress } from "@/lib/pipeline/chunkSummaryProgress";
import { getInngestRuntimeConfig } from "@/src/inngest/events";
import { buildStructureReviewRows } from "@/lib/editorial/structureReview";

export const dynamic = "force-dynamic";

export default async function ManuscriptPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const showAdminTools = process.env.NODE_ENV !== "production";
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
  const chunkSummaryProgress = await getChunkSummaryProgress(id, latestRun?.id);
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
      chunks: chunkSummaryProgress.total,
      summarizedChunks: chunkSummaryProgress.summarized,
      chapters: manuscript.chapterCount,
      sections: manuscript.chapterCount,
      auditTargets: manuscript.chapterCount
    }
  });
  const inngestConfig = getInngestRuntimeConfig();
  const lastInngestEvent = showAdminTools
    ? await prisma.inngestEventLog.findFirst({
        where: { manuscriptId: manuscript.id },
        orderBy: { createdAt: "desc" }
      })
    : null;
  const jobCounts = pipelineStatus.jobCounts;
  const structureRows = buildStructureReviewRows({
    chapters: manuscript.chapters,
    issueCountByChapterId: new Map(
      manuscript.chapters.map((chapter) => [chapter.id, chapter._count.findings])
    )
  });
  const analysisReady =
    manuscript.analysisStatus === "COMPLETED" || pipelineStatus.complete;
  const analysisAction = authorAnalysisAction({
    manuscriptId: manuscript.id,
    analysisReady,
    analysisStatus: manuscript.analysisStatus,
    pipelineStatus
  });

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/#manus"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Mina manus
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <StatusBadge status={manuscript.analysisStatus} />
              {latestRewritePlan ? (
                <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-paper-alt px-3 text-sm font-semibold text-slate-600">
                  Redigeringsplanen är klar
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
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
            {latestRun?.error ? (
              <p className="mt-4 text-sm font-semibold text-danger">
                Analysen behöver ses över: {latestRun.error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
            {analysisAction ? (
              <AuditButton manuscriptId={manuscript.id} mode={analysisAction.mode} />
            ) : null}
            <Link
              href={`/manuscripts/${manuscript.id}/workspace`}
              className="primary-button"
            >
              Öppna arbetsyta
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link
              href={`/manuscripts/${manuscript.id}/structure`}
              className="secondary-button"
            >
              <BookOpen size={16} aria-hidden="true" />
              Manusstruktur
            </Link>
            <Link
              href={`/manuscripts/${manuscript.id}/audit`}
              className="secondary-button"
            >
              <FileText size={16} aria-hidden="true" />
              Rapport
            </Link>
          </div>
        </div>
      </section>

      {latestRewritePlan && !rewriteDraftsComplete ? (
        <section className="rounded-xl border border-accent/20 bg-white px-5 py-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
            Nästa steg
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Redigeringsplanen är klar. Öppna arbetsytan för att börja med den
            viktigaste redaktionella åtgärden.
          </p>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Ord" value={manuscript.wordCount.toLocaleString()} />
        <Stat label="Manusstruktur" value={String(manuscript.chapterCount)} />
        <Stat label="Textdelar" value={String(manuscript.chunkCount)} />
        <Stat label="Analys" value={formatStatus(manuscript.analysisStatus)} />
      </section>

      <LivePipelineProgress
        manuscriptId={manuscript.id}
        initialStatus={pipelineStatus}
        showTechnicalDetails={showAdminTools}
      />
      <PipelineAutoContinue
        manuscriptId={manuscript.id}
        analysisStatus={manuscript.analysisStatus}
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(520px,0.9fr)_1fr]">
        <StructureReviewPanel
          rows={structureRows}
          title="Manusstruktur"
          description="Granska hur manuset delades upp innan du går vidare i texten."
          sectionColumnLabel="Manusdel"
          wordColumnLabel="Ord"
          issueColumnLabel="Noteringar"
          typeColumnLabel="Typ"
          emptyLabel="Inga manusdelar finns importerade ännu."
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
              Ingen redaktionell rapport finns ännu. Starta analysen för att
              skapa helhetsbedömning, prioriteringar och redigeringsstrategi.
            </div>
          )}

          {latestRewrite ? (
            <section className="border border-line bg-white shadow-panel">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Senaste kapitelutkast
                </h2>
              </div>
              <div className="max-h-[540px] overflow-auto whitespace-pre-wrap px-4 py-4 text-sm leading-7">
                {latestRewrite.rewrittenText || latestRewrite.content}
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {showAdminTools ? (
        <details className="detail-toggle">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-semibold text-ink hover:text-accent">
            <Settings2 size={16} aria-hidden="true" />
            Adminverktyg
          </summary>
          <div className="space-y-5 border-t border-line p-5">
            <div className="flex flex-wrap gap-2">
              <PipelineActionButton
                endpoint={`/api/manuscripts/${manuscript.id}/resume-pipeline`}
                label="Resume via Inngest"
                runningLabel="Kicking..."
                variant="secondary"
              />
              <PipelineActionButton
                endpoint={`/api/admin/manuscripts/${manuscript.id}/run-jobs`}
                label="Run until pause"
                runningLabel="Running..."
                variant="secondary"
                diagnosticsRefreshManuscriptId={manuscript.id}
                refreshPageOnComplete={false}
              />
              {latestRewritePlan && !rewriteDraftsComplete ? (
                <PipelineActionButton
                  endpoint={`/api/admin/manuscripts/${manuscript.id}/generate-rewrite-drafts`}
                  label="Skapa kapitelutkast"
                  runningLabel="Skapar..."
                  variant="secondary"
                  diagnosticsRefreshManuscriptId={manuscript.id}
                  refreshPageOnComplete={false}
                />
              ) : null}
              <Link href="/corpus" className="secondary-button">
                Corpus
              </Link>
              <Link href="/trends" className="secondary-button">
                Trends
              </Link>
              <a
                href={`/api/manuscripts/${manuscript.id}/rewritten/markdown`}
                className="secondary-button"
              >
                Full rewritten Markdown
              </a>
              <a
                href={`/api/manuscripts/${manuscript.id}/rewritten/json`}
                className="secondary-button"
              >
                Full rewritten JSON
              </a>
            </div>

            <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
              <div className="border border-line bg-white p-4 shadow-panel">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Execution mode
                </h2>
                <p className="mt-2 text-sm font-semibold">
                  {executionModeLabel({
                    inngestEnabled: inngestConfig.enabled,
                    hasCronFallback: false
                  })}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Last Inngest event:{" "}
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Queued" value={String(jobCounts.queued)} />
                <Stat label="Running" value={String(jobCounts.running)} />
                <Stat label="Blocked" value={String(jobCounts.blocked)} />
                <Stat label="Failed" value={String(jobCounts.failed)} />
                <Stat label="Completed" value={String(jobCounts.completed)} />
              </div>
            </section>

            {manuscript.pipelineJobs.length > 0 ? (
              <details className="detail-toggle">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
                  Technical job details
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
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
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
    <section className="border border-line bg-white shadow-panel">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Redaktionell rapport
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Skapad {createdAt.toLocaleString()}
          </p>
        </div>
        <a
          href={`/api/manuscripts/${manuscriptId}/report/docx`}
          className="secondary-button min-h-9 px-3"
        >
          <Download size={16} aria-hidden="true" />
          Ladda ner DOCX
        </a>
      </div>

      <div className="space-y-6 px-4 py-4">
        <div>
          <h3 className="text-lg font-semibold">Helhetsbedömning</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {report.executiveSummary}
          </p>
        </div>

        <div>
          <h3 className="text-lg font-semibold">Redaktionella noteringar</h3>
          <div className="mt-3 divide-y divide-line border border-line">
            {report.topIssues.map((issue, index) => (
              <div key={`${issue.title}-${index}`} className="grid gap-2 px-3 py-3 sm:grid-cols-[120px_1fr]">
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
          <h3 className="text-lg font-semibold">Noteringar per manusdel</h3>
          <div className="mt-3 space-y-3">
            {report.chapterNotes.map((chapter) => (
              <div key={chapter.chapter} className="border border-line p-3">
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
          <h3 className="text-lg font-semibold">Redigeringsstrategi</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {report.rewriteStrategy}
          </p>
        </div>
      </div>
    </section>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const labels: Record<string, string> = {
    critical: "Kritisk",
    high: "Hög",
    medium: "Medel",
    low: "Låg"
  };
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
      className={`inline-flex min-h-7 items-center justify-center px-2 text-xs font-semibold uppercase tracking-wide ${className}`}
    >
      {labels[severity] ?? severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "COMPLETED"
      ? "border-success/20 bg-green-50 text-success"
      : status === "RUNNING"
        ? "border-accent/20 bg-accent/10 text-accent"
        : status === "FAILED"
          ? "border-danger/20 bg-red-50 text-danger"
          : "border-line bg-paper-alt text-slate-600";

  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm font-semibold ${tone}`}
    >
      {formatStatus(status)}
    </span>
  );
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    ACCEPTED: "Accepterad",
    BLOCKED: "Blockerad",
    COMPLETED: "Analysen är klar",
    DEFERRED: "Väntar",
    DRAFT: "Utkast skapat",
    FAILED: "Behöver ses över",
    NEEDS_REVIEW: "Behöver ses över",
    NOT_STARTED: "Utkast skapat",
    QUEUED: "Väntar",
    REJECTED: "Avvisad",
    RUNNING: "Analysen pågår"
  };

  return labels[status] ?? status.toLowerCase().replace(/_/g, " ");
}
