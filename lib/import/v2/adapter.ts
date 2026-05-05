import {
  importManifestToNormalizedText,
  metadataWithImportManifest
} from "@/lib/import/v2/manifest";
import type {
  ImportManifest,
  ImportWarning,
  ManuscriptIRBlock
} from "@/lib/import/v2/types";
import type {
  ParsedChapter,
  ParsedManuscript,
  ParsedParagraph,
  ParsedScene
} from "@/lib/types";
import { countWords } from "@/lib/text/wordCount";

const MANY_SHORT_CHAPTERS_MIN_COUNT = 3;
const MANY_SHORT_CHAPTERS_RATIO = 0.4;

export function importManifestToParsedManuscript(
  manifest: ImportManifest
): ParsedManuscript {
  const normalizedText = importManifestToNormalizedText(manifest);
  const contentBlocks = manifest.blocks.filter(
    (block) => block.type !== "title" && block.type !== "comment"
  );
  const title = detectTitle(manifest);
  const chapters = buildChapters(contentBlocks, manifest);
  const wordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const paragraphCount = chapters.reduce(
    (sum, chapter) =>
      sum +
      chapter.scenes.reduce(
        (sceneSum, scene) => sceneSum + scene.paragraphs.length,
        0
      ),
    0
  );
  const structureWarnings = buildStructureWarnings(chapters, manifest);
  const review = {
    ...manifest.review,
    recommended:
      structureWarnings.length > 0 || manifest.review.status === "needs_review",
    warningCount: structureWarnings.length,
    warnings: structureWarnings
  };

  return {
    title,
    normalizedText,
    wordCount,
    paragraphCount,
    chapters,
    metadata: {
      ...metadataWithImportManifest({}, manifest),
      parserVersion: manifest.parserVersion,
      sourceFileName: manifest.sourceFileName,
      chapterDetection: manifest.metadata?.chapterDetection,
      structureWarnings,
      structureReview: review
    }
  };
}

function detectTitle(manifest: ImportManifest) {
  const titleBlock = manifest.blocks.find((block) => block.type === "title");
  if (titleBlock?.text.trim()) {
    return titleBlock.text.trim().replace(/^#{1,6}\s+/, "");
  }

  const firstShortHeading = manifest.blocks.find(
    (block) =>
      block.type === "heading" &&
      block.headingType === "title" &&
      countWords(block.text) <= 14
  );
  if (firstShortHeading?.text.trim()) {
    return firstShortHeading.text.trim().replace(/^#{1,6}\s+/, "");
  }

  return manifest.sourceFileName.replace(/\.(docx|txt)$/i, "").replace(/[_-]+/g, " ");
}

function buildChapters(
  blocks: ManuscriptIRBlock[],
  manifest: ImportManifest
): ParsedChapter[] {
  const chapterStartIndexes = blocks
    .map((block, index) => (isChapterStart(block) ? index : -1))
    .filter((index) => index >= 0);
  const starts =
    chapterStartIndexes.length === 0
      ? blocks.length > 0
        ? [0]
        : []
      : chapterStartIndexes[0] > 0
        ? [0, ...chapterStartIndexes]
        : chapterStartIndexes;
  let globalParagraphOrder = 0;

  if (starts.length === 0) {
    return [
      {
        order: 1,
        title: "Manuscript",
        wordCount: 0,
        scenes: [{ order: 1, title: "Scene 1", wordCount: 0, paragraphs: [] }]
      }
    ];
  }

  return starts.map((start, chapterIndex) => {
    const end = starts[chapterIndex + 1] ?? blocks.length;
    const headingBlock = blocks[start];
    const hasHeading = isChapterStart(headingBlock);
    const contentStart = hasHeading ? start + 1 : start;
    const chapterBlocks = blocks.slice(contentStart, end);
    const title = hasHeading
      ? chapterTitleFromHeading(headingBlock.text)
      : chapterIndex === 0
        ? "Front matter"
        : `Opening ${chapterIndex + 1}`;
    const scenes = buildScenes(chapterBlocks, chapterIndex + 1, globalParagraphOrder);

    globalParagraphOrder += scenes.reduce(
      (sum, scene) => sum + scene.paragraphs.length,
      0
    );

    const wordCount = scenes.reduce((sum, scene) => sum + scene.wordCount, 0);

    return {
      order: chapterIndex + 1,
      title,
      heading: hasHeading ? headingBlock.text : undefined,
      wordCount,
      startOffset: firstOffset(blocks.slice(start, end)),
      endOffset: lastOffset(blocks.slice(start, end)),
      sourceAnchor: headingBlock?.sourceAnchor,
      importBlockId: headingBlock?.id,
      confidence: headingBlock?.confidence,
      warnings: headingBlock?.warnings,
      scenes
    } satisfies ParsedChapter;
  });
}

function buildScenes(
  blocks: ManuscriptIRBlock[],
  chapterOrder: number,
  globalStartOrder: number
): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  let currentParagraphs: ParsedParagraph[] = [];
  let sceneOrder = 1;
  let chapterParagraphOrder = 0;
  let sceneParagraphOrder = 0;
  let globalOrder = globalStartOrder;

  const flushScene = (marker?: string) => {
    if (currentParagraphs.length === 0) {
      return;
    }

    const wordCount = currentParagraphs.reduce(
      (sum, paragraph) => sum + paragraph.wordCount,
      0
    );

    scenes.push({
      order: sceneOrder,
      title: `Scene ${sceneOrder}`,
      marker,
      wordCount,
      paragraphs: currentParagraphs
    });

    sceneOrder += 1;
    sceneParagraphOrder = 0;
    currentParagraphs = [];
  };

  for (const block of blocks) {
    if (block.type === "scene_break") {
      flushScene(block.text.trim());
      continue;
    }

    if (
      block.type === "page_break" ||
      block.type === "heading" ||
      block.type === "track_change"
    ) {
      continue;
    }

    const paragraph: ParsedParagraph = {
      text: block.text,
      wordCount: countWords(block.text),
      globalOrder,
      chapterOrder: chapterParagraphOrder,
      sceneOrder: sceneParagraphOrder,
      approximateOffset: block.offset.characterStart,
      sourceAnchor: block.sourceAnchor,
      importBlockId: block.id,
      confidence: block.confidence,
      warnings: block.warnings
    };

    currentParagraphs.push(paragraph);
    globalOrder += 1;
    chapterParagraphOrder += 1;
    sceneParagraphOrder += 1;
  }

  flushScene();

  if (scenes.length === 0) {
    return [
      {
        order: 1,
        title: "Scene 1",
        wordCount: 0,
        paragraphs: []
      }
    ];
  }

  return scenes;
}

function isChapterStart(block: ManuscriptIRBlock | undefined) {
  if (!block || block.type !== "heading") {
    return false;
  }

  return (
    block.headingType === "chapter" ||
    block.headingType === "section" ||
    block.headingType === "front_matter" ||
    block.headingType === "part" ||
    block.headingType === "unknown"
  );
}

function chapterTitleFromHeading(text: string) {
  return text.replace(/^#{1,6}\s+/, "").trim();
}

function firstOffset(blocks: ManuscriptIRBlock[]) {
  const value = blocks.find((block) =>
    Number.isFinite(block.offset.characterStart)
  )?.offset.characterStart;
  return typeof value === "number" ? value : undefined;
}

function lastOffset(blocks: ManuscriptIRBlock[]) {
  const value = [...blocks].reverse().find((block) =>
    Number.isFinite(block.offset.characterEnd)
  )?.offset.characterEnd;
  return typeof value === "number" ? value : undefined;
}

function buildStructureWarnings(
  chapters: ParsedChapter[],
  manifest: ImportManifest
): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const shortChapters = chapters.filter(
    (chapter) => chapter.wordCount > 0 && chapter.wordCount < 80
  );
  const under150 = chapters.filter(
    (chapter) => chapter.wordCount > 0 && chapter.wordCount < 150
  );

  for (const chapter of shortChapters) {
    warnings.push({
      code: "chapter_word_count_under_80",
      message: "Detected chapter is under 80 words; review for a false split.",
      severity: "warning",
      blockId: chapter.importBlockId,
      confidence: chapter.confidence,
      chapterOrder: chapter.order,
      heading: chapter.heading,
      wordCount: chapter.wordCount,
      metadata: {
        chapterOrder: chapter.order,
        heading: chapter.heading,
        wordCount: chapter.wordCount
      }
    });
  }

  if (
    under150.length >= MANY_SHORT_CHAPTERS_MIN_COUNT &&
    under150.length / Math.max(1, chapters.length) >= MANY_SHORT_CHAPTERS_RATIO
  ) {
    warnings.push({
      code: "many_chapters_under_150",
      message:
        "Many detected chapters are under 150 words; review the imported structure.",
      severity: "warning",
      count: under150.length,
      total: chapters.length,
      metadata: {
        count: under150.length,
        total: chapters.length
      }
    });
  }

  const numericJump = findNumericToProseFragmentJump(chapters);
  if (numericJump) {
    warnings.push({
      code: "numeric_to_prose_fragment_headings",
      message:
        "Chapter headings jump from numeric labels to short prose fragments; review for accidental splits.",
      severity: "warning",
      blockId: numericJump.importBlockId,
      confidence: numericJump.confidence,
      chapterOrder: numericJump.order,
      heading: numericJump.heading,
      wordCount: numericJump.wordCount,
      metadata: {
        chapterOrder: numericJump.order,
        heading: numericJump.heading,
        wordCount: numericJump.wordCount
      }
    });
  }

  return [...manifest.warnings, ...warnings];
}

function findNumericToProseFragmentJump(chapters: ParsedChapter[]) {
  let numericHeadingRun = 0;

  for (const chapter of chapters) {
    const kind = chapterHeadingKind(chapter.heading);

    if (kind === "numeric") {
      numericHeadingRun += 1;
      continue;
    }

    if (
      numericHeadingRun >= 2 &&
      kind === "prose-fragment" &&
      chapter.wordCount < 150
    ) {
      return chapter;
    }

    if (kind !== "unknown") {
      numericHeadingRun = 0;
    }
  }

  return null;
}

function chapterHeadingKind(heading?: string) {
  if (!heading) {
    return "unknown";
  }

  const text = chapterTitleFromHeading(heading);

  if (
    /^([0-9]{1,3})[.)]?$/.test(text) ||
    /^(?=[ivxlcdm]{1,8}[.)]?$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})[.)]?$/iu.test(
      text
    ) ||
    /^(chapter|kapitel)\b/iu.test(text)
  ) {
    return "numeric";
  }

  if (/^(prologue|prolog|epilogue|epilog)$/iu.test(text)) {
    return "named";
  }

  if (countWords(text) > 0 && countWords(text) <= 8) {
    return "prose-fragment";
  }

  return "unknown";
}
