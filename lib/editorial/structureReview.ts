export const DETECTED_SECTION_HELP_TEXT =
  "Review how the manuscript is divided before moving deeper into revision.";

export type StructureReviewType = "chapter" | "section" | "scene" | "unknown";

export type StructureReviewChapterInput = {
  id: string;
  order: number;
  title: string;
  heading?: string | null;
  wordCount?: number | null;
};

export type StructureReviewFindingInput = {
  chapterId?: string | null;
};

export type StructureReviewRow = {
  id: string;
  order: number;
  title: string;
  wordCount: number;
  issueCount: number;
  currentType: StructureReviewType;
};

export function buildStructureReviewRows<
  TChapter extends StructureReviewChapterInput
>({
  chapters,
  findings = [],
  issueCountByChapterId
}: {
  chapters: TChapter[];
  findings?: StructureReviewFindingInput[];
  issueCountByChapterId?: Map<string, number>;
}): StructureReviewRow[] {
  const findingCounts = findings.reduce<Map<string, number>>((counts, finding) => {
    if (!finding.chapterId) {
      return counts;
    }

    counts.set(finding.chapterId, (counts.get(finding.chapterId) ?? 0) + 1);
    return counts;
  }, new Map());

  return chapters.map((chapter) => ({
    id: chapter.id,
    order: chapter.order,
    title: chapter.title,
    wordCount: chapter.wordCount ?? 0,
    issueCount:
      issueCountByChapterId?.get(chapter.id) ?? findingCounts.get(chapter.id) ?? 0,
    currentType: classifyDetectedSection(chapter)
  }));
}

export function classifyDetectedSection(
  chapter: Pick<StructureReviewChapterInput, "title" | "heading">
): StructureReviewType {
  const label = normalize(`${chapter.heading ?? ""} ${chapter.title}`);

  if (/\bchapter\b|\bchap\.|\bkapitel\b/.test(label)) {
    return "chapter";
  }

  if (/\b(scene|scen)\b/.test(label)) {
    return "scene";
  }

  if (
    /\b(section|part|del)\b/.test(label) ||
    /^\d+[\s.)-]/.test(label) ||
    /^[ivxlcdm]+[\s.)-]/.test(label)
  ) {
    return "section";
  }

  return "unknown";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
