import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileText,
  TriangleAlert
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  buildImportInspectorData,
  type ImportInspectorSection,
  type ImportStructureWarning
} from "@/lib/editorial/importInspector";

export const dynamic = "force-dynamic";

export default async function ManuscriptStructurePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ selectedSectionId?: string; section?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const selectedSectionId = query?.selectedSectionId ?? query?.section;
  const manuscript = await prisma.manuscript.findUnique({
    where: { id },
    include: {
      chapters: {
        orderBy: { order: "asc" },
        include: {
          chunks: {
            orderBy: { chunkIndex: "asc" },
            select: {
              id: true,
              chunkIndex: true,
              text: true,
              wordCount: true,
              tokenEstimate: true,
              tokenCount: true,
              summary: true
            }
          }
        }
      }
    }
  });

  if (!manuscript) {
    notFound();
  }

  const inspection = buildImportInspectorData({
    manuscript,
    sections: manuscript.chapters
  });
  const selectedSection =
    inspection.sections.find((section) => section.id === selectedSectionId) ??
    inspection.sections[0] ??
    null;

  return (
    <div className="space-y-6">
      <header className="border border-line bg-white p-4 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              href={`/manuscripts/${manuscript.id}`}
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to manuscript overview
            </Link>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal">
              Book structure
            </h1>
            <p className="mt-1 text-lg font-semibold">{manuscript.title}</p>
            <p className="mt-1 text-sm text-slate-500">
              {manuscript.sourceFileName || "Original filename unavailable"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/manuscripts/${manuscript.id}/audit`}
              className="secondary-button min-h-9 px-3"
            >
              <FileText size={16} aria-hidden="true" />
              Editorial report
            </Link>
            <Link
              href={`/manuscripts/${manuscript.id}/workspace`}
              className="secondary-button min-h-9 px-3"
            >
              <BookOpen size={16} aria-hidden="true" />
              Editorial workspace
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <HeaderFact label="Word count" value={formatNumber(manuscript.wordCount)} />
          <HeaderFact
            label="Book structure"
            value={formatNumber(inspection.stats.detectedSections)}
          />
          <HeaderFact label="Chunks" value={formatNumber(inspection.stats.chunkCount)} />
          <HeaderFact label="Analysis status" value={formatStatus(manuscript.analysisStatus)} />
          <HeaderFact label="Import status" value={formatStatus(manuscript.status)} />
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total words" value={formatNumber(inspection.stats.totalWords)} />
        <Stat
          label="Book structure"
          value={formatNumber(inspection.stats.detectedSections)}
        />
        <Stat label="Chunks" value={formatNumber(inspection.stats.chunkCount)} />
        <Stat
          label="Average words per section"
          value={formatNumber(inspection.stats.averageWordsPerSection)}
        />
        <Stat
          label="Average chunks per section"
          value={formatNumber(inspection.stats.averageChunksPerSection)}
        />
        <Stat
          label="Structure warnings"
          value={formatNumber(inspection.stats.warningCount)}
        />
      </section>

      {inspection.warnings.length > 0 ? (
        <section className="border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center gap-2">
            <TriangleAlert size={18} aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Structure warnings
            </h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {summarizeWarnings(inspection.warnings).map((warning) => (
              <WarningBadge key={warning.code} label={`${warning.message} (${warning.count})`} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <section className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Book structure
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Review the imported sections before relying on deeper editorial analysis.
            </p>
          </div>
          <div className="divide-y divide-line">
            {inspection.sections.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-500">
                No book sections were imported for this manuscript.
              </p>
            ) : (
              inspection.sections.map((section) => (
                <SectionRow
                  key={section.id}
                  manuscriptId={manuscript.id}
                  section={section}
                  selected={selectedSection?.id === section.id}
                />
              ))
            )}
          </div>
        </section>

        <SectionDetail manuscriptId={manuscript.id} section={selectedSection} />
      </section>
    </div>
  );
}

function SectionRow({
  manuscriptId,
  section,
  selected
}: {
  manuscriptId: string;
  section: ImportInspectorSection;
  selected: boolean;
}) {
  return (
    <article className={selected ? "bg-accent/5 px-4 py-4" : "px-4 py-4"}>
      <div className="grid gap-4 lg:grid-cols-[72px_1fr_110px_110px]">
        <div className="text-sm font-semibold text-slate-500">
          #{section.order}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{section.title}</h3>
            <span className="border border-line bg-white px-2 py-1 text-xs capitalize text-slate-600">
              {section.detectedType}
            </span>
            {section.warnings.map((warning) => (
              <WarningBadge key={warning.code} label={warning.message} />
            ))}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {section.preview || "No text preview is available for this section."}
          </p>
          <Link
            href={`/manuscripts/${manuscriptId}/structure?selectedSectionId=${section.id}`}
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
          >
              Review section
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <SectionMeasure label="Words" value={formatNumber(section.wordCount)} />
        <SectionMeasure label="Chunks" value={formatNumber(section.chunkCount)} />
      </div>
    </article>
  );
}

function SectionDetail({
  manuscriptId,
  section
}: {
  manuscriptId: string;
  section: ImportInspectorSection | null;
}) {
  if (!section) {
    return (
      <aside className="border border-line bg-white p-4 text-sm text-slate-500 shadow-panel">
        Select a book section to inspect its text and chunks.
      </aside>
    );
  }

  return (
    <aside className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Section detail
        </h2>
        <h3 className="mt-2 text-xl font-semibold">{section.title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {formatNumber(section.wordCount)} words | {formatNumber(section.chunkCount)} chunks
        </p>
      </div>

      <div className="space-y-5 px-4 py-4">
        {section.warnings.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold">Structure warnings</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {section.warnings.map((warning) => (
                <WarningBadge key={warning.code} label={warning.message} />
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <h4 className="text-sm font-semibold">Cleaned text</h4>
          <div className="mt-2 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper-alt p-3 text-sm leading-7 text-slate-800">
            {section.cleanedText
              ? section.cleanedText
              : "No cleaned text is available for this section."}
          </div>
          <Link
            href={`/manuscripts/${manuscriptId}/chapters/${section.id}`}
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
          >
            Open full section page
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <div>
          <h4 className="text-sm font-semibold">Chunks belonging to this section</h4>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {section.chunks.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">
                No chunks were imported for this section.
              </p>
            ) : (
              section.chunks.map((chunk) => (
                <div key={chunk.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-ink">Chunk {chunk.chunkIndex}</span>
                    <span>{formatNumber(chunk.wordCount)} words</span>
                    <span>{formatNumber(chunk.tokenEstimate)} token estimate</span>
                    <span>Summary {chunk.hasSummary ? "yes" : "no"}</span>
                    <span>Embedding not tracked</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {chunk.preview || "No chunk preview is available."}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return (
      <div className="rounded-lg border border-line bg-paper-alt px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function SectionMeasure({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm lg:text-right">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function WarningBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-7 items-center border border-warn bg-white px-2 text-xs font-semibold text-warn">
      {label}
    </span>
  );
}

function summarizeWarnings(warnings: ImportStructureWarning[]) {
  const counts = warnings.reduce<Map<string, { code: string; message: string; count: number }>>(
    (summary, warning) => {
      const current = summary.get(warning.code) ?? {
        code: warning.code,
        message: warning.message,
        count: 0
      };
      current.count += 1;
      summary.set(warning.code, current);
      return summary;
    },
    new Map()
  );

  return [...counts.values()];
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
