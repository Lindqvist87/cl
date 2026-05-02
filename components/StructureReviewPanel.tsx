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
  sectionColumnLabel = "Manuscript outline",
  wordColumnLabel = "Length",
  issueColumnLabel = "Notes",
  typeColumnLabel = "Role",
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
    <section className="paper-card p-0">
      <div className="border-b border-line px-5 py-4">
        <h2 className="section-title">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          {description}
        </p>
      </div>
      <div className="max-h-[560px] overflow-auto p-3">
        <div className="space-y-2">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              {emptyLabel}
            </p>
          ) : (
            rows.map((row) => {
              const titleText = `${row.order}. ${row.title}`;
              const href = getHref?.(row);

              return (
                <article
                  key={row.id}
                  className="rounded-lg border border-line bg-paper-alt px-4 py-3 text-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {sectionColumnLabel}
                      </div>
                      {href ? (
                        <Link href={href} className="mt-1 block font-semibold text-ink hover:text-accent">
                          {titleText}
                        </Link>
                      ) : (
                        <div className="mt-1 font-semibold">{titleText}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PanelMetric label={wordColumnLabel} value={`${row.wordCount.toLocaleString()} words`} />
                      <PanelMetric
                        label={issueColumnLabel}
                        value={row.issueCount > 0 ? `${row.issueCount} to review` : "Clear"}
                        tone={row.issueCount > 0 ? "warn" : "neutral"}
                      />
                      <PanelMetric label={typeColumnLabel} value={formatSectionType(row.currentType)} />
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function PanelMetric({
  label,
  tone = "neutral",
  value
}: {
  label: string;
  tone?: "neutral" | "warn";
  value: string;
}) {
  const toneClass =
    tone === "warn"
      ? "border-warn/25 bg-warn/5 text-warn"
      : "border-line bg-white text-muted";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${toneClass}`}>
      <span>{label}</span>
      <span className="font-semibold capitalize text-ink">{value}</span>
    </span>
  );
}

function formatSectionType(value: string) {
  return value === "unknown" ? "To confirm" : value;
}
