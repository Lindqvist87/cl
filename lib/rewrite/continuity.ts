import type { Prisma } from "@prisma/client";
import { countWords } from "@/lib/text/wordCount";

export type ChapterForContinuity = {
  id: string;
  order: number;
  title: string;
  summary?: string | null;
  text?: string | null;
};

export type RewriteForContinuity = {
  id: string;
  chapterId: string;
  status: string;
  version: number;
  rewrittenText: string;
  content: string;
  continuityNotes?: Prisma.JsonValue | null;
  createdAt: Date;
};

export type PreviousChapterContext = {
  chapterId: string;
  title: string;
  order: number;
  summary?: string | null;
  canonStatus: "accepted_rewrite" | "original_summary";
  acceptedRewriteId?: string;
  acceptedRewriteVersion?: number;
  acceptedRewriteExcerpt?: string;
  continuityNotes?: unknown;
};

export function latestAcceptedRewriteByChapter<
  T extends RewriteForContinuity
>(rewrites: T[]) {
  const acceptedByChapter = new Map<string, T>();
  const sorted = [...rewrites].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
  );

  for (const rewrite of sorted) {
    if (rewrite.status !== "ACCEPTED" || acceptedByChapter.has(rewrite.chapterId)) {
      continue;
    }

    acceptedByChapter.set(rewrite.chapterId, rewrite);
  }

  return acceptedByChapter;
}

export function previousChapterContexts(
  chapters: ChapterForContinuity[],
  currentOrder: number,
  acceptedByChapter: Map<string, RewriteForContinuity>,
  maxExcerptWords = 220
): PreviousChapterContext[] {
  return chapters
    .filter((chapter) => chapter.order < currentOrder)
    .sort((left, right) => left.order - right.order)
    .map((chapter) => {
      const accepted = acceptedByChapter.get(chapter.id);
      if (!accepted) {
        return {
          chapterId: chapter.id,
          title: chapter.title,
          order: chapter.order,
          summary: chapter.summary,
          canonStatus: "original_summary"
        };
      }

      const acceptedText = accepted.rewrittenText || accepted.content;
      return {
        chapterId: chapter.id,
        title: chapter.title,
        order: chapter.order,
        summary: chapter.summary,
        canonStatus: "accepted_rewrite",
        acceptedRewriteId: accepted.id,
        acceptedRewriteVersion: accepted.version,
        acceptedRewriteExcerpt: firstWords(acceptedText, maxExcerptWords),
        continuityNotes: accepted.continuityNotes
      };
    });
}

export function buildContinuityLedger(input: {
  continuityRules: unknown;
  previousChapters: PreviousChapterContext[];
}) {
  const acceptedCanon = input.previousChapters.filter(
    (chapter) => chapter.canonStatus === "accepted_rewrite"
  );

  return {
    rules: input.continuityRules,
    previousChapters: input.previousChapters,
    acceptedCanonChapterCount: acceptedCanon.length,
    acceptedCanon: acceptedCanon.map((chapter) => ({
      chapterId: chapter.chapterId,
      title: chapter.title,
      acceptedRewriteId: chapter.acceptedRewriteId,
      acceptedRewriteVersion: chapter.acceptedRewriteVersion,
      continuityNotes: chapter.continuityNotes,
      excerpt: chapter.acceptedRewriteExcerpt
    }))
  };
}

export function firstWords(text: string, maxWords: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text;
  }

  return `${words.slice(0, maxWords).join(" ")} [...]`;
}

export function summarizeRewriteText(text: string, maxWords = 80) {
  const excerpt = firstWords(text, maxWords);
  return `${excerpt}${countWords(text) > maxWords ? "" : ""}`;
}
