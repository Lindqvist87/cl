import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, Download, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { AuditButton } from "@/components/AuditButton";
import { PipelineActionButton } from "@/components/PipelineActionButton";
import { executionModeLabel, PIPELINE_JOB_STATUS } from "@/lib/pipeline/jobRules";
import type { AuditReportJson } from "@/lib/types";
import { pipelineProgress } from "@/lib/pipeline/steps";
import { getInngestRuntimeConfig } from "@/src/inngest/events";

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
      chapters: { orderBy: { order: "asc" } },
      reports: { orderBy: { createdAt: "desc" }, take: 1 },
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      rewrites: { orderBy: { createdAt: "desc" }, take: 1 },
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
  const latestRewrite = manuscript.rewrites[0];
  const progress = pipelineProgress(latestRun?.checkpoint ?? {});
  const inngestConfig = getInngestRuntimeConfig();
  const lastInngestEvent = await prisma.inngestEventLog.findFirst({
    where: { manuscriptId: manuscript.id },
    orderBy: { createdAt: "desc" }
  });
  const jobCounts = countJobsByStatus(manuscript.pipelineJobs);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border border-line bg-white p-4 shadow-panel lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href="/" className="text-sm text-accent hover:underline">
            Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {manuscript.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{manuscript.sourceFileName}</p>
          {[manuscript.authorName, manuscript.targetGenre, manuscript.targetAudience].some(Boolean) ? (
            <p className="mt-1 text-sm text-slate-500">
              {[manuscript.authorName, manuscript.targetGenre, manuscript.targetAudience]
                .filter(Boolean)
                .join(" | ")}
            </p>
          ) : null}
          {latestRun?.error ? (
            <p className="mt-3 text-sm text-danger">{latestRun.error}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href={`/manuscripts/${manuscript.id}/audit`} className="text-accent hover:underline">
              Audit
            </Link>
            <Link href={`/manuscripts/${manuscript.id}/workspace`} className="text-accent hover:underline">
              Editorial Workspace
            </Link>
            <a href={`/api/manuscripts/${manuscript.id}/rewritten/markdown`} className="text-accent hover:underline">
              Full rewritten Markdown
            </a>
            <a href={`/api/manuscripts/${manuscript.id}/rewritten/json`} className="text-accent hover:underline">
              Full rewritten JSON
            </a>
            <Link href="/corpus" className="text-accent hover:underline">
              Corpus
            </Link>
            <Link href="/trends" className="text-accent hover:underline">
              Trends
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AuditButton
            manuscriptId={manuscript.id}
            disabled={manuscript.analysisStatus === "RUNNING"}
          />
          <PipelineActionButton
            endpoint={`/api/manuscripts/${manuscript.id}/resume-pipeline`}
            label="Resume via Inngest"
            runningLabel="Kicking..."
            variant="secondary"
          />
          <PipelineActionButton
            endpoint="/api/jobs/run-until-idle"
            payload={{ manuscriptId: manuscript.id, maxJobs: 3, maxSeconds: 45 }}
            label="Run manual fallback batch"
            runningLabel="Running..."
            variant="secondary"
          />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Words" value={manuscript.wordCount.toLocaleString()} />
        <Stat label="Chapters" value={String(manuscript.chapterCount)} />
        <Stat label="Chunks" value={String(manuscript.chunkCount)} />
        <Stat label="Analysis" value={formatStatus(manuscript.analysisStatus)} />
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="border border-line bg-white p-4 shadow-panel">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Execution Mode
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Queued" value={String(jobCounts.queued)} />
          <Stat label="Running" value={String(jobCounts.running)} />
          <Stat label="Failed" value={String(jobCounts.failed)} />
          <Stat label="Completed" value={String(jobCounts.completed)} />
        </div>
      </section>

      <section className="border border-line bg-white p-4 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Pipeline Progress
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {progress.completed} of {progress.total} steps complete
            </p>
          </div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold">
            <BarChart3 size={18} aria-hidden="true" />
            {progress.percent}%
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden bg-paper">
          <div className="h-full bg-accent" style={{ width: `${progress.percent}%` }} />
        </div>
      </section>

      {manuscript.pipelineJobs.length > 0 ? (
        <section className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Pipeline Jobs
            </h2>
          </div>
          <div className="divide-y divide-line">
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
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">
            Chapters
          </div>
          <div className="max-h-[520px] overflow-auto">
            {manuscript.chapters.map((chapter) => (
              <Link
                key={chapter.id}
                href={`/manuscripts/${manuscript.id}/chapters/${chapter.id}/workspace`}
                className="block border-b border-line px-4 py-3 last:border-b-0 hover:bg-paper"
              >
                <div className="text-sm font-semibold">{chapter.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {chapter.wordCount.toLocaleString()} words
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {report && structured ? (
            <ReportPanel
              manuscriptId={manuscript.id}
              report={structured}
              createdAt={report.createdAt}
            />
          ) : (
            <div className="border border-line bg-white p-6 text-sm text-slate-600 shadow-panel">
              No audit report yet. Run the manuscript audit to generate the
              executive summary, ranked issues, chapter notes, and rewrite
              strategy.
            </div>
          )}

          {latestRewrite ? (
            <section className="border border-line bg-white shadow-panel">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Latest Chapter 1 Rewrite
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function countJobsByStatus(jobs: Array<{ status: string }>) {
  const queuedStatuses = new Set<string>([
    PIPELINE_JOB_STATUS.QUEUED,
    PIPELINE_JOB_STATUS.RETRYING,
    PIPELINE_JOB_STATUS.BLOCKED
  ]);

  return {
    queued: jobs.filter((job) => queuedStatuses.has(job.status)).length,
    running: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.RUNNING).length,
    failed: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.FAILED).length,
    completed: jobs.filter((job) => job.status === PIPELINE_JOB_STATUS.COMPLETED).length
  };
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
            Audit Report
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Generated {createdAt.toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/manuscripts/${manuscriptId}/report/markdown`}
            className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-paper px-3 py-2 text-sm font-semibold"
          >
            <Download size={16} aria-hidden="true" />
            Markdown
          </a>
          <a
            href={`/api/manuscripts/${manuscriptId}/report/json`}
            className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-paper px-3 py-2 text-sm font-semibold"
          >
            <Download size={16} aria-hidden="true" />
            JSON
          </a>
          <a
            href={`/api/manuscripts/${manuscriptId}/report/docx`}
            className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-paper px-3 py-2 text-sm font-semibold"
          >
            <FileText size={16} aria-hidden="true" />
            DOCX
          </a>
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
          <h3 className="text-lg font-semibold">Top 20 Issues</h3>
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
          <h3 className="text-lg font-semibold">Chapter-by-Chapter Notes</h3>
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
          : "bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex min-h-7 items-center justify-center px-2 text-xs font-semibold uppercase tracking-wide ${className}`}
    >
      {severity}
    </span>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
