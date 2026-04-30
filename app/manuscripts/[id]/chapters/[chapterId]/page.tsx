import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { AnalysisPassType } from "@prisma/client";
import { AcceptRewriteButton } from "@/components/AcceptRewriteButton";
import { prisma } from "@/lib/prisma";
import type { JsonRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ManuscriptChapterPage({
  params
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  const chapter = await prisma.manuscriptChapter.findFirst({
    where: {
      id: chapterId,
      manuscriptId: id
    },
    include: {
      manuscript: true,
      findings: {
        orderBy: [{ severity: "desc" }, { createdAt: "asc" }]
      },
      rewrites: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!chapter) {
    notFound();
  }

  const latestRewrite = chapter.rewrites[0];
  const chapterAudit = await prisma.analysisOutput.findFirst({
    where: {
      manuscriptId: id,
      chapterId,
      passType: AnalysisPassType.CHAPTER_AUDIT
    },
    orderBy: { createdAt: "desc" }
  });
  const audit = toRecord(chapterAudit?.output);
  const rewriteInstructions = Array.isArray(audit.rewriteInstructions)
    ? audit.rewriteInstructions
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/manuscripts/${id}`} className="text-sm text-accent hover:underline">
            Back to manuscript
          </Link>
          <div className="mt-2">
            <Link
              href={`/manuscripts/${id}/chapters/${chapterId}/workspace`}
              className="text-sm text-accent hover:underline"
            >
              Open editorial workspace
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            {chapter.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {chapter.wordCount.toLocaleString()} words
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {latestRewrite ? (
            <>
              <a href={`/api/manuscripts/${id}/chapters/${chapterId}/rewrite/markdown`} className="focus-ring inline-flex min-h-9 items-center gap-2 border border-line bg-white px-3 py-2 text-sm font-semibold">
                <Download size={16} aria-hidden="true" />
                Rewrite MD
              </a>
              <AcceptRewriteButton
                manuscriptId={id}
                chapterId={chapterId}
                status={latestRewrite.status}
              />
            </>
          ) : null}
        </div>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <TextPanel title="Original Chapter" text={chapter.text} />
        <TextPanel
          title={`Rewritten Draft${latestRewrite ? ` (${latestRewrite.status})` : ""}`}
          text={latestRewrite?.rewrittenText || latestRewrite?.content || "No rewritten draft yet."}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Chapter Findings
            </h2>
          </div>
          <div className="divide-y divide-line">
            {chapter.findings.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">No chapter findings yet.</p>
            ) : (
              chapter.findings.map((finding) => (
                <div key={finding.id} className="px-4 py-4">
                  <div className="text-sm font-semibold">
                    S{finding.severity} {finding.problem}
                  </div>
                  {finding.evidence ? (
                    <p className="mt-2 text-sm text-slate-700">{finding.evidence}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-slate-700">{finding.recommendation}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border border-line bg-white p-4 shadow-panel">
          <h2 className="text-lg font-semibold">Rewrite Instructions</h2>
          {rewriteInstructions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No rewrite instructions yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {rewriteInstructions.map((instruction) => (
                <li key={String(instruction)}>{String(instruction)}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function TextPanel({ title, text }: { title: string; text: string }) {
  return (
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h2>
      </div>
      <div className="max-h-[640px] overflow-auto whitespace-pre-wrap px-4 py-4 text-sm leading-7">
        {text}
      </div>
    </section>
  );
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
