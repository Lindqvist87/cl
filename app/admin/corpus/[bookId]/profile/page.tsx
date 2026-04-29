import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Gauge, MessageSquareText, ScrollText } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CorpusBookProfilePage({
  params
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  const book = await prisma.corpusBook.findUnique({
    where: { id: bookId },
    include: {
      source: true,
      profile: true,
      chapters: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          title: true,
          wordCount: true,
          metrics: true
        }
      },
      _count: {
        select: {
          chunks: true
        }
      }
    }
  });

  if (!book) {
    notFound();
  }

  if (!book.profile) {
    return (
      <div className="space-y-4">
        <Link href="/admin/corpus/onboarding" className="text-sm text-accent hover:underline">
          Back to corpus onboarding
        </Link>
        <section className="border border-line bg-white p-6 shadow-panel">
          <h1 className="text-2xl font-semibold tracking-normal">{book.title}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Book DNA has not been extracted yet.
          </p>
        </section>
      </div>
    );
  }

  const profile = book.profile;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <Link href="/admin/corpus/onboarding" className="text-sm text-accent hover:underline">
          Back to corpus onboarding
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">{book.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {[book.author, book.language, book.genre].filter(Boolean).join(" | ") ||
              "Corpus book"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {book.sourceName || book.source.name}
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TopMetric icon={BookOpen} label="Words" value={profile.wordCount.toLocaleString()} />
        <TopMetric icon={ScrollText} label="Chapters" value={String(profile.chapterCount)} />
        <TopMetric icon={Gauge} label="Avg chapter" value={profile.avgChapterWords.toLocaleString()} />
        <TopMetric icon={MessageSquareText} label="Dialogue" value={percent(profile.dialogueRatio)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ProfilePanel title="Structure">
          <MetricRows
            rows={[
              ["Median chapter", profile.medianChapterWords.toLocaleString()],
              ["Min chapter", profile.minChapterWords.toLocaleString()],
              ["Max chapter", profile.maxChapterWords.toLocaleString()],
              ["Chunks", book._count.chunks.toLocaleString()]
            ]}
          />
          <ChapterCurve chapters={book.chapters} />
        </ProfilePanel>

        <ProfilePanel title="Tempo">
          <MetricRows
            rows={[
              ["Avg sentence", String(profile.avgSentenceLength)],
              ["Action", percent(profile.actionRatio)],
              ["Introspection", percent(profile.introspectionRatio)],
              ["Questions", percent(profile.questionRatio)],
              ["Exclamations", percent(profile.exclamationRatio)]
            ]}
          />
          <JsonPreview value={profile.pacingCurve} />
        </ProfilePanel>

        <ProfilePanel title="Style">
          <MetricRows
            rows={[
              ["Point of view", profile.povEstimate || "Unknown"],
              ["Tense", profile.tenseEstimate || "Unknown"],
              ["Narrative distance", profile.narrativeDistance || "Unknown"],
              ["Lexical density", percent(profile.lexicalDensity)]
            ]}
          />
          <JsonPreview value={profile.styleFingerprint} />
        </ProfilePanel>

        <ProfilePanel title="Dialogue">
          <JsonPreview value={profile.dialogueStyle} />
        </ProfilePanel>

        <ProfilePanel title="Exposition">
          <MetricRows rows={[["Exposition", percent(profile.expositionRatio)]]} />
          <JsonPreview value={profile.expositionStyle} />
        </ProfilePanel>

        <ProfilePanel title="Chapter Endings">
          <JsonPreview value={profile.chapterEndingPatterns} />
        </ProfilePanel>

        <ProfilePanel title="Opening Pattern">
          <p className="text-sm font-semibold">{profile.openingHookType || "Unknown"}</p>
          <JsonPreview value={profile.aiMetrics} />
        </ProfilePanel>

        <ProfilePanel title="Literary Fingerprint">
          <JsonPreview value={profile.literaryCraftLessons} />
          <JsonPreview value={profile.genreMarkers} />
        </ProfilePanel>
      </section>
    </div>
  );
}

function TopMetric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-line bg-white p-4 shadow-panel">
      <Icon size={20} className="text-accent" aria-hidden="true" />
      <div className="mt-3 text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function ProfilePanel({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-line bg-white p-4 shadow-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function MetricRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-sm font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChapterCurve({
  chapters
}: {
  chapters: Array<{ id: string; order: number; title: string; wordCount: number }>;
}) {
  const maxWords = Math.max(1, ...chapters.map((chapter) => chapter.wordCount));

  return (
    <div className="space-y-2">
      {chapters.slice(0, 24).map((chapter) => (
        <div key={chapter.id} className="grid grid-cols-[120px_1fr_70px] items-center gap-3 text-xs">
          <div className="truncate text-slate-600">{chapter.title}</div>
          <div className="h-2 bg-paper">
            <div
              className="h-2 bg-accent"
              style={{ width: `${Math.max(4, (chapter.wordCount / maxWords) * 100)}%` }}
            />
          </div>
          <div className="text-right text-slate-600">{chapter.wordCount}</div>
        </div>
      ))}
    </div>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto bg-paper p-3 text-xs leading-5 text-slate-700">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
