import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  GitMerge,
  Pencil,
  Scissors,
  Tags,
  TriangleAlert
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  buildImportInspectorData,
  type ImportInspectorSection,
  type ImportStructureWarning
} from "@/lib/editorial/importInspector";
import { importManifestFromMetadata } from "@/lib/import/v2/manifest";
import type {
  ImportManifest,
  ManuscriptIRBlock
} from "@/lib/import/v2/types";
import {
  approveImportStructure,
  mergeImportSection,
  reclassifyImportSection,
  renameImportSection,
  splitImportSection
} from "./actions";

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
  const importManifest = importManifestFromMetadata(manuscript.metadata);
  const reviewInfoBySectionId = buildSectionReviewInfo(
    importManifest,
    inspection.sections
  );
  const selectedReviewInfo = selectedSection
    ? reviewInfoBySectionId.get(selectedSection.id)
    : undefined;

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
              Till manusöversikt
            </Link>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal">
              Manusstruktur
            </h1>
            <p className="mt-1 text-lg font-semibold">{manuscript.title}</p>
            <p className="mt-1 text-sm text-slate-500">
              {manuscript.sourceFileName || "Filnamn saknas"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/manuscripts/${manuscript.id}/audit`}
              className="secondary-button min-h-9 px-3"
            >
              <FileText size={16} aria-hidden="true" />
              Rapport
            </Link>
            <Link
              href={`/manuscripts/${manuscript.id}/workspace`}
              className="secondary-button min-h-9 px-3"
            >
              <BookOpen size={16} aria-hidden="true" />
              Arbetsyta
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <HeaderFact label="Ord" value={formatNumber(manuscript.wordCount)} />
          <HeaderFact
            label="Manusstruktur"
            value={formatNumber(inspection.stats.detectedSections)}
          />
          <HeaderFact label="Textdelar" value={formatNumber(inspection.stats.chunkCount)} />
          <HeaderFact label="Analys" value={formatStatus(manuscript.analysisStatus)} />
          <HeaderFact label="Import" value={formatStatus(manuscript.status)} />
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Ord totalt" value={formatNumber(inspection.stats.totalWords)} />
        <Stat
          label="Manusstruktur"
          value={formatNumber(inspection.stats.detectedSections)}
        />
        <Stat label="Textdelar" value={formatNumber(inspection.stats.chunkCount)} />
        <Stat
          label="Snittord per manusdel"
          value={formatNumber(inspection.stats.averageWordsPerSection)}
        />
        <Stat
          label="Snitt textdelar per manusdel"
          value={formatNumber(inspection.stats.averageChunksPerSection)}
        />
        <Stat
          label="Strukturvarningar"
          value={formatNumber(inspection.stats.warningCount)}
        />
      </section>

      {inspection.warnings.length > 0 ? (
        <section className="border border-line bg-white p-4 shadow-panel">
          <div className="flex items-center gap-2">
            <TriangleAlert size={18} aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Strukturvarningar
            </h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {summarizeWarnings(inspection.warnings).map((warning) => (
              <WarningBadge key={warning.code} label={`${warning.message} (${warning.count})`} />
            ))}
          </div>
        </section>
      ) : null}

      {importManifest ? (
        <ImportReviewHeader
          manuscriptId={manuscript.id}
          status={importManifest.review.status}
          verifiedEnough={importManifest.review.verifiedEnough}
          warningCount={inspection.stats.warningCount}
        />
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <section className="border border-line bg-white shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Manusstruktur
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Granska hur manuset delades upp innan du går vidare i texten.
            </p>
          </div>
          <div className="divide-y divide-line">
            {inspection.sections.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-500">
                Inga manusdelar importerades för det här manuset.
              </p>
            ) : (
              inspection.sections.map((section) => (
                <SectionRow
                  key={section.id}
                  manuscriptId={manuscript.id}
                  section={section}
                  selected={selectedSection?.id === section.id}
                  review={reviewInfoBySectionId.get(section.id)}
                />
              ))
            )}
          </div>
        </section>

        <SectionDetail
          manuscriptId={manuscript.id}
          section={selectedSection}
          review={selectedReviewInfo}
        />
      </section>
    </div>
  );
}

type SectionReviewInfo = {
  blockId?: string;
  splitTargetBlockId?: string;
  mergeTargetBlockId?: string;
  headingType?: string;
  reviewStatus: string;
  verifiedEnough: boolean;
};

function SectionRow({
  manuscriptId,
  section,
  selected,
  review
}: {
  manuscriptId: string;
  section: ImportInspectorSection;
  selected: boolean;
  review?: SectionReviewInfo;
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
            {review?.verifiedEnough ? (
              <span className="border border-success/30 bg-green-50 px-2 py-1 text-xs font-semibold text-success">
                verified
              </span>
            ) : null}
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
              Granska del
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <SectionMeasure label="Ord" value={formatNumber(section.wordCount)} />
        <SectionMeasure label="Textdelar" value={formatNumber(section.chunkCount)} />
      </div>
    </article>
  );
}

function SectionDetail({
  manuscriptId,
  section,
  review
}: {
  manuscriptId: string;
  section: ImportInspectorSection | null;
  review?: SectionReviewInfo;
}) {
  if (!section) {
    return (
      <aside className="border border-line bg-white p-4 text-sm text-slate-500 shadow-panel">
        Välj en manusdel för att granska texten.
      </aside>
    );
  }

  return (
    <aside className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Manusdel
        </h2>
        <h3 className="mt-2 text-xl font-semibold">{section.title}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {formatNumber(section.wordCount)} ord | {formatNumber(section.chunkCount)} textdelar
        </p>
      </div>

      <div className="space-y-5 px-4 py-4">
        {review?.blockId ? (
          <SectionReviewControls
            manuscriptId={manuscriptId}
            section={section}
            review={review}
          />
        ) : null}

        {section.warnings.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold">Strukturvarningar</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {section.warnings.map((warning) => (
                <WarningBadge key={warning.code} label={warning.message} />
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <h4 className="text-sm font-semibold">Rensad text</h4>
          <div className="mt-2 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper-alt p-3 text-sm leading-7 text-slate-800">
            {section.cleanedText
              ? section.cleanedText
              : "Ingen rensad text finns för den här manusdelen."}
          </div>
          <Link
            href={`/manuscripts/${manuscriptId}/chapters/${section.id}`}
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
          >
            Öppna hela manusdelen
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        <div>
          <h4 className="text-sm font-semibold">Textdelar i manusdelen</h4>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {section.chunks.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">
                Inga textdelar importerades för den här manusdelen.
              </p>
            ) : (
              section.chunks.map((chunk) => (
                <div key={chunk.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-ink">Textdel {chunk.chunkIndex}</span>
                    <span>{formatNumber(chunk.wordCount)} ord</span>
                    <span>{formatNumber(chunk.tokenEstimate)} tokenuppskattning</span>
                    <span>Sammanfattning {chunk.hasSummary ? "ja" : "nej"}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {chunk.preview || "Ingen förhandsvisning finns."}
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

function ImportReviewHeader({
  manuscriptId,
  status,
  verifiedEnough,
  warningCount
}: {
  manuscriptId: string;
  status: string;
  verifiedEnough: boolean;
  warningCount: number;
}) {
  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Importgranskning
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
            <span className="inline-flex min-h-7 items-center border border-line bg-paper-alt px-2">
              {status}
            </span>
            <span className="inline-flex min-h-7 items-center border border-line bg-paper-alt px-2">
              {verifiedEnough ? "verified enough" : "needs review"}
            </span>
            <span className="inline-flex min-h-7 items-center border border-line bg-paper-alt px-2">
              {formatNumber(warningCount)} varningar
            </span>
          </div>
        </div>
        <form action={approveImportStructure}>
          <input type="hidden" name="manuscriptId" value={manuscriptId} />
          <button type="submit" className="primary-button min-h-9 px-3">
            <Check size={16} aria-hidden="true" />
            Approve
          </button>
        </form>
      </div>
    </section>
  );
}

function SectionReviewControls({
  manuscriptId,
  section,
  review
}: {
  manuscriptId: string;
  section: ImportInspectorSection;
  review: SectionReviewInfo;
}) {
  return (
    <div className="space-y-3 border border-line bg-paper-alt p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Tags size={16} aria-hidden="true" />
        Importgranskning
      </div>

      <form action={renameImportSection} className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input type="hidden" name="manuscriptId" value={manuscriptId} />
        <input type="hidden" name="chapterId" value={section.id} />
        <input type="hidden" name="blockId" value={review.blockId} />
        <input
          name="title"
          defaultValue={section.title}
          className="min-h-10 border border-line bg-white px-3 text-sm"
        />
        <button type="submit" className="secondary-button min-h-10 px-3">
          <Pencil size={16} aria-hidden="true" />
          Rename
        </button>
      </form>

      <form
        action={reclassifyImportSection}
        className="grid gap-2 sm:grid-cols-[1fr_auto]"
      >
        <input type="hidden" name="manuscriptId" value={manuscriptId} />
        <input type="hidden" name="blockId" value={review.blockId} />
        <select
          name="headingType"
          defaultValue={review.headingType ?? section.detectedType}
          className="min-h-10 border border-line bg-white px-3 text-sm"
        >
          <option value="chapter">chapter</option>
          <option value="section">section</option>
          <option value="scene">scene</option>
          <option value="front_matter">front matter</option>
          <option value="part">part</option>
          <option value="unknown">unknown</option>
        </select>
        <button type="submit" className="secondary-button min-h-10 px-3">
          <Tags size={16} aria-hidden="true" />
          Reclassify
        </button>
      </form>

      <div className="grid gap-2 sm:grid-cols-2">
        <form action={splitImportSection}>
          <input type="hidden" name="manuscriptId" value={manuscriptId} />
          <input type="hidden" name="blockId" value={review.blockId} />
          <input
            type="hidden"
            name="targetBlockId"
            value={review.splitTargetBlockId ?? ""}
          />
          <button
            type="submit"
            disabled={!review.splitTargetBlockId}
            className="secondary-button min-h-10 w-full px-3 disabled:opacity-50"
          >
            <Scissors size={16} aria-hidden="true" />
            Split
          </button>
        </form>
        <form action={mergeImportSection}>
          <input type="hidden" name="manuscriptId" value={manuscriptId} />
          <input type="hidden" name="blockId" value={review.blockId} />
          <input
            type="hidden"
            name="targetBlockId"
            value={review.mergeTargetBlockId ?? ""}
          />
          <button
            type="submit"
            disabled={!review.mergeTargetBlockId}
            className="secondary-button min-h-10 w-full px-3 disabled:opacity-50"
          >
            <GitMerge size={16} aria-hidden="true" />
            Merge
          </button>
        </form>
      </div>
    </div>
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

function buildSectionReviewInfo(
  manifest: ImportManifest | null,
  sections: ImportInspectorSection[]
) {
  const bySectionId = new Map<string, SectionReviewInfo>();

  if (!manifest) {
    return bySectionId;
  }

  const headingBlocks = manifest.blocks.filter(isReviewHeadingBlock);
  const paragraphBlocks = manifest.blocks.filter(
    (block) => block.type === "paragraph" || block.type === "list_item"
  );

  sections.forEach((section, index) => {
    const headingBlock = headingBlocks[index];
    if (!headingBlock) {
      return;
    }

    const nextHeading = headingBlocks[index + 1];
    const splitTarget = paragraphBlocks.find(
      (block) =>
        block.order > headingBlock.order &&
        (!nextHeading || block.order < nextHeading.order)
    );
    const previousHeading = headingBlocks[index - 1];

    bySectionId.set(section.id, {
      blockId: headingBlock.id,
      splitTargetBlockId: splitTarget?.id,
      mergeTargetBlockId: previousHeading?.id,
      headingType: headingBlock.headingType,
      reviewStatus: manifest.review.status,
      verifiedEnough: manifest.review.verifiedEnough
    });
  });

  return bySectionId;
}

function isReviewHeadingBlock(block: ManuscriptIRBlock) {
  return (
    block.type === "heading" &&
    block.headingType !== "title" &&
    block.headingType !== undefined
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
  const labels: Record<string, string> = {
    COMPLETED: "Analysen är klar",
    FAILED: "Behöver ses över",
    IMPORTED: "Importerad",
    NOT_STARTED: "Utkast skapat",
    RUNNING: "Analysen pågår"
  };

  return labels[status] ?? status.toLowerCase().replace(/_/g, " ");
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
