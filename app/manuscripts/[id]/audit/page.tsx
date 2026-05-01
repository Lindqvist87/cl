import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Download } from "lucide-react";
import { AnalysisPassType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuditReportJson, JsonRecord } from "@/lib/types";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/manuscripts/${manuscript.id}`} className="text-sm text-accent hover:underline">
            Back to manuscript
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            Audit: {manuscript.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/manuscripts/${manuscript.id}/structure`}
            className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-white px-3 py-2 text-sm font-semibold"
          >
            <BookOpen size={16} aria-hidden="true" />
            Inspect imported structure
          </Link>
          <a href={`/api/manuscripts/${manuscript.id}/report/markdown`} className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-white px-3 py-2 text-sm font-semibold">
            <Download size={16} aria-hidden="true" />
            Markdown
          </a>
          <a href={`/api/manuscripts/${manuscript.id}/report/json`} className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-white px-3 py-2 text-sm font-semibold">
            <Download size={16} aria-hidden="true" />
            JSON
          </a>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <Stat label="Commercial Score" value={typeof score === "number" ? `${score}/100` : "Pending"} />
        <Stat label="Findings" value={String(manuscript.findings.length)} />
        <Stat label="Rewrite Plan" value={rewritePlan ? "Ready" : "Pending"} />
      </section>

      <section className="border border-line bg-white p-4 shadow-panel">
        <h2 className="text-lg font-semibold">Executive Summary</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {structured?.executiveSummary ?? "No audit report has been generated yet."}
        </p>
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Top Findings
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
            Section-by-Section Findings
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
        <ComparisonPanel title="Corpus Comparison" output={toRecord(corpusOutput?.output)} />
        <ComparisonPanel title="Trend Comparison" output={toRecord(trendOutput?.output)} />
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
      <pre className="mt-3 max-h-72 overflow-auto bg-paper p-3 text-xs leading-5 text-slate-700">
        {JSON.stringify(output, null, 2)}
      </pre>
    </div>
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
