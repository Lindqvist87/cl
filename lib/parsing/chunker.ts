import type { ParsedChunk, ParsedManuscript, ParsedParagraph } from "@/lib/types";
import { estimateTokensFromWords } from "@/lib/text/wordCount";

const DEFAULT_MAX_WORDS = 1200;

export function chunkParsedManuscript(
  manuscript: ParsedManuscript,
  maxWords = DEFAULT_MAX_WORDS
): ParsedChunk[] {
  const chunks: ParsedChunk[] = [];
  let chunkIndex = 0;

  for (const chapter of manuscript.chapters) {
    for (const scene of chapter.scenes) {
      let pending: ParsedParagraph[] = [];
      let pendingWords = 0;

      const flush = () => {
        if (pending.length === 0) {
          return;
        }

        const text = pending.map((paragraph) => paragraph.text).join("\n\n");
        const wordCount = pending.reduce(
          (sum, paragraph) => sum + paragraph.wordCount,
          0
        );

        chunks.push({
          chunkIndex,
          chapterOrder: chapter.order,
          sceneOrder: scene.order,
          text,
          wordCount,
          tokenEstimate: estimateTokensFromWords(wordCount),
          startParagraph: pending[0].globalOrder,
          endParagraph: pending[pending.length - 1].globalOrder,
          metadata: {
            chapterTitle: chapter.title,
            sceneTitle: scene.title,
            paragraphCount: pending.length
          }
        });

        chunkIndex += 1;
        pending = [];
        pendingWords = 0;
      };

      for (const paragraph of scene.paragraphs) {
        if (paragraph.wordCount > maxWords) {
          flush();
          chunkLongParagraph(paragraph, maxWords).forEach((chunkText) => {
            const wordCount = chunkText.split(/\s+/).filter(Boolean).length;
            chunks.push({
              chunkIndex,
              chapterOrder: chapter.order,
              sceneOrder: scene.order,
              text: chunkText,
              wordCount,
              tokenEstimate: estimateTokensFromWords(wordCount),
              startParagraph: paragraph.globalOrder,
              endParagraph: paragraph.globalOrder,
              metadata: {
                chapterTitle: chapter.title,
                sceneTitle: scene.title,
                paragraphCount: 1,
                splitLongParagraph: true
              }
            });
            chunkIndex += 1;
          });
          continue;
        }

        if (pendingWords + paragraph.wordCount > maxWords) {
          flush();
        }

        pending.push(paragraph);
        pendingWords += paragraph.wordCount;
      }

      flush();
    }
  }

  return chunks;
}

function chunkLongParagraph(paragraph: ParsedParagraph, maxWords: number) {
  const words = paragraph.text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];

  for (let index = 0; index < words.length; index += maxWords) {
    parts.push(words.slice(index, index + maxWords).join(" "));
  }

  return parts;
}
