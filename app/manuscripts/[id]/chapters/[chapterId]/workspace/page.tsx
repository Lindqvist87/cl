import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisPassType } from "@prisma/client";
import { ArrowLeft, GitBranch, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { EditorialDecisionControls } from "@/components/EditorialDecisionControls";
import { prisma } from "@/lib/prisma";
import { latestDecisionByFinding } from "@/lib/editorial/decisions";
import type { JsonRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChapterWorkspacePage({
  params
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  const chapter = await prisma.manuscriptChapter.findFirst({
    where: { id: chapterId, manuscriptId: id },
    include: {
      manuscript: true,
      findings: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] }
    }
  });

  if (!chapter) {
    notFound();
  }

  const [chapterAudit, globalFindings, decisions, latestRewritePlan] = await Promise.all([
    prisma.analysisOutput.findFirst({
      where: {
        manuscriptId: id,
        chapterId,
        passType: AnalysisPassType.CHAPTER_AUDIT
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.finding.findMany({
      where: {
        manuscriptId: id,
        chapterId: null
      },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }]
    }),
    prisma.editorialDecision.findMany({
      where: { manuscriptId: id },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.rewritePlan.findFirst({
      where: { manuscriptId: id },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const audit = toRecord(chapterAudit?.output);
  const decisionByFinding = latestDecisionByFinding(decisions);
  const planItem = chapterPlanForChapter(latestRewritePlan?.chapterPlans, chapter);
  const rewriteInstructions = arrayOfStrings(audit.rewriteInstructions);
  const proposedActions = [
    ...chapter.findings.slice(0, 6).map((finding) => ({
      key: finding.id,
      title: finding.problem,
      detail: finding.recommendation
    })),
    ...rewriteInstructions.slice(0, 4).map((instruction, index) => ({
      key: `instruction-${index}`,
      title: "Redigeringsinstruktion",
      detail: instruction
    })),
    ...(planItem?.plan
      ? [
          {
            key: "rewrite-plan",
            title: "Redigeringsplan",
            detail: String(planItem.plan)
          }
        ]
      : [])
  ];
  const affectedChapters = planItem ? affectedChaptersForPlan(planItem) : [];
  const continuityNotes = arrayOfStrings(latestRewritePlan?.continuityRules);
  const relatedUnresolvedFindings = [...chapter.findings, ...globalFindings].filter((finding) => {
    const decision = decisionByFinding.get(finding.id);
    return !decision || decision.status === "NEEDS_REVIEW";
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border border-line bg-white p-4 shadow-panel sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href={`/manuscripts/${id}/workspace`}
            className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Till arbetsyta
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            Manusdel {chapter.order}: {chapter.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {chapter.manuscript.title} | {chapter.wordCount.toLocaleString()} ord |{" "}
            {formatStatus(chapter.status)}
          </p>
        </div>
        <EditorialDecisionControls
          manuscriptId={id}
          chapterId={chapterId}
          rewritePlanId={latestRewritePlan?.id}
          title={`Granska ${chapter.title}`}
          rationale={planItem?.plan ? String(planItem.plan) : null}
          scope="CHAPTER"
          currentStatus={latestChapterDecision(decisions, chapterId, latestRewritePlan?.id)?.status}
        />
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <TextPanel title="Manusdelens text" text={chapter.text || "Ingen text finns för den här manusdelen."} />
        <section className="space-y-6">
          <InfoPanel title="Sammanfattning">
            <p className="text-sm leading-6 text-slate-700">
              {chapter.summary || String(audit.summary ?? "Ingen sammanfattning finns ännu.")}
            </p>
          </InfoPanel>

          <InfoPanel title="Funktion i manuset">
            <p className="text-sm leading-6 text-slate-700">
              {String(
                audit.chapterPromise ??
                  audit.sceneFunction ??
                  audit.conflict ??
                  audit.pacing ??
                  "Ingen funktion i helheten har identifierats ännu."
              )}
            </p>
          </InfoPanel>
        </section>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <section className="border border-line bg-white shadow-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <ListChecks size={18} aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Noteringar för manusdelen
            </h2>
          </div>
          <div className="divide-y divide-line">
            {chapter.findings.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">Inga noteringar finns ännu.</p>
            ) : (
              chapter.findings.map((finding) => {
                const decision = decisionByFinding.get(finding.id);

                return (
                  <div key={finding.id} className="space-y-3 px-4 py-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={finding.severity} />
                        <span className="text-sm font-semibold">{finding.issueType}</span>
                        {decision ? (
                          <span className="text-xs text-slate-500">
                            {formatStatus(decision.status)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{finding.problem}</p>
                      {finding.evidence ? (
                        <p className="mt-1 text-sm text-slate-500">{finding.evidence}</p>
                      ) : null}
                      <p className="mt-1 text-sm text-slate-700">{finding.recommendation}</p>
                    </div>
                    <EditorialDecisionControls
                      manuscriptId={id}
                      chapterId={chapterId}
                      findingId={finding.id}
                      title={finding.problem}
                      rationale={finding.recommendation}
                      scope="CHAPTER"
                      currentStatus={decision?.status}
                      metadata={{ issueType: finding.issueType, severity: finding.severity }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Noteringar för hela manuset
            </h2>
          </div>
          <div className="divide-y divide-line">
            {globalFindings.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">
                Inga manusövergripande noteringar är kopplade ännu.
              </p>
            ) : (
              globalFindings.slice(0, 6).map((finding) => {
                const decision = decisionByFinding.get(finding.id);

                return (
                  <div key={finding.id} className="space-y-3 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={finding.severity} />
                      <span className="text-sm font-semibold">{finding.issueType}</span>
                      {decision ? (
                        <span className="text-xs text-slate-500">
                          {formatStatus(decision.status)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-700">{finding.problem}</p>
                    <p className="text-sm text-slate-600">{finding.recommendation}</p>
                    <EditorialDecisionControls
                      manuscriptId={id}
                      findingId={finding.id}
                      title={finding.problem}
                      rationale={finding.recommendation}
                      scope="MANUSCRIPT"
                      currentStatus={decision?.status}
                      metadata={{ issueType: finding.issueType, severity: finding.severity }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </section>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Föreslagna redigeringar
            </h2>
          </div>
          <div className="divide-y divide-line">
            {proposedActions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">
                Inga föreslagna redigeringar finns ännu.
              </p>
            ) : (
              proposedActions.map((action) => (
                <div key={action.key} className="px-4 py-4">
                  <div className="text-sm font-semibold">{action.title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{action.detail}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center gap-2">
            <GitBranch size={18} aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Följdeffekter
            </h2>
          </div>
          {affectedChapters.length === 0 &&
          relatedUnresolvedFindings.length === 0 &&
          continuityNotes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Inga följdeffekter har hittats ännu.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {affectedChapters.length > 0 ? (
                <ImpactBlock title="Berörda manusdelar" items={affectedChapters} />
              ) : null}
              {relatedUnresolvedFindings.length > 0 ? (
                <ImpactBlock
                  title="Relaterade öppna noteringar"
                  items={relatedUnresolvedFindings.slice(0, 5).map((finding) => finding.problem)}
                />
              ) : null}
              {continuityNotes.length > 0 ? (
                <ImpactBlock title="Kontinuitet" items={continuityNotes.slice(0, 5)} />
              ) : null}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function TextPanel({ title, text }: { title: string; text: string }) {
  const excerpt = text.length > 9000 ? `${text.slice(0, 9000)}...` : text;

  return (
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h2>
      </div>
      <div className="max-h-[720px] overflow-auto whitespace-pre-wrap px-4 py-4 text-sm leading-7">
        {excerpt}
      </div>
    </section>
  );
}

function InfoPanel({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ImpactBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: number }) {
  const className =
    severity >= 5
      ? "bg-danger text-white"
      : severity >= 4
        ? "bg-warn text-white"
        : severity >= 3
          ? "bg-accent text-white"
          : "bg-paper-alt text-slate-700";

  return (
    <span className={`inline-flex min-h-7 items-center px-2 text-xs font-semibold ${className}`}>
      S{severity}
    </span>
  );
}

function chapterPlanForChapter(
  chapterPlans: unknown,
  chapter: { id: string; order: number; title: string }
) {
  if (!Array.isArray(chapterPlans)) {
    return null;
  }

  return chapterPlans.filter(isRecord).find((plan) => {
    return (
      plan.chapterId === chapter.id ||
      plan.id === chapter.id ||
      plan.chapterIndex === chapter.order ||
      plan.order === chapter.order ||
      String(plan.title ?? "").toLowerCase() === chapter.title.toLowerCase()
    );
  });
}

function affectedChaptersForPlan(plan: Record<string, unknown>) {
  return [
    plan.affectedChapters,
    plan.continuityDependencies,
    plan.echoImpact,
    plan.dependentChapters
  ].flatMap((value) => (Array.isArray(value) ? value.map((item) => String(item)) : []));
}

function latestChapterDecision(
  decisions: Array<{
    chapterId: string | null;
    findingId: string | null;
    rewritePlanId: string | null;
    status: "ACCEPTED" | "REJECTED" | "DEFERRED" | "NEEDS_REVIEW";
    updatedAt: Date;
    createdAt: Date;
  }>,
  chapterId: string,
  rewritePlanId?: string
) {
  return decisions
    .filter(
      (decision) =>
        decision.chapterId === chapterId &&
        !decision.findingId &&
        (!rewritePlanId || !decision.rewritePlanId || decision.rewritePlanId === rewritePlanId)
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
}

function arrayOfStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item)).filter(Boolean);
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    ACCEPTED: "Accepterad",
    COMPLETED: "Klar",
    DEFERRED: "Väntar",
    NEEDS_REVIEW: "Behöver ses över",
    PENDING: "Väntar",
    REJECTED: "Avvisad"
  };

  return labels[status] ?? status.toLowerCase().replace(/_/g, " ");
}
