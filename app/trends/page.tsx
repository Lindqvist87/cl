import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { ManualTrendImportForm } from "@/components/ManualTrendImportForm";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const signals = await prisma.trendSignal.findMany({
    orderBy: [{ signalDate: "desc" }, { createdAt: "desc" }],
    take: 100
  });

  return (
    <div className="space-y-6">
      <header className="paper-card p-7 sm:p-8">
        <Link href="/" className="ghost-button px-0">
          Back to dashboard
        </Link>
        <p className="page-kicker mt-6">Market signals</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-normal">
          Signals that shape reader expectations.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Store public metadata, bestseller/list signals, category notes, and review snippets for editorial comparison.
        </p>
      </header>

      <ManualTrendImportForm />

      <section className="paper-card p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="section-title">
            Recent signals
          </h2>
        </div>
        {signals.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No trend signals imported yet.
          </div>
        ) : (
          <div className="grid gap-3 p-4">
            {signals.map((signal) => (
              <article key={signal.id} className="grid gap-4 rounded-lg border border-line bg-paper-alt p-4 lg:grid-cols-[1fr_auto]">
                <div className="flex gap-3">
                  <TrendingUp size={20} className="mt-1 text-accent" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold">
                      {signal.title || signal.category || signal.listName || signal.source}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {[signal.author, signal.genre, signal.category].filter(Boolean).join(" / ") || "General market signal"}
                    </p>
                    {signal.description ? (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                        {signal.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Metric label="Source" value={signal.source} />
                  <Metric
                    label="Date"
                    value={signal.signalDate ? signal.signalDate.toLocaleDateString() : "Unknown"}
                  />
                  <Metric label="Rank" value={signal.rank ? String(signal.rank) : "N/A"} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-xs text-muted">
      <span>{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}
