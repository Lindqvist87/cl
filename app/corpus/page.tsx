import Link from "next/link";
import { BookOpen } from "lucide-react";
import { ManualCorpusImportForm } from "@/components/ManualCorpusImportForm";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CorpusPage() {
  const books = await prisma.corpusBook.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      source: true,
      text: true,
      profile: true
    }
  });

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
            {books.map((book) => (
              <div key={book.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_140px_150px_150px]">
                <div className="flex gap-3">
                  <BookOpen size={20} className="mt-1 text-accent" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold">{book.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {[book.author, book.language, book.genre].filter(Boolean).join(" | ") || "Metadata pending"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{book.source.name}</p>
                  </div>
                </div>
                <Metric label="Rights" value={formatStatus(book.rightsStatus)} />
                <Metric label="Ingestion" value={formatStatus(book.ingestionStatus)} />
                <Metric label="Analysis" value={formatStatus(book.analysisStatus)} />
              </div>
            ))}
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

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
