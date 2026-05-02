import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Download } from "lucide-react";
import { AnalysisPassType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuditReportJson, JsonRecord } from "@/lib/types";
import { aggregateEditorialFindingPriorities } from "@/lib/editorial/findingAggregation";

export const dynamic = "force-dynamic";

export default async function ManuscriptAuditPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    include: {
      reports: { orderBy: { createdAt: "desc" }, take: 1 },
      chapters: { orderBy: { order: "asc" } },
      findings: {
        orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
        include: { chapter: true },
        take: 80
      },
      rewritePlans: { orderBy: { createdAt: "desc" }, take: 1 },
      outputs: {
        where: {
          passType: {
            in: [
              AnalysisPassType.CORPUS_COMPARISON,
              AnalysisPassType.TREND_COMPARISON,
              AnalysisPassType.WHOLE_BOOK_AUDIT
            ]
          }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!manuscript) {
    notFound();
  }

  const report = manuscript.reports[0];
  const structured = report?.structured as AuditReportJson | undefined;
  const score = toRecord(structured?.metadata).commercialManuscriptScore;
  const corpusOutput = manuscript.outputs.find(
    (output) => output.passType === AnalysisPassType.CORPUS_COMPARISON
  );
  const trendOutput = manuscript.outputs.find(
    (output) => output.passType === AnalysisPassType.TREND_COMPARISON
  );
  const rewritePlan = manuscript.rewritePlans[0];
  const priorityThemes = aggregateEditorialFindingPriorities({
    chapters: manuscript.chapters,
    findings: manuscript.findings,
    limit: 6
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/manuscripts/${manuscript.id}`} className="text-sm text-accent hover:underline">
            Back to manuscript
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            Editorial report: {manuscript.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/manuscripts/${manuscript.id}/structure`}
            className="secondary-button min-h-9 px-3"
          >
            <BookOpen size={16} aria-hidden="true" />
            Review structure
          </Link>
          <a href={`/api/manuscripts/${manuscript.id}/report/markdown`} className="secondary-button min-h-9 px-3">
            <Download size={16} aria-hidden="true" />
            Markdown
          </a>
          <a href={`/api/manuscripts/${manuscript.id}/report/json`} className="secondary-button min-h-9 px-3">
            <Download size={16} aria-hidden="true" />
            JSON
          </a>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <Stat label="Editorial score" value={typeof score === "number" ? `${score}/100` : "Pending"} />
        <Stat label="Issues to review" value={String(manuscript.findings.length)} />
        <Stat label="Revision plan" value={rewritePlan ? "Ready" : "Pending"} />
      </section>

      <section className="border border-line bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold">Executive Summary</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {structured?.executiveSummary ?? "No editorial report has been generated yet."}
        </p>
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Priority themes
          </h2>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {priorityThemes.length === 0 ? (
            <p className="text-sm text-slate-500">No priority themes are available yet.</p>
          ) : (
            priorityThemes.map((priority) => (
              <PriorityThemeSummary key={priority.priorityId} priority={priority} />
            ))
          )}
        </div>
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Issues to review
          </h2>
        </div>
        <div className="divide-y divide-line">
          {manuscript.findings.slice(0, 20).map((finding) => (
            <div key={finding.id} className="grid gap-3 px-4 py-4 md:grid-cols-[90px_1fr]">
              <span className="inline-flex h-7 items-center justify-center bg-paper text-xs font-semibold">
                S{finding.severity}
              </span>
              <div>
                <div className="font-semibold">{finding.problem}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {[finding.issueType, finding.chapter?.title].filter(Boolean).join(" | ")}
                </div>
                {finding.evidence ? (
                  <p className="mt-2 text-sm text-slate-700">{finding.evidence}</p>
                ) : null}
                <p className="mt-2 text-sm text-slate-700">{finding.recommendation}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Section notes
          </h2>
        </div>
        <div className="divide-y divide-line">
          {Object.entries(groupFindingsByChapter(manuscript.findings)).map(
            ([chapterTitle, findings]) => (
              <div key={chapterTitle} className="px-4 py-4">
                <h3 className="font-semibold">{chapterTitle}</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {findings.map((finding) => (
                    <li key={finding.id}>
                      S{finding.severity} {finding.problem}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <ComparisonPanel title="Corpus comparison" output={toRecord(corpusOutput?.output)} />
        <ComparisonPanel title="Trend comparison" output={toRecord(trendOutput?.output)} />
      </section>

      <section className="border border-line bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold">Recommended Rewrite Strategy</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {rewritePlan?.globalStrategy ?? structured?.rewriteStrategy ?? "Rewrite plan pending."}
        </p>
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

function ComparisonPanel({
  title,
  output
}: {
  title: string;
  output: JsonRecord;
}) {
  const summary =
    typeof output.summary === "string"
      ? output.summary
      : "Comparison pending or source data unavailable.";

  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">{summary}</p>
      <details className="detail-toggle mt-3">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink hover:text-accent">
          Technical details
        </summary>
        <pre className="max-h-72 overflow-auto border-t border-line bg-paper-alt p-3 text-xs leading-5 text-slate-700">
          {JSON.stringify(output, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function PriorityThemeSummary({
  priority
}: {
  priority: {
    title: string;
    issueCount: number;
    affectedSectionLabels: string[];
    displayPriority: string;
    rawSeverityRange: string;
    recommendedAction: string;
  };
}) {
  const affected =
    priority.affectedSectionLabels.length > 0
      ? priority.affectedSectionLabels.slice(0, 3).join(", ")
      : "Manuscript level";
  const remaining = Math.max(0, priority.affectedSectionLabels.length - 3);

  return (
    <section className="rounded-lg border border-line bg-paper-alt p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{priority.title}</h3>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {priority.displayPriority}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {priority.issueCount} issue{priority.issueCount === 1 ? "" : "s"} |{" "}
        {priority.rawSeverityRange} raw | {affected}
        {remaining > 0 ? ` and ${remaining} more` : ""}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{priority.recommendedAction}</p>
    </section>
  );
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function groupFindingsByChapter<
  T extends { id: string; chapter?: { title: string } | null }
>(findings: T[]) {
  return findings.reduce<Record<string, T[]>>((groups, finding) => {
    const title = finding.chapter?.title ?? "Whole manuscript";
    groups[title] = groups[title] ?? [];
    groups[title].push(finding);
    return groups;
  }, {});
}
