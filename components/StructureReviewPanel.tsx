import Link from "next/link";
import {
  DETECTED_SECTION_HELP_TEXT,
  type StructureReviewRow
} from "@/lib/editorial/structureReview";

export function StructureReviewPanel({
  getHref,
  rows,
  title = "Book structure",
  description = DETECTED_SECTION_HELP_TEXT,
  sectionColumnLabel = "Book section",
  wordColumnLabel = "Words",
  issueColumnLabel = "Issues",
  typeColumnLabel = "Current type",
  emptyLabel = "No book structure is available yet."
}: {
  getHref?: (row: StructureReviewRow) => string;
  rows: StructureReviewRow[];
  title?: string;
  description?: string;
  sectionColumnLabel?: string;
  wordColumnLabel?: string;
  issueColumnLabel?: string;
  typeColumnLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <section className="border border-line bg-white shadow-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {description}
        </p>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <div className="grid grid-cols-[1fr_80px_70px_86px] gap-3 border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <div>{sectionColumnLabel}</div>
          <div className="text-right">{wordColumnLabel}</div>
          <div className="text-right">{issueColumnLabel}</div>
          <div>{typeColumnLabel}</div>
        </div>
        <div className="divide-y divide-line">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">
              {emptyLabel}
            </p>
          ) : (
            rows.map((row) => {
              const titleText = `${row.order}. ${row.title}`;
              const href = getHref?.(row);

              return (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_80px_70px_86px] gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    {href ? (
                      <Link href={href} className="font-semibold text-ink hover:text-accent hover:underline">
                        {titleText}
                      </Link>
                    ) : (
                      <div className="font-semibold">{titleText}</div>
                    )}
                  </div>
                  <div className="text-right text-slate-600">
                    {row.wordCount.toLocaleString()}
                  </div>
                  <div className="text-right text-slate-600">{row.issueCount}</div>
                  <div className="capitalize text-slate-600">{row.currentType}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
