import Link from "next/link";
import { BookOpen, CheckCircle2, Database } from "lucide-react";
import {
  CorpusAnalysisAction,
  CorpusAnalysisProgress
} from "@/components/CorpusAnalysisProgress";
import { getCorpusProgressStatus } from "@/lib/corpus/corpusProgress";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminCorpusPage() {
  const books = await prisma.corpusBook.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      source: true,
      profile: { select: { id: true } },
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
      <section className="space-y-3">
        <Link href="/" className="text-sm text-accent hover:underline">
          Back to dashboard
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Corpus Admin</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Track imported books through cleaning, chapters, chunks, embeddings,
              Book DNA, and benchmark readiness.
            </p>
          </div>
          <Link
            href="/admin/corpus/onboarding"
            className="primary-button"
          >
            Upload books
          </Link>
        </div>
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Corpus Books
          </h2>
        </div>
        {books.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No corpus books imported yet.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {books.map((book) => {
              const status = statuses.get(book.id);
              if (!status) return null;

              return (
                <div key={book.id} className="space-y-4 px-4 py-4">
                  <div className="grid gap-4 xl:grid-cols-[1fr_260px_auto]">
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
                          {[book.author, book.language, book.genre].filter(Boolean).join(" | ") ||
                            "Metadata pending"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {book.sourceName || book.source.name}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <Metric icon={CheckCircle2} label="Analysis" value={formatStatus(book.analysisStatus)} />
                      <Metric
                        icon={CheckCircle2}
                        label="Benchmark"
                        value={book.benchmarkReady ? "Ready" : "Not ready"}
                      />
                      <Metric icon={Database} label="Chapters" value={String(book._count.chapters)} />
                      <Metric icon={Database} label="Chunks" value={String(book._count.chunks)} />
                    </div>

                    <div className="flex items-start xl:justify-end">
                      <CorpusAnalysisAction
                        initialStatus={status}
                      />
                    </div>
                  </div>

                  <CorpusAnalysisProgress initialStatus={status} compact />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-2">
      <Icon size={16} className="mt-0.5 text-accent" aria-hidden="true" />
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1 text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
