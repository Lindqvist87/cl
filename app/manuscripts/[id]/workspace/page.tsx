import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileText,
  Sparkles
} from "lucide-react";
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
    <main className="-mx-4 -my-6 bg-[#fbfaf6] px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="space-y-5">
          <Link
            href={`/manuscripts/${id}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Till manus
          </Link>

          <section className="rounded-lg border border-line bg-white px-5 py-6 shadow-panel sm:px-7 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold text-accent">Redigeringsöversikt</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
                  {authorWorkspace.hero.title}
                </h1>
                <p className="mt-3 text-lg font-semibold text-ink">
                  {workspace.manuscript.title}
                </p>
                <p className="mt-4 max-w-3xl text-base leading-7 text-slate-700">
                  {authorWorkspace.hero.body}
                </p>
              </div>
              <nav className="flex flex-wrap gap-2 lg:justify-end" aria-label="Sekundära länkar">
                <SecondaryLink href={`/manuscripts/${id}/audit`} icon={<FileText size={16} />}>
                  Granska rapport
                </SecondaryLink>
                <SecondaryLink href={`/manuscripts/${id}/structure`} icon={<BookOpen size={16} />}>
                  Manusets delar
                </SecondaryLink>
                <SecondaryLink href="#alla-observationer">
                  Alla observationer
                </SecondaryLink>
              </nav>
            </div>
          </section>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <StartHereCard
            manuscriptId={id}
            start={authorWorkspace.start}
          />

          <WorkflowCard steps={authorWorkspace.workflowSteps} />
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-accent">Prioriteringar</p>
              <h2 className="text-2xl font-semibold tracking-normal text-ink">
                {authorWorkspace.prioritySectionTitle}
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Börja med korten i ordning. De samlar flera observationer till större
              redigeringsgrepp, så du slipper jaga rad-för-rad innan riktningen är satt.
            </p>
          </div>

          {authorWorkspace.priorityCards.length === 0 ? (
            <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
              <h3 className="text-lg font-semibold">Inga öppna prioriteringar ännu</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                När analysen har hittat återkommande mönster visas de här som
                redigeringskort. Tills dess kan du kontrollera manusets delar eller
                öppna alla observationer under detaljerna.
              </p>
            </section>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
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

        <details
          id="alla-observationer"
          className="rounded-lg border border-line bg-white shadow-panel"
        >
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-accent hover:underline">
            {authorWorkspace.details.summaryLabel} och alla observationer
          </summary>
          <div className="space-y-6 border-t border-line px-5 py-5">
            <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <ReadinessPanel
                readiness={workspace.readiness}
                pipeline={pipelineReadiness}
                rewriteDraftsComplete={rewriteDraftsComplete}
              />

              <RewritePlanPanel items={workspace.rewritePlanItems} />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <RawObservationPanel
                keyIssues={workspace.keyIssues}
                issueGroups={workspace.issueGroups}
              />

              <StructureReviewPanel
                rows={workspace.structureRows}
                title={authorWorkspace.details.structureLabel}
                description="Här kan du öppna varje importerad del och kontrollera hur manuset delades upp."
                sectionColumnLabel="Manusdel"
                wordColumnLabel="Ord"
                issueColumnLabel="Obs."
                typeColumnLabel="Typ"
                emptyLabel="Inga manusdelar finns importerade ännu."
                getHref={(row) => `/manuscripts/${id}/chapters/${row.id}/workspace`}
              />
            </section>
          </div>
        </details>
      </div>
    </main>
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
    whyThisComesFirst: string;
    affectedParts: string[];
    firstConcreteStep: string;
    whatToIgnoreForNow: string;
    targetSectionId: string | null;
    primaryEnabled: boolean;
  };
}) {
  return (
    <section className="rounded-lg border border-accent/30 bg-white p-5 shadow-panel sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles size={18} aria-hidden="true" className="text-accent" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">
          {start.heading}
        </h2>
      </div>
      <h3 className="mt-4 text-2xl font-semibold tracking-normal text-ink">
        {start.title}
      </h3>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <EditorialFact label="Varför detta kommer först" value={start.whyThisComesFirst} />
        <EditorialFact label="Berörda delar" value={start.affectedParts.join(", ")} />
        <EditorialFact label="Första konkreta steg" value={start.firstConcreteStep} />
        <EditorialFact label="Vänta med" value={start.whatToIgnoreForNow} />
      </div>
      <div className="mt-6">
        {start.primaryEnabled && start.targetSectionId ? (
          <Link
            href={`/manuscripts/${manuscriptId}/chapters/${start.targetSectionId}/workspace`}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white shadow-panel"
          >
            Börja arbeta
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-paper px-5 py-2 text-sm font-semibold text-slate-400"
          >
            Börja arbeta
          </span>
        )}
      </div>
    </section>
  );
}

function WorkflowCard({ steps }: { steps: string[] }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-panel sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        Arbetsgång
      </h2>
      <ol className="mt-4 space-y-4">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-sm font-semibold text-accent">
              {index + 1}
            </span>
            <span className="pt-1 text-sm leading-6 text-slate-700">{step}</span>
          </li>
        ))}
      </ol>
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
    affectedParts: string[];
    whyItMatters: string;
    recommendedAction: string;
    targetSectionId: string | null;
  };
}) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <ImportanceBadge label={priority.importanceLabel} />
          <h3 className="mt-3 text-xl font-semibold tracking-normal text-ink">
            {priority.title}
          </h3>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        <EditorialFact label="Berörda delar" value={priority.affectedParts.join(", ")} />
        <EditorialFact label="Varför det spelar roll" value={priority.whyItMatters} />
        <EditorialFact label="Rekommenderad åtgärd" value={priority.recommendedAction} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {priority.targetSectionId ? (
          <Link
            href={`/manuscripts/${manuscriptId}/chapters/${priority.targetSectionId}/workspace`}
            className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          >
            Visa i texten
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <DisabledAction label="Visa i texten" />
        )}
        <DisabledAction label="Spara till senare" />
        <DisabledAction label="Markera som löst" />
        <DisabledAction label="Få förslag" />
      </div>
    </article>
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
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Alla observationer
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Rå observationer finns kvar här för granskning och spårbarhet.
        </p>
      </div>
      {keyIssues.length === 0 && issueGroups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          Inga öppna observationer finns att visa ännu.
        </p>
      ) : (
        <div className="space-y-5 px-4 py-4">
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
        </div>
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
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Redigeringsplan
        </h2>
      </div>
      <div className="divide-y divide-line">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Ingen redigeringsplan finns sparad ännu.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.key} className="px-4 py-4">
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
      </div>
    </section>
  );
}

function ReadinessPanel({
  readiness,
  pipeline,
  rewriteDraftsComplete
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
}) {
  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        Analysen är redo
      </h2>
      <div className="mt-3 divide-y divide-line border-y border-line text-sm">
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
        <p className="mt-3 text-sm text-danger">{pipeline.actionableError}</p>
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
    <span className="inline-flex min-h-7 items-center rounded-full border border-accent/30 bg-[#edf7f2] px-3 text-xs font-semibold text-accent">
      {label}
    </span>
  );
}

function DisabledAction({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex min-h-9 cursor-not-allowed items-center justify-center rounded-md border border-line bg-paper px-3 py-2 text-sm font-semibold text-slate-400"
    >
      {label}
    </button>
  );
}

function SecondaryLink({
  children,
  href,
  icon
}: {
  children: ReactNode;
  href: string;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
    >
      {icon}
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
