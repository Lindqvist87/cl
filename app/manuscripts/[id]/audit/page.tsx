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
    <div className="space-y-8">
      <header className="paper-card flex flex-col gap-5 p-7 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href={`/manuscripts/${manuscript.id}`} className="ghost-button px-0">
            Back to manuscript
          </Link>
          <p className="page-kicker mt-6">Editorial report</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">
            {manuscript.title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Review the manuscript-level summary, priority themes, and section notes before moving into revision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
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
          <details className="rounded-lg border border-line bg-paper-alt">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink hover:text-accent">
              Export details
            </summary>
            <div className="border-t border-line p-2">
              <a href={`/api/manuscripts/${manuscript.id}/report/json`} className="ghost-button justify-start">
                <Download size={16} aria-hidden="true" />
                JSON
              </a>
            </div>
          </details>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Stat label="Editorial score" value={typeof score === "number" ? `${score}/100` : "Pending"} />
        <Stat label="Issues to review" value={String(manuscript.findings.length)} />
        <Stat label="Revision plan" value={rewritePlan ? "Ready" : "Pending"} />
      </section>

      <section className="active-card p-6">
        <p className="page-kicker">Start here</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-normal">Executive summary</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {structured?.executiveSummary ?? "No editorial report has been generated yet."}
        </p>
      </section>

      <section className="paper-card p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="section-title">
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

      <section className="paper-card p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="section-title">
            Issues to review
          </h2>
        </div>
        <div className="grid gap-3 p-4">
          {manuscript.findings.slice(0, 20).map((finding) => (
            <article key={finding.id} className="rounded-lg border border-line bg-paper-alt p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge severity={finding.severity} />
                  <div className="font-semibold">{finding.problem}</div>
                </div>
                <div className="mt-2 text-xs text-muted">
                  {[finding.issueType, finding.chapter?.title].filter(Boolean).join(" / ")}
                </div>
                {finding.evidence ? (
                  <p className="mt-2 text-sm text-slate-700">{finding.evidence}</p>
                ) : null}
                <p className="mt-2 text-sm text-slate-700">{finding.recommendation}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="paper-card p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="section-title">
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
                    <li key={finding.id} className="flex flex-wrap items-center gap-2">
                      <PriorityBadge severity={finding.severity} compact />
                      <span>{finding.problem}</span>
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

      <section className="paper-card p-6">
        <h2 className="text-lg font-semibold">Recommended rewrite strategy</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {rewritePlan?.globalStrategy ?? structured?.rewriteStrategy ?? "Rewrite plan pending."}
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
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
    <div className="paper-card p-5">
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
        {priority.issueCount} note{priority.issueCount === 1 ? "" : "s"} / {affected}
        {remaining > 0 ? ` and ${remaining} more` : ""}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{priority.recommendedAction}</p>
    </section>
  );
}

function PriorityBadge({
  compact = false,
  severity
}: {
  compact?: boolean;
  severity: number;
}) {
  const label =
    severity >= 5
      ? "Highest priority"
      : severity >= 4
        ? "High priority"
        : severity >= 3
          ? "Medium priority"
          : "Lower priority";
  const className =
    severity >= 5
      ? "border-danger/20 bg-danger/5 text-danger"
      : severity >= 4
        ? "border-warn/25 bg-warn/5 text-warn"
        : severity >= 3
          ? "border-accent/20 bg-accent/10 text-accent"
          : "border-line bg-white text-muted";

  return (
    <span className={`inline-flex min-h-7 w-fit items-center rounded-full border px-3 text-xs font-semibold ${className}`}>
      {compact ? label.replace(" priority", "") : label}
    </span>
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
