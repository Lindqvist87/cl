import Link from "next/link";
import { FileText } from "lucide-react";
import copy from "@/content/app-copy.json";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const manuscripts = await prisma.manuscript.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {copy.dashboard.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            {copy.dashboard.intro}
          </p>
        </div>
        <UploadForm />
      </section>

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            {copy.dashboard.sectionTitle}
          </h2>
        </div>
        {manuscripts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {copy.dashboard.emptyState}
          </div>
        ) : (
          <div className="divide-y divide-line">
            {manuscripts.map((manuscript) => (
              <Link
                key={manuscript.id}
                href={`/manuscripts/${manuscript.id}`}
                className="focus-ring grid gap-3 px-4 py-4 hover:bg-paper sm:grid-cols-[1fr_120px_120px_160px]"
              >
                <div className="flex items-start gap-3">
                  <FileText
                    size={20}
                    className="mt-0.5 text-accent"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="font-semibold">{manuscript.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {manuscript.sourceFileName}
                    </p>
                  </div>
                </div>
                <Metric
                  label={copy.dashboard.metrics.words}
                  value={manuscript.wordCount.toLocaleString()}
                />
                <Metric
                  label={copy.dashboard.metrics.chapters}
                  value={String(manuscript.chapterCount)}
                />
                <Metric
                  label={copy.dashboard.metrics.status}
                  value={formatStatus(manuscript.analysisStatus)}
                />
              </Link>
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
