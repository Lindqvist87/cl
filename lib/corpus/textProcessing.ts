import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import { countWords, estimateTokensFromWords, normalizeWhitespace } from "@/lib/text/wordCount";

export function cleanGutenbergText(input: string) {
  const normalized = normalizeWhitespace(input);
  const startMatch = normalized.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  const withoutHeader = startMatch
    ? normalized.slice((startMatch.index ?? 0) + startMatch[0].length)
    : normalized;
  const endMatch = withoutHeader.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*/i);
  const endIndex = endMatch?.index;

  return normalizeWhitespace(
    typeof endIndex === "number" ? withoutHeader.slice(0, endIndex) : withoutHeader
  );
}

export function chunkCorpusText(text: string, maxWords = 1000) {
  const paragraphs = normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: Array<{
    chunkIndex: number;
    paragraphIndex: number;
    text: string;
    tokenCount: number;
  }> = [];
  let pending: string[] = [];
  let pendingWords = 0;
  let firstParagraphIndex = 0;

  const flush = () => {
    if (pending.length === 0) {
      return;
    }

    const chunkText = pending.join("\n\n");
    const wordCount = countWords(chunkText);
    chunks.push({
      chunkIndex: chunks.length,
      paragraphIndex: firstParagraphIndex,
      text: chunkText,
      tokenCount: estimateTokensFromWords(wordCount)
    });
    pending = [];
    pendingWords = 0;
  };

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const wordCount = countWords(paragraph);

    if (pending.length === 0) {
      firstParagraphIndex = paragraphIndex;
    }

    if (pendingWords + wordCount > maxWords) {
      flush();
      firstParagraphIndex = paragraphIndex;
    }

    pending.push(paragraph);
    pendingWords += wordCount;
  });

  flush();

  return chunks;
}

export function profileText(title: string, text: string) {
  return calculateProfileMetrics([
    {
      title,
      text,
      wordCount: countWords(text)
    }
  ]);
}
