import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { AuditButton } from "@/components/AuditButton";
import { RewriteChapterButton } from "@/components/RewriteChapterButton";
import type { AuditReportJson } from "@/lib/types";

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
      rewrites: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  if (!manuscript) {
    notFound();
  }

  const report = manuscript.reports[0];
  const structured = report?.structured as AuditReportJson | undefined;
  const latestRun = manuscript.runs[0];
  const latestRewrite = manuscript.rewrites[0];

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
          {latestRun?.error ? (
            <p className="mt-3 text-sm text-danger">{latestRun.error}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AuditButton
            manuscriptId={manuscript.id}
            disabled={manuscript.analysisStatus === "RUNNING"}
          />
          <RewriteChapterButton manuscriptId={manuscript.id} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Words" value={manuscript.wordCount.toLocaleString()} />
        <Stat label="Chapters" value={String(manuscript.chapterCount)} />
        <Stat label="Chunks" value={String(manuscript.chunkCount)} />
        <Stat label="Analysis" value={formatStatus(manuscript.analysisStatus)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">
            Chapters
          </div>
          <div className="max-h-[520px] overflow-auto">
            {manuscript.chapters.map((chapter) => (
              <div key={chapter.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="text-sm font-semibold">{chapter.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {chapter.wordCount.toLocaleString()} words
                </div>
              </div>
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
                {latestRewrite.content}
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
