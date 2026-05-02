import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";
import copy from "@/content/app-copy.json";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let dbError: string | null = null;
  let manuscripts: Awaited<ReturnType<typeof getDashboardManuscripts>> = [];

  try {
    manuscripts = await getDashboardManuscripts();
  } catch (error) {
    dbError = error instanceof Error ? error.message : "Manuslistan är inte tillgänglig.";
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-paper-alt px-4 py-8 sm:px-7 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div>
            <p className="text-sm font-semibold text-accent">Starta nytt manus</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-normal text-ink sm:text-5xl">
              Ladda upp ditt manus
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">
              Få en redaktionell översikt, prioriterade förbättringsområden och
              ett tydligt första steg.
            </p>

            <div className="mt-7">
              <UploadForm />
            </div>
          </div>

          <aside className="paper-card p-5 lg:mt-24">
            <h2 className="text-base font-semibold tracking-normal text-ink">
              Så fungerar det
            </h2>
            <div className="mt-4 space-y-3">
              <StepItem index="1" text="Vi läser in manuset" />
              <StepItem index="2" text="Vi skapar en redaktionell karta" />
              <StepItem index="3" text="Du får veta var du bör börja" />
            </div>
            <p className="mt-5 flex gap-2 text-sm leading-6 text-muted">
              <ShieldCheck
                size={17}
                className="mt-0.5 shrink-0 text-accent"
                aria-hidden="true"
              />
              <span>
                Du behåller alltid kontrollen. Appen föreslår – du bestämmer.
              </span>
            </p>
          </aside>
        </div>
      </section>

      {dbError ? <DatabaseErrorPanel message={dbError} /> : null}

      <section className="border border-line bg-white shadow-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold tracking-normal text-ink">
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
                className="focus-ring grid gap-3 px-4 py-4 hover:bg-paper-alt sm:grid-cols-[1fr_120px_120px_160px]"
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

function getDashboardManuscripts() {
  return prisma.manuscript.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });
}

function DatabaseErrorPanel({ message }: { message: string }) {
  return (
    <section className="border border-danger bg-white p-4 shadow-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">
        Manuslistan kunde inte visas
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">
        Du kan försöka igen om en stund. Själva uppladdningsytan är fortfarande
        tillgänglig.
      </p>
      <details className="detail-toggle mt-3">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink hover:text-accent">
          Visa detaljer
        </summary>
        <p className="break-words border-t border-line p-3 text-xs text-slate-600">
          {message}
        </p>
      </details>
    </section>
  );
}

function StepItem({ index, text }: { index: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-xs font-semibold text-accent">
        {index}
      </span>
      <span className="pt-1.5 text-sm font-semibold text-ink">{text}</span>
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
  const labels: Record<string, string> = {
    COMPLETED: "Klar",
    FAILED: "Behöver ses över",
    NOT_STARTED: "Ej startad",
    RUNNING: "Pågår"
  };

  return labels[status] ?? "Okänd";
}
