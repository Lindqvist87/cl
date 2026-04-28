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
      <div>
        <Link href="/" className="text-sm text-accent hover:underline">
          Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">Trends</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Store public metadata, bestseller/list signals, category notes, and review snippets.
        </p>
      </div>

      <ManualTrendImportForm />

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Trend Signals
          </h2>
        </div>
        {signals.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No trend signals imported yet.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {signals.map((signal) => (
              <div key={signal.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_120px_140px_120px]">
                <div className="flex gap-3">
                  <TrendingUp size={20} className="mt-1 text-accent" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold">
                      {signal.title || signal.category || signal.listName || signal.source}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {[signal.author, signal.genre, signal.category].filter(Boolean).join(" | ") || "General market signal"}
                    </p>
                    {signal.description ? (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                        {signal.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <Metric label="Source" value={signal.source} />
                <Metric
                  label="Date"
                  value={signal.signalDate ? signal.signalDate.toLocaleDateString() : "Unknown"}
                />
                <Metric label="Rank" value={signal.rank ? String(signal.rank) : "N/A"} />
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
