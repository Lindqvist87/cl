import Link from "next/link";
import { ArrowRight, BookOpen, FileText, PenLine } from "lucide-react";
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
    dbError = error instanceof Error ? error.message : "Database is unavailable.";
  }

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.75fr)] lg:items-start">
        <div className="paper-card flex min-h-[420px] flex-col justify-between p-8 sm:p-10">
          <div>
            <p className="page-kicker">Paperlight Rose workspace</p>
            <h1 className="page-title mt-4 max-w-3xl">
              Editorial intelligence for a full manuscript.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-700">
              {copy.dashboard.intro}
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <ProductStep
              label="1"
              title="Import"
              body="Bring in the full manuscript with author, genre, and audience context."
            />
            <ProductStep
              label="2"
              title="Analyze"
              body="Move through structure review and guided editorial analysis."
            />
            <ProductStep
              label="3"
              title="Revise"
              body="Start from the recommended next step and work section by section."
            />
          </div>
        </div>

        <UploadForm />
      </section>

      {dbError ? <DatabaseErrorPanel message={dbError} /> : null}

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="page-kicker">Library</p>
            <h2 className="section-title mt-2">{copy.dashboard.sectionTitle}</h2>
          </div>
          <p className="text-sm text-muted">
            Pick up the next editorial step for each manuscript.
          </p>
        </div>
        {manuscripts.length === 0 ? (
          <EmptyLibrary />
        ) : (
          <div className="grid gap-4">
            {manuscripts.map((manuscript) => (
              <article
                key={manuscript.id}
                className="paper-card grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <FileText size={20} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/manuscripts/${manuscript.id}`}
                        className="text-lg font-semibold tracking-normal text-ink hover:text-accent"
                      >
                        {manuscript.title}
                      </Link>
                      <StatusBadge status={manuscript.analysisStatus} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted">
                      {manuscript.sourceFileName}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <MetricPill
                        label={copy.dashboard.metrics.words}
                        value={manuscript.wordCount.toLocaleString()}
                      />
                      <MetricPill
                        label={copy.dashboard.metrics.chapters}
                        value={String(manuscript.chapterCount)}
                      />
                    </div>
                  </div>
                </div>
                <DashboardAction manuscript={manuscript} />
              </article>
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

type DashboardManuscript = Awaited<ReturnType<typeof getDashboardManuscripts>>[number];

function DatabaseErrorPanel({ message }: { message: string }) {
  return (
    <section className="paper-card border-danger/20 p-5">
      <p className="page-kicker text-danger">Library unavailable</p>
      <h2 className="mt-2 text-lg font-semibold tracking-normal text-ink">
        Manuscripts cannot be loaded right now.
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">
        The workspace is available, but the manuscript library could not be opened.
        An admin can check the environment and retry the page.
      </p>
      <details className="detail-toggle mt-4">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink hover:text-accent">
          Technical details
        </summary>
        <p className="break-words border-t border-line p-4 text-xs leading-5 text-slate-600">
          {message}
        </p>
      </details>
    </section>
  );
}

function ProductStep({
  body,
  label,
  title
}: {
  body: string;
  label: string;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-alt p-4">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-accent">
        {label}
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted">{body}</p>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <section className="paper-card flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <PenLine size={22} aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{copy.dashboard.emptyState}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">
        Upload your first manuscript above to create the editorial workspace.
      </p>
    </section>
  );
}

function DashboardAction({ manuscript }: { manuscript: DashboardManuscript }) {
  const action = dashboardActionFor(manuscript);

  return (
    <Link
      href={action.href}
      className={action.primary ? "primary-button md:min-w-40" : "secondary-button md:min-w-40"}
    >
      {action.icon === "book" ? (
        <BookOpen size={16} aria-hidden="true" />
      ) : (
        <ArrowRight size={16} aria-hidden="true" />
      )}
      {action.label}
    </Link>
  );
}

function dashboardActionFor(manuscript: DashboardManuscript) {
  if (manuscript.analysisStatus === "COMPLETED") {
    return {
      href: `/manuscripts/${manuscript.id}/workspace`,
      icon: "arrow",
      label: "Open workspace",
      primary: true
    };
  }

  if (manuscript.analysisStatus === "RUNNING") {
    return {
      href: `/manuscripts/${manuscript.id}`,
      icon: "arrow",
      label: "View analysis",
      primary: true
    };
  }

  if (manuscript.analysisStatus === "FAILED") {
    return {
      href: `/manuscripts/${manuscript.id}`,
      icon: "arrow",
      label: "Continue",
      primary: true
    };
  }

  return {
    href: `/manuscripts/${manuscript.id}/structure`,
    icon: "book",
    label: "Review structure",
    primary: false
  };
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-alt px-3 py-1 text-xs text-muted">
      <span>{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "COMPLETED"
      ? "border-success/20 bg-success/5 text-success"
      : status === "RUNNING"
        ? "border-accent/25 bg-accent/10 text-accent"
        : status === "FAILED"
          ? "border-danger/20 bg-danger/5 text-danger"
          : "border-line bg-white text-muted";

  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-semibold ${className}`}>
      {formatStatus(status)}
    </span>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
