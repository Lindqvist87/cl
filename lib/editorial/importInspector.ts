import {
  classifyDetectedSection,
  type StructureReviewType
} from "@/lib/editorial/structureReview";

export type ImportStructureWarningCode =
  | "very_short_section"
  | "very_long_section"
  | "missing_title"
  | "unknown_section_type"
  | "many_detected_sections"
  | "no_chunks"
  | "large_chunk_count"
  | "possible_false_chapter_split";

export type ImportStructureWarning = {
  code: ImportStructureWarningCode;
  message: string;
  sectionId?: string;
};

export type ImportInspectorChunkInput = {
  id: string;
  chunkIndex: number;
  text?: string | null;
  wordCount?: number | null;
  tokenEstimate?: number | null;
  tokenCount?: number | null;
  summary?: string | null;
};

export type ImportInspectorSectionInput = {
  id: string;
  order: number;
  title?: string | null;
  heading?: string | null;
  text?: string | null;
  wordCount?: number | null;
  chunks?: readonly ImportInspectorChunkInput[];
};

export type ImportInspectorManuscriptInput = {
  wordCount?: number | null;
  chapterCount?: number | null;
  chunkCount?: number | null;
};

export type ImportInspectorChunk = {
  id: string;
  chunkIndex: number;
  wordCount: number;
  tokenEstimate: number;
  preview: string;
  hasSummary: boolean;
};

export type ImportInspectorSection = {
  id: string;
  order: number;
  title: string;
  detectedType: StructureReviewType;
  wordCount: number;
  chunkCount: number;
  preview: string;
  cleanedText: string;
  warnings: ImportStructureWarning[];
  chunks: ImportInspectorChunk[];
};

export type ImportInspectorStats = {
  totalWords: number;
  detectedSections: number;
  chunkCount: number;
  averageWordsPerSection: number;
  averageChunksPerSection: number;
  warningCount: number;
};

export type ImportInspectorResult = {
  stats: ImportInspectorStats;
  sections: ImportInspectorSection[];
  warnings: ImportStructureWarning[];
};

const VERY_SHORT_SECTION_WORDS = 250;
const VERY_LONG_SECTION_WORDS = 10_000;
const MANY_DETECTED_SECTIONS = 80;
const LARGE_TOTAL_CHUNK_COUNT = 300;
const LARGE_SECTION_CHUNK_COUNT = 20;

export function buildImportInspectorData({
  manuscript,
  sections
}: {
  manuscript?: ImportInspectorManuscriptInput | null;
  sections?: readonly ImportInspectorSectionInput[] | null;
}): ImportInspectorResult {
  const orderedSections = [...(sections ?? [])].sort((a, b) => a.order - b.order);
  const inspectedSections = orderedSections.map(buildSectionInspection);
  const detectedSections = inspectedSections.length;
  const sectionWords = inspectedSections.reduce(
    (total, section) => total + section.wordCount,
    0
  );
  const totalWords = positiveNumber(manuscript?.wordCount) ?? sectionWords;
  const chunkCount =
    positiveNumber(manuscript?.chunkCount) ??
    inspectedSections.reduce((total, section) => total + section.chunkCount, 0);
  const sectionWarnings = inspectedSections.flatMap((section) => section.warnings);
  const globalWarnings = buildGlobalWarnings({
    detectedSections,
    chunkCount
  });
  const warnings = [...globalWarnings, ...sectionWarnings];

  return {
    stats: {
      totalWords,
      detectedSections,
      chunkCount,
      averageWordsPerSection: average(totalWords, detectedSections),
      averageChunksPerSection: average(chunkCount, detectedSections),
      warningCount: warnings.length
    },
    sections: inspectedSections,
    warnings
  };
}

export function textPreview(value: string | null | undefined, maxLength = 260) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function warningMessage(code: ImportStructureWarningCode) {
  switch (code) {
    case "very_short_section":
      return "This section is unusually short";
    case "very_long_section":
      return "This section is unusually long";
    case "missing_title":
      return "This section is missing a clear title";
    case "unknown_section_type":
      return "The imported type is unclear";
    case "many_detected_sections":
      return "Many detected sections were imported";
    case "no_chunks":
      return "No chunks were imported for this text";
    case "large_chunk_count":
      return "This has an unusually large number of chunks";
    case "possible_false_chapter_split":
      return "This may be a false split";
  }
}

function buildSectionInspection(
  section: ImportInspectorSectionInput
): ImportInspectorSection {
  const title = (section.title ?? "").trim();
  const detectedType = classifyDetectedSection({
    title,
    heading: section.heading
  });
  const chunks = [...(section.chunks ?? [])]
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      wordCount: positiveNumber(chunk.wordCount) ?? 0,
      tokenEstimate: positiveNumber(chunk.tokenEstimate ?? chunk.tokenCount) ?? 0,
      preview: textPreview(chunk.text, 220),
      hasSummary: Boolean(chunk.summary?.trim())
    }));
  const wordCount =
    positiveNumber(section.wordCount) ??
    chunks.reduce((total, chunk) => total + chunk.wordCount, 0);

  const inspectedSection = {
    id: section.id,
    order: section.order,
    title: title || "Untitled section",
    detectedType,
    wordCount,
    chunkCount: chunks.length,
    preview: textPreview(section.text),
    cleanedText: (section.text ?? "").trim(),
    warnings: [] as ImportStructureWarning[],
    chunks
  };

  inspectedSection.warnings = buildSectionWarnings(inspectedSection, title);
  return inspectedSection;
}

function buildSectionWarnings(
  section: Omit<ImportInspectorSection, "warnings">,
  rawTitle: string
): ImportStructureWarning[] {
  const warnings: ImportStructureWarning[] = [];
  const add = (code: ImportStructureWarningCode) => {
    warnings.push({
      code,
      message: warningMessage(code),
      sectionId: section.id
    });
  };

  if (!rawTitle) {
    add("missing_title");
  }

  if (section.detectedType === "unknown") {
    add("unknown_section_type");
  }

  if (section.wordCount > 0 && section.wordCount < VERY_SHORT_SECTION_WORDS) {
    add("very_short_section");
  }

  if (section.wordCount > VERY_LONG_SECTION_WORDS) {
    add("very_long_section");
  }

  if (section.wordCount > 0 && section.chunkCount === 0) {
    add("no_chunks");
  }

  if (section.chunkCount > LARGE_SECTION_CHUNK_COUNT) {
    add("large_chunk_count");
  }

  if (
    section.wordCount > 0 &&
    section.wordCount < VERY_SHORT_SECTION_WORDS &&
    section.detectedType !== "chapter"
  ) {
    add("possible_false_chapter_split");
  }

  return warnings;
}

function buildGlobalWarnings({
  detectedSections,
  chunkCount
}: {
  detectedSections: number;
  chunkCount: number;
}): ImportStructureWarning[] {
  const warnings: ImportStructureWarning[] = [];
  const add = (code: ImportStructureWarningCode) => {
    warnings.push({
      code,
      message: warningMessage(code)
    });
  };

  if (detectedSections > MANY_DETECTED_SECTIONS) {
    add("many_detected_sections");
  }

  if (chunkCount === 0) {
    add("no_chunks");
  }

  if (chunkCount > LARGE_TOTAL_CHUNK_COUNT) {
    add("large_chunk_count");
  }

  return warnings;
}

function average(total: number, count: number) {
  if (count <= 0) {
    return 0;
  }

  return Math.round((total / count) * 10) / 10;
}

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
