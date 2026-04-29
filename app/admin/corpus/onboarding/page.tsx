import Link from "next/link";
import { BookOpen, CheckCircle2, Database, ShieldCheck } from "lucide-react";
import { CorpusOnboardingForm } from "@/components/CorpusOnboardingForm";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PROGRESS_STEPS = [
  ["uploaded", "Uploaded"],
  ["textExtracted", "Text"],
  ["cleaned", "Cleaned"],
  ["chaptersDetected", "Chapters"],
  ["chunksCreated", "Chunks"],
  ["embeddingsCreated", "Embeddings"],
  ["bookDnaExtracted", "Book DNA"],
  ["benchmarkReady", "Ready"]
] as const;

type OnboardingBook = Awaited<ReturnType<typeof getCorpusOnboardingBooks>>[number];

export default async function CorpusOnboardingPage() {
  const books = await getCorpusOnboardingBooks();

  const health = starterCorpusHealth(books);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Link href="/" className="text-sm text-accent hover:underline">
          Back to dashboard
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Corpus Onboarding
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Upload 3-10 books you have rights to use. Good first sources:
              Project Gutenberg, Litteraturbanken/Sprakbanken open texts,
              DOAB/open-license books.
            </p>
          </div>
          {health.benchmarkReady >= 3 ? (
            <div className="inline-flex min-h-10 items-center gap-2 border border-line bg-white px-3 text-sm font-semibold text-ink shadow-panel">
              <CheckCircle2 size={18} className="text-accent" aria-hidden="true" />
              Starter corpus is ready.
            </div>
          ) : null}
        </div>
      </section>

      <HealthPanel health={health} />
      <CorpusOnboardingForm />
      <ImportStatus books={books} />
    </div>
  );
}

function getCorpusOnboardingBooks() {
  return prisma.corpusBook.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      source: true,
      profile: true,
      chunks: {
        select: {
          embeddingStatus: true
        }
      },
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
}

function HealthPanel({
  health
}: {
  health: ReturnType<typeof starterCorpusHealth>;
}) {
  return (
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Starter Corpus Health
        </h2>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <HealthMetric icon={BookOpen} label="Books" value={String(health.books)} />
        <HealthMetric icon={CheckCircle2} label="Benchmark ready" value={String(health.benchmarkReady)} />
        <HealthMetric icon={Database} label="Avg chunks" value={String(health.averageChunkCoverage)} />
        <HealthMetric icon={ShieldCheck} label="Rights safe" value={health.rightsSafe ? "Yes" : "No"} />
        <MetricBlock label="Languages" value={health.languages.join(", ") || "None"} />
        <MetricBlock label="Genres" value={health.genres.join(", ") || "None"} />
        <MetricBlock label="Embeddings complete" value={health.embeddingsComplete ? "Yes" : "No"} />
        <MetricBlock label="Health score" value={`${health.score}/100`} />
      </div>
    </section>
  );
}

function ImportStatus({
  books
}: {
  books: OnboardingBook[];
}) {
  return (
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Import Status
        </h2>
      </div>
      {books.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          No corpus books imported yet.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {books.map((book) => {
            const progress = toRecord(book.importProgress);
            const job = book.importJobs[0];
            return (
              <div key={book.id} className="grid gap-4 px-4 py-4 xl:grid-cols-[1fr_220px_260px]">
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
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <MetricBlock label="Rights" value={formatStatus(book.rightsStatus)} />
                  <MetricBlock label="Benchmark" value={book.benchmarkReady ? "Ready" : book.benchmarkAllowed ? "Allowed" : "Off"} />
                  <MetricBlock label="Chapters" value={String(book._count.chapters)} />
                  <MetricBlock label="Chunks" value={String(book._count.chunks)} />
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    {job ? formatStatus(job.currentStep) : formatStatus(book.ingestionStatus)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 xl:grid-cols-2">
                    {PROGRESS_STEPS.map(([key, label]) => (
                      <span
                        key={key}
                        className={[
                          "inline-flex min-h-8 items-center justify-center border px-2 text-center",
                          progress[key]
                            ? "border-accent bg-paper text-ink"
                            : "border-line text-slate-500"
                        ].join(" ")}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HealthMetric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={20} className="mt-1 text-accent" aria-hidden="true" />
      <MetricBlock label={label} value={value} />
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold">{value}</div>
    </div>
  );
}

function starterCorpusHealth(
  books: Array<{
    language?: string | null;
    genre?: string | null;
    rightsStatus: string;
    benchmarkAllowed: boolean;
    benchmarkReady: boolean;
    _count: { chunks: number };
    chunks?: Array<{ embeddingStatus: string }>;
  }>
) {
  const benchmarkReady = books.filter((book) => book.benchmarkReady).length;
  const languages = uniqueValues(books.map((book) => book.language));
  const genres = uniqueValues(books.map((book) => book.genre));
  const averageChunkCoverage =
    books.length > 0
      ? Math.round(books.reduce((sum, book) => sum + book._count.chunks, 0) / books.length)
      : 0;
  const rightsSafe = books.every(
    (book) =>
      !book.benchmarkAllowed ||
      (book.rightsStatus !== "UNKNOWN" && book.rightsStatus !== "METADATA_ONLY")
  );
  const embeddingsComplete =
    benchmarkReady > 0 &&
    books
      .filter((book) => book.benchmarkReady)
      .every(
        (book) =>
          (book.chunks?.length ?? 0) > 0 &&
          book.chunks?.every((chunk) => chunk.embeddingStatus === "STORED")
      );

  return {
    books: books.length,
    benchmarkReady,
    languages,
    genres,
    averageChunkCoverage,
    embeddingsComplete,
    rightsSafe,
    score: Math.min(
      100,
      benchmarkReady * 20 +
        Math.min(languages.length, 3) * 8 +
        Math.min(genres.length, 3) * 8 +
        (rightsSafe ? 12 : 0) +
        (averageChunkCoverage > 0 ? 12 : 0)
    )
  };
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  );
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
