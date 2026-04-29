import type { ParsedChapter, ParsedManuscript, ParsedParagraph, ParsedScene } from "@/lib/types";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";

const CHAPTER_HEADING =
  /^(chapter|kapitel)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b[:.\-\s]*(.*)$/i;
const STANDALONE_NUMBER = /^([0-9]{1,3}|[ivxlcdm]{1,8})[.)]?$/i;
const NAMED_FRONT_BACK = /^(prologue|prolog|epilogue|epilog)$/i;
const SCENE_BREAK = /^(\*{3,}|#{1,3}|-{3,}|~{3,}|\u00a7)$/;
const EPUB_SECTION_HEADING = /^#{1,3}\s+(.+)$/;
const FALLBACK_CHAPTER_WORDS = 6000;

type ParagraphBlock = {
  text: string;
  offset: number;
};

export function parseManuscriptText(rawText: string, sourceFileName: string): ParsedManuscript {
  const normalized = normalizeWhitespace(rawText);
  const blocks = splitParagraphBlocks(normalized);
  const title = detectTitle(blocks, sourceFileName);
  const chapterStarts = findChapterStarts(blocks);
  const chapters = buildChapters(blocks, chapterStarts);
  const wordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const paragraphCount = chapters.reduce(
    (sum, chapter) =>
      sum +
      chapter.scenes.reduce((sceneSum, scene) => sceneSum + scene.paragraphs.length, 0),
    0
  );

  return {
    title,
    normalizedText: normalized,
    wordCount,
    paragraphCount,
    chapters,
    metadata: {
      parserVersion: "mvp-2",
      sourceFileName,
      chapterDetection:
        "chapter/kapitel/numeric/roman/prologue/epilogue/epub-section/fallback-length"
    }
  };
}

function splitParagraphBlocks(text: string): ParagraphBlock[] {
  const blocks: ParagraphBlock[] = [];
  const matches = text.matchAll(/(?:^|\n{2,})([\s\S]*?)(?=\n{2,}|$)/g);

  for (const match of matches) {
    const paragraph = match[1]?.trim();
    if (!paragraph) {
      continue;
    }

    blocks.push({
      text: normalizeParagraphBlockText(paragraph),
      offset: match.index ?? 0
    });
  }

  if (blocks.length === 0 && text.trim()) {
    blocks.push({ text: text.trim(), offset: 0 });
  }

  return blocks;
}

function normalizeParagraphBlockText(paragraph: string) {
  const trimmed = paragraph.trim();
  if (looksLikeVerseBlock(trimmed)) {
    return trimmed
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return trimmed.replace(/\n+/g, " ").trim();
}

function looksLikeVerseBlock(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return false;
  }

  const wordCounts = lines.map((line) => countWords(line));
  const shortLines = wordCounts.filter((words) => words > 0 && words <= 8).length;
  const avgWords =
    wordCounts.reduce((sum, words) => sum + words, 0) / Math.max(1, wordCounts.length);

  return shortLines / lines.length >= 0.65 && avgWords <= 8;
}

function detectTitle(blocks: ParagraphBlock[], sourceFileName: string) {
  const firstUseful = blocks.find((block) => {
    const words = countWords(block.text);
    return words > 0 && words <= 14 && !isChapterHeading(block.text);
  });

  if (firstUseful) {
    return firstUseful.text;
  }

  return sourceFileName.replace(/\.(docx|txt)$/i, "").replace(/[_-]+/g, " ");
}

function findChapterStarts(blocks: ParagraphBlock[]) {
  const epubStarts = blocks
    .map((block, index) => (EPUB_SECTION_HEADING.test(block.text.trim()) ? index : -1))
    .filter((index) => index >= 0);

  if (epubStarts.length > 0) {
    if (epubStarts[0] > 0) {
      epubStarts.unshift(0);
    }
    return epubStarts;
  }

  const starts: number[] = [];

  blocks.forEach((block, index) => {
    if (isChapterHeading(block.text, index)) {
      starts.push(index);
    }
  });

  if (starts.length === 0) {
    return fallbackChapterStarts(blocks);
  }

  if (starts[0] > 0) {
    starts.unshift(0);
  }

  return starts;
}

function isChapterHeading(text: string, index = 0) {
  const trimmed = text.trim();
  const wordCount = countWords(trimmed);

  if (wordCount > 16 || trimmed.length > 120) {
    return false;
  }

  if (CHAPTER_HEADING.test(trimmed) || NAMED_FRONT_BACK.test(trimmed)) {
    return true;
  }

  if (EPUB_SECTION_HEADING.test(trimmed)) {
    return true;
  }

  if (index > 0 && STANDALONE_NUMBER.test(trimmed)) {
    return true;
  }

  if (index > 0 && looksLikeStandaloneHeading(trimmed, wordCount)) {
    return true;
  }

  return false;
}

function looksLikeStandaloneHeading(text: string, wordCount: number) {
  if (wordCount === 0 || wordCount > 10 || /[.!?]$/.test(text)) {
    return false;
  }

  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4) {
    return false;
  }

  const uppercaseLetters = letters.replace(/[^\p{Lu}]/gu, "").length;
  const uppercaseRatio = uppercaseLetters / letters.length;
  const startsWithCapital = /^[\p{Lu}\d]/u.test(text);

  return uppercaseRatio > 0.7 || startsWithCapital;
}

function buildChapters(blocks: ParagraphBlock[], starts: number[]): ParsedChapter[] {
  let globalParagraphOrder = 0;

  return starts.map((start, chapterIndex) => {
    const end = starts[chapterIndex + 1] ?? blocks.length;
    const headingBlock = blocks[start];
    const hasExplicitHeading = isChapterHeading(headingBlock.text, start);
    const contentStart = hasExplicitHeading ? start + 1 : start;
    const chapterBlocks = blocks.slice(contentStart, end);
    const title = hasExplicitHeading
      ? chapterTitleFromHeading(headingBlock.text)
      : starts.length === 1
        ? "Manuscript"
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
      heading: hasExplicitHeading ? headingBlock.text : undefined,
      wordCount,
      startOffset: blocks[start]?.offset,
      endOffset: blocks[end - 1]?.offset,
      scenes
    };
  });
}

function fallbackChapterStarts(blocks: ParagraphBlock[]) {
  if (blocks.length === 0) {
    return [0];
  }

  const starts = [0];
  let pendingWords = 0;

  blocks.forEach((block, index) => {
    pendingWords += countWords(block.text);
    if (index > 0 && pendingWords >= FALLBACK_CHAPTER_WORDS) {
      starts.push(index + 1);
      pendingWords = 0;
    }
  });

  return starts.filter((start) => start < blocks.length);
}

function chapterTitleFromHeading(text: string) {
  return text.replace(EPUB_SECTION_HEADING, "$1").trim();
}

function buildScenes(
  blocks: ParagraphBlock[],
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
    if (SCENE_BREAK.test(block.text.trim())) {
      flushScene(block.text.trim());
      continue;
    }

    const paragraph: ParsedParagraph = {
      text: block.text,
      wordCount: countWords(block.text),
      globalOrder,
      chapterOrder: chapterParagraphOrder,
      sceneOrder: sceneParagraphOrder,
      approximateOffset: block.offset
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
