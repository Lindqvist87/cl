import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { StructureReviewPanel } from "@/components/StructureReviewPanel";
import { buildAuthorWorkspaceViewModel } from "@/lib/editorial/authorWorkspace";
import { aggregateEditorialWorkspaceData } from "@/lib/editorial/workspaceData";
import { getWorkspaceReadinessForManuscript } from "@/lib/pipeline/workspaceReadiness";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ManuscriptWorkspacePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { order: "asc" } },
      findings: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] },
      decisions: { orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] },
      reports: { orderBy: { createdAt: "desc" }, take: 1 },
      rewritePlans: { orderBy: { createdAt: "desc" }, take: 1 },
      rewrites: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!manuscript) {
    notFound();
  }

  const workspace = aggregateEditorialWorkspaceData({
    manuscript: {
      id: manuscript.id,
      title: manuscript.title,
      status: manuscript.status,
      analysisStatus: manuscript.analysisStatus,
      wordCount: manuscript.wordCount,
      chapterCount: manuscript.chapterCount
    },
    chapters: manuscript.chapters,
    findings: manuscript.findings,
    decisions: manuscript.decisions,
    rewrites: manuscript.rewrites,
    rewritePlans: manuscript.rewritePlans,
    globalSummary: manuscript.reports[0]?.executiveSummary ?? null
  });
  const authorWorkspace = buildAuthorWorkspaceViewModel(workspace);
  const pipelineReadiness = await getWorkspaceReadinessForManuscript(id);
  const rewriteDraftCount = new Set(
    manuscript.rewrites
      .filter((rewrite) => ["DRAFT", "ACCEPTED"].includes(rewrite.status))
      .map((rewrite) => rewrite.chapterId)
  ).size;
  const rewriteDraftsComplete = rewriteDraftCount >= manuscript.chapterCount;

  return (
    <main className="-mx-4 -my-6 min-h-screen bg-[#fdfcf8] px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-12">
        <header className="space-y-10 pt-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <Link
              href={`/manuscripts/${id}`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-accent hover:underline"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Till manus
            </Link>

            <WorkspaceNav manuscriptId={id} />
          </div>

          <section className="mx-auto max-w-4xl space-y-5 py-4 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-white px-4 py-2 text-sm font-semibold text-accent shadow-panel">
              <CheckCircle2 size={16} aria-hidden="true" />
              {authorWorkspace.hero.statusLabel}
            </div>
            <h1 className="text-4xl font-semibold tracking-normal text-ink sm:text-5xl">
              {workspace.manuscript.title}
            </h1>
            <p className="mx-auto line-clamp-4 max-w-3xl text-lg leading-8 text-slate-700">
              {authorWorkspace.hero.body}
            </p>
          </section>
        </header>

        <section className="mx-auto max-w-4xl">
          <StartHereCard manuscriptId={id} start={authorWorkspace.start} />
        </section>

        <section className="mx-auto max-w-5xl space-y-5">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-normal text-ink">
              {authorWorkspace.prioritySectionTitle}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              När du har börjat med huvudrekommendationen kan du gå vidare till
              nästa redigeringskort i ordning.
            </p>
          </div>

          {authorWorkspace.priorityCards.length === 0 ? (
            <section className="rounded-lg border border-[#ebe7dc] bg-white p-7 shadow-[0_10px_30px_rgba(24,33,47,0.05)]">
              <h3 className="text-lg font-semibold">Inga öppna prioriteringar ännu</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                När analysen har hittat återkommande mönster visas de här som
                lugna redigeringskort.
              </p>
            </section>
          ) : (
            <div className="grid gap-5 lg:grid-cols-3">
              {authorWorkspace.priorityCards.map((priority) => (
                <PriorityCard
                  key={priority.id}
                  manuscriptId={id}
                  priority={priority}
                />
              ))}
            </div>
          )}
        </section>

        <section id="detaljer" className="mx-auto max-w-5xl space-y-4 pb-10">
          <div className="text-center">
            <h2 className="text-xl font-semibold tracking-normal text-ink">
              {authorWorkspace.details.summaryLabel}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Underlaget finns kvar här när du vill granska mer.
            </p>
          </div>

          <div className="space-y-3">
            <DetailsSection title={authorWorkspace.details.allObservationsLabel}>
              <RawObservationPanel
                keyIssues={workspace.keyIssues}
                issueGroups={workspace.issueGroups}
              />
            </DetailsSection>

            <DetailsSection title={authorWorkspace.details.sectionsLabel}>
              <StructureReviewPanel
                rows={workspace.structureRows}
                title="Manusets delar"
                description="Öppna en del för att se den i arbetsytan."
                sectionColumnLabel="Manusdel"
                wordColumnLabel="Ord"
                issueColumnLabel="Obs."
                typeColumnLabel="Typ"
                emptyLabel="Inga manusdelar finns importerade ännu."
                getHref={(row) => `/manuscripts/${id}/chapters/${row.id}/workspace`}
              />
            </DetailsSection>

            <DetailsSection title={authorWorkspace.details.rewritePlanLabel}>
              <RewritePlanPanel items={workspace.rewritePlanItems} />
            </DetailsSection>

            <DetailsSection title={authorWorkspace.details.importedStructureLabel}>
              <ImportedStructurePanel manuscriptId={id} />
            </DetailsSection>

            <DetailsSection title={authorWorkspace.details.rawDataLabel}>
              <ReadinessPanel
                readiness={workspace.readiness}
                pipeline={pipelineReadiness}
                rewriteDraftsComplete={rewriteDraftsComplete}
                globalSummary={workspace.globalSummary}
              />
            </DetailsSection>
          </div>
        </section>
      </div>
    </main>
  );
}

function WorkspaceNav({ manuscriptId }: { manuscriptId: string }) {
  return (
    <nav
      aria-label="Manusnavigering"
      className="flex flex-wrap gap-1 rounded-lg border border-[#ebe7dc] bg-white p-1 shadow-panel"
    >
      <span className="inline-flex min-h-9 items-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">
        Arbetsyta
      </span>
      <NavLink href={`/manuscripts/${manuscriptId}/audit`}>Rapport</NavLink>
      <NavLink href={`/manuscripts/${manuscriptId}/structure`}>Struktur</NavLink>
      <NavLink href="#detaljer">Detaljer</NavLink>
    </nav>
  );
}

function StartHereCard({
  manuscriptId,
  start
}: {
  manuscriptId: string;
  start: {
    heading: string;
    title: string;
    explanation: string;
    whyItMatters: string;
    firstConcreteStep: string;
    affectedPartsPreview: string;
    targetSectionId: string | null;
    primaryEnabled: boolean;
    primaryButtonLabel: string;
  };
}) {
  return (
    <section className="rounded-lg border border-accent/20 bg-white p-7 shadow-[0_24px_70px_rgba(24,33,47,0.12)] ring-1 ring-accent/10 sm:p-9">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">
        {start.heading}
      </p>
      <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
        {start.title}
      </h2>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">
        {start.explanation}
      </p>

      <div className="mt-8 grid gap-6 border-t border-[#ebe7dc] pt-6 md:grid-cols-3">
        <EditorialFact label="Varför det spelar roll" value={start.whyItMatters} />
        <EditorialFact label="Första steg" value={start.firstConcreteStep} />
        <EditorialFact label="Berörda delar" value={start.affectedPartsPreview} />
      </div>

      <div className="mt-8">
        {start.primaryEnabled && start.targetSectionId ? (
          <Link
            href={`/manuscripts/${manuscriptId}/chapters/${start.targetSectionId}/workspace`}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(31,122,109,0.22)]"
          >
            {start.primaryButtonLabel}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#ebe7dc] bg-[#f7f5ef] px-5 py-2 text-sm font-semibold text-slate-400"
          >
            {start.primaryButtonLabel}
          </span>
        )}
      </div>
    </section>
  );
}

function PriorityCard({
  manuscriptId,
  priority
}: {
  manuscriptId: string;
  priority: {
    title: string;
    importanceLabel: string;
    whyItMatters: string;
    recommendedAction: string;
    targetSectionId: string | null;
  };
}) {
  return (
    <article className="flex min-h-[310px] flex-col rounded-lg border border-[#ebe7dc] bg-white p-6 shadow-[0_10px_30px_rgba(24,33,47,0.05)]">
      <ImportanceBadge label={priority.importanceLabel} />
      <h3 className="mt-4 text-xl font-semibold tracking-normal text-ink">
        {priority.title}
      </h3>
      <div className="mt-5 space-y-4">
        <EditorialFact label="Varför det spelar roll" value={priority.whyItMatters} />
        <EditorialFact label="Gör nu" value={priority.recommendedAction} />
      </div>
      <div className="mt-auto pt-6">
        {priority.targetSectionId ? (
          <Link
            href={`/manuscripts/${manuscriptId}/chapters/${priority.targetSectionId}/workspace`}
            className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#d9d4c8] bg-white px-3 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          >
            Visa i texten
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#ebe7dc] bg-[#f7f5ef] px-3 py-2 text-sm font-semibold text-slate-400"
          >
            Visa i texten
          </span>
        )}
      </div>
    </article>
  );
}

function DetailsSection({
  children,
  title
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details className="rounded-lg border border-[#ebe7dc] bg-white shadow-panel">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-ink hover:text-accent">
        {title}
      </summary>
      <div className="border-t border-[#ebe7dc] p-4">{children}</div>
    </details>
  );
}

function RawObservationPanel({
  keyIssues,
  issueGroups
}: {
  keyIssues: Array<{
    id: string;
    chapterLabel: string;
    severity: number;
    issueType: string;
    problem: string;
    recommendation: string;
    decisionStatus: string | null;
  }>;
  issueGroups: Array<{
    issueType: string;
    count: number;
    maxSeverity: number;
    topIssues: Array<{
      id: string;
      chapterLabel: string;
      severity: number;
      issueType: string;
      problem: string;
      recommendation: string;
      decisionStatus: string | null;
    }>;
  }>;
}) {
  return (
    <section className="space-y-5">
      {keyIssues.length === 0 && issueGroups.length === 0 ? (
        <p className="text-sm text-slate-500">
          Inga öppna observationer finns att visa ännu.
        </p>
      ) : (
        <>
          {keyIssues.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Observationer med högst vikt</h3>
              <div className="mt-3 divide-y divide-line border-y border-line">
                {keyIssues.map((issue) => (
                  <IssueSummary key={issue.id} issue={issue} />
                ))}
              </div>
            </div>
          ) : null}

          {issueGroups.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Grupperade observationer</h3>
              <div className="mt-3 space-y-3">
                {issueGroups.map((group) => (
                  <section key={group.issueType} className="border border-line bg-paper p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{group.issueType}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>{group.count} observationer</span>
                        <SeverityBadge severity={group.maxSeverity} />
                      </div>
                    </div>
                    <div className="mt-2 divide-y divide-line">
                      {group.topIssues.slice(0, 3).map((issue) => (
                        <IssueSummary key={issue.id} issue={issue} compact />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function RewritePlanPanel({
  items
}: {
  items: Array<{
    key: string;
    title: string;
    priority: string | null;
    plan: string;
  }>;
}) {
  return (
    <section className="divide-y divide-line border-y border-line">
      {items.length === 0 ? (
        <p className="py-5 text-sm text-slate-500">
          Ingen redigeringsplan finns sparad ännu.
        </p>
      ) : (
        items.map((item) => (
          <div key={item.key} className="py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{item.title}</span>
              {item.priority ? (
                <span className="border border-line bg-paper px-2 py-1 text-xs text-slate-600">
                  Prio {item.priority}
                </span>
              ) : null}
            </div>
            {item.plan ? (
              <p className="mt-2 text-sm leading-6 text-slate-700">{item.plan}</p>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

function ImportedStructurePanel({ manuscriptId }: { manuscriptId: string }) {
  return (
    <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-semibold">Importerad struktur</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Öppna strukturvyn om du vill kontrollera hur manuset delades upp vid import.
        </p>
      </div>
      <Link
        href={`/manuscripts/${manuscriptId}/structure`}
        className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#d9d4c8] bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
      >
        Öppna strukturvyn
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}

function ReadinessPanel({
  readiness,
  pipeline,
  rewriteDraftsComplete,
  globalSummary
}: {
  readiness: {
    sectionsDetected: number;
    issuesFound: number;
    globalSummaryAvailable: boolean;
    rewritePlanAvailable: boolean;
    decisionsStored: boolean;
    analysisStatus: string;
  };
  pipeline: {
    state: string;
    workspaceReady: boolean;
    usableWholeBookOutput: boolean;
    actionableError: string | null;
    coreAnalysisComplete: boolean;
    optionalRewriteDraftsPending: boolean;
  };
  rewriteDraftsComplete: boolean;
  globalSummary: string | null;
}) {
  return (
    <section className="space-y-4">
      {globalSummary ? (
        <div>
          <h3 className="text-sm font-semibold">Sparad helhetsbedömning</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700">{globalSummary}</p>
        </div>
      ) : null}
      <div className="divide-y divide-line border-y border-line text-sm">
        <ReadinessRow label="Manusets delar" value={String(readiness.sectionsDetected)} />
        <ReadinessRow label="Observationer" value={String(readiness.issuesFound)} />
        <ReadinessRow
          label="Helhetsbedömning"
          value={readiness.globalSummaryAvailable ? "Finns" : "Saknas"}
        />
        <ReadinessRow
          label="Redigeringsplan"
          value={readiness.rewritePlanAvailable ? "Finns" : "Saknas"}
        />
        <ReadinessRow
          label="Sparade beslut"
          value={readiness.decisionsStored ? "Finns" : "Inga ännu"}
        />
        <ReadinessRow label="Analysstatus" value={formatStatus(readiness.analysisStatus)} />
        <ReadinessRow label="Bearbetningsläge" value={formatStatus(pipeline.state)} />
        <ReadinessRow
          label="Helmanusunderlag"
          value={pipeline.usableWholeBookOutput ? "Finns" : "Saknas"}
        />
        <ReadinessRow
          label="Arbetsyta"
          value={pipeline.workspaceReady ? "Klar" : "Inte klar"}
        />
        <ReadinessRow
          label="Utkast"
          value={rewriteDraftsComplete ? "Skapade" : "Väntar"}
        />
      </div>
      {pipeline.actionableError ? (
        <p className="text-sm text-danger">{pipeline.actionableError}</p>
      ) : null}
    </section>
  );
}

function IssueSummary({
  issue,
  compact = false
}: {
  issue: {
    chapterLabel: string;
    severity: number;
    issueType: string;
    problem: string;
    recommendation: string;
    decisionStatus: string | null;
  };
  compact?: boolean;
}) {
  return (
    <div className={compact ? "py-3" : "py-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={issue.severity} />
        <span className="text-sm font-semibold">{issue.issueType}</span>
        <span className="text-xs text-slate-500">{authorSectionLabel(issue.chapterLabel)}</span>
        {issue.decisionStatus ? (
          <span className="text-xs text-slate-500">
            {formatStatus(issue.decisionStatus)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-slate-700">{issue.problem}</p>
      {!compact ? (
        <p className="mt-1 text-sm text-slate-600">{issue.recommendation}</p>
      ) : null}
    </div>
  );
}

function EditorialFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}

function ImportanceBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-7 w-fit items-center rounded-full border border-accent/20 bg-[#f2faf6] px-3 text-xs font-semibold text-accent">
      {label}
    </span>
  );
}

function NavLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-9 items-center rounded-md px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-paper hover:text-ink"
    >
      {children}
    </Link>
  );
}

function ReadinessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: number }) {
  return (
    <span className="inline-flex min-h-7 items-center border border-line bg-white px-2 text-xs font-semibold text-slate-600">
      S{severity}
    </span>
  );
}

function authorSectionLabel(label: string) {
  return label
    .replace(/^Section\s+(\d+):/i, "Del $1:")
    .replace(/^Manuscript level$/i, "Hela manuset")
    .replace(/^Unlinked section$/i, "Ej kopplad del");
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}
