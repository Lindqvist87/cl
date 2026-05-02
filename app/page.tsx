import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, FileText, Map, ShieldCheck, Sparkles } from "lucide-react";
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
    <div className="relative isolate -mx-5 -my-8 overflow-hidden px-5 pb-12 pt-8 sm:pb-16 sm:pt-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          backgroundImage:
            "linear-gradient(135deg, #FAFAF7 0%, rgba(255,248,251,0.94) 42%, #FAFAF8 76%, #FFFFFF 100%)"
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] opacity-90"
        style={{
          backgroundImage:
            "radial-gradient(58% 54% at 46% 20%, rgba(232,93,158,0.12), transparent 70%), radial-gradient(34% 32% at 9% 72%, rgba(232,93,158,0.07), transparent 72%), linear-gradient(180deg, rgba(255,255,255,0.46), transparent 74%)"
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.32]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(231,226,218,0.24) 0px, rgba(231,226,218,0.24) 1px, transparent 1px, transparent 22px)"
        }}
      />

      <section className="relative isolate overflow-hidden py-5 sm:py-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-accent/90">
              Starta nytt manus
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-normal text-ink sm:text-5xl">
              Ladda upp ditt manus
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-700 sm:text-lg">
              Få en redaktionell översikt, prioriterade förbättringsområden och
              ett tydligt första steg.
            </p>

            <div className="mt-8">
              <UploadForm />
            </div>

            <TrustNote />
          </div>

          <aside className="paper-card relative overflow-hidden border-white/75 bg-white/90 p-6 shadow-[0_18px_44px_rgba(23,23,23,0.055)] ring-1 ring-line/70 lg:mt-28">
            <div
              aria-hidden="true"
              className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent"
            />
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/10 bg-accent/10 text-accent shadow-[0_10px_24px_rgba(232,93,158,0.09)]">
              <Sparkles size={19} aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-xl font-semibold tracking-normal text-ink">
              Så fungerar det
            </h2>
            <div className="relative mt-6 grid gap-5">
              <div
                aria-hidden="true"
                className="absolute bottom-5 left-[17px] top-5 w-px bg-gradient-to-b from-accent/20 via-line to-transparent"
              />
              <ManuscriptStep
                icon={FileText}
                label="1"
                title="Vi läser in manuset"
              />
              <ManuscriptStep
                icon={Map}
                label="2"
                title="Vi skapar en redaktionell karta"
              />
              <ManuscriptStep
                icon={ArrowRight}
                label="3"
                title="Du får veta var du bör börja"
              />
            </div>
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

function ManuscriptStep({
  icon: Icon,
  label,
  title
}: {
  icon: LucideIcon;
  label: string;
  title: string;
}) {
  return (
    <div className="relative flex gap-4">
      <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-white text-accent shadow-[0_8px_18px_rgba(23,23,23,0.045)]">
        <Icon size={15} aria-hidden="true" />
        <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-accent text-[10px] font-semibold text-white shadow-[0_6px_14px_rgba(232,93,158,0.22)]">
          {label}
        </span>
      </div>
      <div className="pt-1.5">
        <h3 className="text-sm font-semibold tracking-normal text-ink">
          {title}
        </h3>
      </div>
    </div>
  );
}

function TrustNote() {
  return (
    <p className="mt-5 flex max-w-2xl items-start gap-3 text-sm leading-6 text-muted">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/15 bg-white text-accent shadow-[0_8px_18px_rgba(232,93,158,0.08)]">
        <ShieldCheck size={14} aria-hidden="true" />
      </span>
      <span>Du behåller alltid kontrollen. Appen föreslår – du bestämmer.</span>
    </p>
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
