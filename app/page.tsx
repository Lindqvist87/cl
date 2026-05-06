import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Eye, FileText, ShieldCheck, Sparkles } from "lucide-react";
import copy from "@/content/app-copy.json";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "@/components/UploadForm";
import { isDocOnlyManuscript } from "@/lib/manuscripts/docOnly";

export const dynamic = "force-dynamic";

type DashboardManuscript = Awaited<
  ReturnType<typeof getDashboardManuscripts>
>[number];

export default async function DashboardPage() {
  let dbError: string | null = null;
  let manuscripts: DashboardManuscript[] = [];

  try {
    manuscripts = await getDashboardManuscripts();
  } catch (error) {
    dbError =
      error instanceof Error
        ? error.message
        : "Manuslistan är inte tillgänglig.";
  }

  return (
    <div className="relative isolate -mx-5 -my-8 overflow-hidden px-5 pb-12 pt-8 sm:pb-16 sm:pt-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          backgroundImage:
            "linear-gradient(180deg, #FAFAF7 0%, #FAFAF8 58%, #FFFFFF 100%)"
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-80"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(255,255,255,0.76), transparent 78%)"
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.28]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(231,226,218,0.22) 0px, rgba(231,226,218,0.22) 1px, transparent 1px, transparent 24px)"
        }}
      />

      <section
        id="nytt-manus"
        className="relative isolate overflow-hidden py-5 sm:py-8"
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-accent/90">
              Starta med dokumentet
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-normal text-ink sm:text-5xl">
              Ladda upp ditt dokument
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-700 sm:text-lg">
              Vi börjar om från en ren doc-väg: dokumentet laddas upp, sparas
              och visas direkt på sidan.
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
                title="Du laddar upp DOCX"
              />
              <ManuscriptStep
                icon={ShieldCheck}
                label="2"
                title="Vi sparar dokumentet"
              />
              <ManuscriptStep
                icon={Eye}
                label="3"
                title="Du ser dokumentet"
              />
            </div>
          </aside>
        </div>
      </section>

      {dbError ? <DatabaseErrorPanel message={dbError} /> : null}

      <section id="manus" className="border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-normal text-ink">
              {copy.dashboard.sectionTitle}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Dina uppladdade dokument samlade på ett ställe.
            </p>
          </div>
          <Link href="/#nytt-manus" className="secondary-button min-h-9 px-3">
            Nytt manus
          </Link>
        </div>
        {manuscripts.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            {copy.dashboard.emptyState}
          </div>
        ) : (
          <div className="grid gap-3 p-4">
            {manuscripts.map((manuscript) => (
              <ManuscriptProjectCard
                key={manuscript.id}
                manuscript={manuscript}
              />
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
      <span>Du behåller alltid kontrollen. Appen föreslår - du bestämmer.</span>
    </p>
  );
}

function ManuscriptProjectCard({
  manuscript
}: {
  manuscript: DashboardManuscript;
}) {
  const docOnly = isDocOnlyManuscript(manuscript);

  return (
    <article className="grid gap-4 rounded-lg border border-line bg-white p-4 shadow-[0_12px_28px_rgba(23,23,23,0.045)] transition hover:border-accent/20 hover:shadow-panel lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="flex min-w-0 gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-alt text-muted">
          <FileText size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold tracking-normal text-ink">
            {manuscript.title}
          </h3>
          <p className="mt-1 truncate text-sm text-muted">
            {manuscript.sourceFileName}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ProjectMeta
              label={copy.dashboard.metrics.words}
              value={manuscript.wordCount.toLocaleString()}
            />
            <StatusBadge
              status={docOnly ? "UPLOADED" : manuscript.analysisStatus}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
        <Link
          href={
            docOnly
              ? `/manuscripts/${manuscript.id}`
              : `/manuscripts/${manuscript.id}/workspace`
          }
          className="primary-button min-h-10 px-4"
        >
          {docOnly ? "Visa dokument" : "Öppna arbetsyta"}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        {!docOnly ? (
          <Link
            href={`/manuscripts/${manuscript.id}`}
            className="secondary-button min-h-10 px-4"
          >
            Översikt
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function ProjectMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper-alt px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "COMPLETED"
      ? "border-success/20 bg-green-50 text-success"
      : status === "RUNNING"
        ? "border-accent/20 bg-accent/10 text-accent"
        : status === "FAILED"
          ? "border-danger/20 bg-red-50 text-danger"
          : status === "UPLOADED"
            ? "border-success/20 bg-green-50 text-success"
          : "border-line bg-paper-alt text-slate-600";

  return (
    <span
      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${tone}`}
    >
      {formatStatus(status)}
    </span>
  );
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    COMPLETED: "Analysen är klar",
    FAILED: "Behöver ses över",
    NOT_STARTED: "Utkast skapat",
    RUNNING: "Analysen pågår",
    UPLOADED: "Dokument uppladdat"
  };

  return labels[status] ?? "Behöver ses över";
}
