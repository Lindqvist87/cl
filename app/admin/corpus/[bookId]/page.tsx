import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BookOpen, Database, FileText, ScrollText } from "lucide-react";
import {
  CorpusAnalysisAction,
  CorpusAnalysisProgress
} from "@/components/CorpusAnalysisProgress";
import { getCorpusProgressStatus } from "@/lib/corpus/corpusProgress";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CorpusBookDetailPage({
  params
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  const book = await prisma.corpusBook.findUnique({
    where: { id: bookId },
    include: {
      source: true,
      text: true,
      profile: true,
      importJobs: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      _count: {
        select: {
          chapters: true,
          chunks: true
        }
      }
    }
  });

  if (!book) {
    notFound();
  }

  const progressStatus = await getCorpusProgressStatus(book.id);
  const report = toRecord(book.text?.extractionReport);
  const detectedMetadata = toRecord(report.detectedMetadata);
  const warnings = stringArray(report.warnings);
  const sourceFormat =
    stringValue(report.sourceFormat) ??
    stringValue(report.format) ??
    book.fileFormat ??
    "Unknown";

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Link href="/admin/corpus/onboarding" className="text-sm text-accent hover:underline">
          Back to corpus onboarding
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">{book.title}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {[book.author, book.language, book.genre].filter(Boolean).join(" | ") ||
                "Corpus book"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {book.sourceName || book.source.name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CorpusAnalysisAction
              initialStatus={progressStatus}
            />
            {book.profile ? (
              <Link
                href={`/admin/corpus/${book.id}/profile`}
                className="focus-ring inline-flex min-h-10 items-center justify-center border border-line bg-white px-4 text-sm font-semibold text-ink shadow-panel hover:bg-paper"
              >
                Book DNA
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TopMetric icon={FileText} label="Source format" value={sourceFormat} />
        <TopMetric
          icon={BookOpen}
          label="Text words"
          value={(book.text?.wordCount ?? 0).toLocaleString()}
        />
        <TopMetric icon={ScrollText} label="Chapters" value={String(book._count.chapters)} />
        <TopMetric icon={Database} label="Chunks" value={String(book._count.chunks)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DetailPanel title="Extraction">
          <MetricRows
            rows={[
              ["Rootfile", stringValue(report.rootfilePath) ?? "Not recorded"],
              ["Spine items", formatNumber(report.spineItemCount)],
              ["Documents extracted", formatNumber(report.extractedDocumentCount)],
              ["Documents skipped", formatNumber(report.skippedDocumentCount)],
              ["Navigation removed", yesNo(report.navRemoved)],
              ["TOC removed", yesNo(report.tocRemoved)],
              ["Poetry formatting", yesNo(report.poetryFormattingPreserved)]
            ]}
          />
        </DetailPanel>

        <DetailPanel title="Detected Metadata">
          <MetricRows
            rows={[
              ["Title", firstString(report.detectedTitle, detectedMetadata.title)],
              ["Author", firstString(report.detectedAuthor, detectedMetadata.author)],
              ["Language", firstString(report.detectedLanguage, detectedMetadata.language)],
              ["Publisher", firstString(report.detectedPublisher, detectedMetadata.publisher)],
              [
                "Publication date",
                firstString(report.detectedPublicationDate, detectedMetadata.publicationDate)
              ],
              ["Identifier", firstString(report.detectedIdentifier, detectedMetadata.identifier)]
            ]}
          />
        </DetailPanel>

        <DetailPanel title="Import Status">
          <MetricRows
            rows={[
              ["Ingestion", formatStatus(book.ingestionStatus)],
              ["Analysis", formatStatus(book.analysisStatus)],
              ["Benchmark", book.benchmarkReady ? "Ready" : book.benchmarkAllowed ? "Allowed" : "Off"],
              [
                "Blocked reason",
                book.benchmarkBlockedReason ?? progressStatus.benchmarkBlockedReason ?? "None"
              ],
              ["Latest job", book.importJobs[0] ? formatStatus(book.importJobs[0].currentStep) : "None"]
            ]}
          />
        </DetailPanel>

        <DetailPanel title="Analysis Progress">
          <CorpusAnalysisProgress initialStatus={progressStatus} />
        </DetailPanel>

        <DetailPanel title="Warnings">
          {warnings.length > 0 ? (
            <ul className="space-y-2 text-sm text-slate-700">
              {warnings.map((warning) => (
                <li key={warning} className="flex gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">No extraction warnings.</p>
          )}
        </DetailPanel>
      </section>
    </div>
  );
}

function TopMetric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <Icon size={20} className="text-accent" aria-hidden="true" />
      <div className="mt-3 text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-xl font-semibold">{value}</div>
    </div>
  );
}

function DetailPanel({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]) {
  return values.map(stringValue).find(Boolean) ?? "Not detected";
}

function formatNumber(value: unknown) {
  return typeof value === "number" ? value.toLocaleString() : "0";
}

function yesNo(value: unknown) {
  return value === true ? "Yes" : "No";
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
