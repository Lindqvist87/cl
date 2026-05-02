import Link from "next/link";
import { BookOpen, Database } from "lucide-react";
import {
  CorpusAnalysisAction,
  CorpusAnalysisProgress
} from "@/components/CorpusAnalysisProgress";
import { ManualCorpusImportForm } from "@/components/ManualCorpusImportForm";
import { getCorpusProgressStatus } from "@/lib/corpus/corpusProgress";
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
  const statuses = new Map(
    await Promise.all(
      books.map(async (book) => [
        book.id,
        await getCorpusProgressStatus(book.id)
      ] as const)
    )
  );

  return (
    <div className="space-y-6">
      <header className="paper-card p-7 sm:p-8">
        <div>
          <Link href="/" className="ghost-button px-0">
            Back to dashboard
          </Link>
          <p className="page-kicker mt-6">Reference library</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">
            Benchmark texts for editorial comparison.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Keep legally usable reference books and metadata close to the editorial workflow.
          </p>
        </div>
      </header>

      <ManualCorpusImportForm />

      <section className="paper-card p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="section-title">
            Reference texts
          </h2>
        </div>
        {books.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No corpus books imported yet.
          </div>
        ) : (
          <div className="grid gap-3 p-4">
            {books.map((book) => {
              const status = statuses.get(book.id);
              if (!status) return null;

              return (
                <article key={book.id} className="space-y-4 rounded-lg border border-line bg-paper-alt p-4">
                  <div className="grid gap-4 xl:grid-cols-[1fr_360px_180px]">
                    <div className="flex gap-3">
                      <BookOpen size={20} className="mt-1 text-accent" aria-hidden="true" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{book.title}</h3>
                          <Link
                            href={`/admin/corpus/${book.id}`}
                            className="text-sm font-semibold text-accent hover:underline"
                          >
                            Admin details
                          </Link>
                          {book.profile ? (
                            <Link
                              href={`/admin/corpus/${book.id}/profile`}
                            className="text-sm text-accent hover:underline"
                          >
                              Reading profile
                          </Link>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {[book.author, book.language, book.genre].filter(Boolean).join(" / ") || "Metadata pending"}
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
                      <details className="col-span-2 rounded-lg border border-line bg-white px-3 py-2 sm:col-span-4 xl:col-span-2">
                        <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-accent">
                          Admin details
                        </summary>
                        <div className="mt-2">
                          <MetricWithIcon label="Chunks" value={String(book._count.chunks)} />
                        </div>
                      </details>
                    </div>

                    <div className="flex items-start xl:justify-end">
                      <CorpusAnalysisAction initialStatus={status} />
                    </div>
                  </div>

                  <CorpusAnalysisProgress initialStatus={status} compact />
                </article>
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
