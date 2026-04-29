import Link from "next/link";
import { BookOpen, Database } from "lucide-react";
import {
  CorpusAnalysisAction,
  CorpusAnalysisProgress
} from "@/components/CorpusAnalysisProgress";
import { ManualCorpusImportForm } from "@/components/ManualCorpusImportForm";
import { getCorpusAnalysisSummary } from "@/lib/corpus/corpusAnalysisJobs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CorpusPage() {
  const books = await prisma.corpusBook.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      source: true,
      text: true,
      profile: true,
      _count: {
        select: {
          chapters: true,
          chunks: true
        }
      }
    }
  });
  const summaries = new Map(
    await Promise.all(
      books.map(async (book) => [
        book.id,
        await getCorpusAnalysisSummary(book.id)
      ] as const)
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/" className="text-sm text-accent hover:underline">
            Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">Corpus</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Import legal benchmark texts and metadata with rights status tracked per book.
          </p>
        </div>
      </div>

      <ManualCorpusImportForm />

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Imported Books
          </h2>
        </div>
        {books.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No corpus books imported yet.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {books.map((book) => {
              const summary = summaries.get(book.id);
              if (!summary) return null;

              return (
                <div key={book.id} className="space-y-4 px-4 py-4">
                  <div className="grid gap-4 xl:grid-cols-[1fr_360px_auto]">
                    <div className="flex gap-3">
                      <BookOpen size={20} className="mt-1 text-accent" aria-hidden="true" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{book.title}</h3>
                          <Link
                            href={`/admin/corpus/${book.id}`}
                            className="text-sm text-accent hover:underline"
                          >
                            Details
                          </Link>
                          {book.profile ? (
                            <Link
                              href={`/admin/corpus/${book.id}/profile`}
                              className="text-sm text-accent hover:underline"
                            >
                              Book DNA
                            </Link>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {[book.author, book.language, book.genre].filter(Boolean).join(" | ") || "Metadata pending"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{book.source.name}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:grid-cols-2">
                      <Metric label="Rights" value={formatStatus(book.rightsStatus)} />
                      <Metric label="Ingestion" value={formatStatus(book.ingestionStatus)} />
                      <Metric label="Analysis" value={formatStatus(book.analysisStatus)} />
                      <Metric
                        label="Benchmark"
                        value={book.benchmarkReady ? "Ready" : "Not ready"}
                      />
                      <MetricWithIcon label="Chapters" value={String(book._count.chapters)} />
                      <MetricWithIcon label="Chunks" value={String(book._count.chunks)} />
                    </div>

                    <div className="flex items-start xl:justify-end">
                      <CorpusAnalysisAction
                        bookId={book.id}
                        analysisStatus={book.analysisStatus}
                        summary={summary}
                      />
                    </div>
                  </div>

                  <CorpusAnalysisProgress summary={summary} compact />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function MetricWithIcon({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <Database size={16} className="mt-0.5 text-accent" aria-hidden="true" />
      <Metric label={label} value={value} />
    </div>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
