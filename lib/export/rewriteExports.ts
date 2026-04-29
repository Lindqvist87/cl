import type { Prisma } from "@prisma/client";

type RewriteExport = {
  id: string;
  chapterId: string;
  status: string;
  version: number;
  rewrittenText: string;
  content: string;
  changeLog?: Prisma.JsonValue | null;
  continuityNotes?: Prisma.JsonValue | null;
  rationale?: Prisma.JsonValue | null;
  createdAt: Date;
};

type ChapterExport = {
  id: string;
  order: number;
  title: string;
  text: string;
};

type ManuscriptExport = {
  id: string;
  title: string;
  chapters: ChapterExport[];
  rewrites: RewriteExport[];
};

export function buildRewrittenMarkdown(
  manuscript: ManuscriptExport,
  options: { includeDrafts?: boolean } = {}
) {
  const selected = selectedRewriteByChapter(manuscript.rewrites, options);
  return [
    `# ${manuscript.title} - Rewritten Draft`,
    "",
    ...manuscript.chapters.flatMap((chapter) => [
      `## ${chapter.title}`,
      "",
      selected.get(chapter.id)?.text ?? chapter.text,
      ""
    ])
  ].join("\n");
}

export function buildRewrittenJson(
  manuscript: ManuscriptExport,
  options: { includeDrafts?: boolean } = {}
) {
  const selected = selectedRewriteByChapter(manuscript.rewrites, options);

  return {
    manuscript: {
      id: manuscript.id,
      title: manuscript.title
    },
    chapters: manuscript.chapters.map((chapter) => {
      const rewrite = selected.get(chapter.id);
      return {
        chapterId: chapter.id,
        order: chapter.order,
        title: chapter.title,
        source: rewrite ? "rewrite" : "original",
        status: rewrite?.status ?? "ORIGINAL",
        rewriteId: rewrite?.id,
        version: rewrite?.version,
        text: rewrite?.text ?? chapter.text,
        changeLog: rewrite?.changeLog,
        continuityNotes: rewrite?.continuityNotes,
        rationale: rewrite?.rationale
      };
    })
  };
}

export function selectedRewriteByChapter(
  rewrites: RewriteExport[],
  options: { includeDrafts?: boolean } = {}
) {
  const byChapter = new Map<
    string,
    {
      id: string;
      status: string;
      version: number;
      text: string;
      changeLog?: Prisma.JsonValue | null;
      continuityNotes?: Prisma.JsonValue | null;
      rationale?: Prisma.JsonValue | null;
      createdAt: Date;
    }
  >();
  const allowedStatuses = options.includeDrafts
    ? new Set(["ACCEPTED", "DRAFT"])
    : new Set(["ACCEPTED"]);

  const sorted = [...rewrites].sort((left, right) => {
    const statusDelta = statusRank(right.status) - statusRank(left.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });

  for (const rewrite of sorted) {
    if (!allowedStatuses.has(rewrite.status) || byChapter.has(rewrite.chapterId)) {
      continue;
    }

    byChapter.set(rewrite.chapterId, {
      id: rewrite.id,
      status: rewrite.status,
      version: rewrite.version,
      text: rewrite.rewrittenText || rewrite.content,
      changeLog: rewrite.changeLog,
      continuityNotes: rewrite.continuityNotes,
      rationale: rewrite.rationale,
      createdAt: rewrite.createdAt
    });
  }

  return byChapter;
}

function statusRank(status: string) {
  if (status === "ACCEPTED") return 2;
  if (status === "DRAFT") return 1;
  return 0;
}
