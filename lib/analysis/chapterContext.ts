import { countWords } from "@/lib/text/wordCount";

export type BoundedChapterContext = {
  text: string;
  sourceWordCount: number;
  contextWordCount: number;
  omittedWordCount: number;
  strategy: "full" | "opening-ending-excerpt";
};

const DEFAULT_MAX_CONTEXT_WORDS = 1600;

export function buildBoundedChapterContext(
  text: string,
  maxWords = DEFAULT_MAX_CONTEXT_WORDS
): BoundedChapterContext {
  const words = splitWords(text);
  const sourceWordCount = words.length;

  if (sourceWordCount <= maxWords) {
    return {
      text,
      sourceWordCount,
      contextWordCount: sourceWordCount,
      omittedWordCount: 0,
      strategy: "full"
    };
  }

  const openingWordCount = Math.ceil(maxWords * 0.55);
  const endingWordCount = Math.max(0, maxWords - openingWordCount);
  const opening = words.slice(0, openingWordCount).join(" ");
  const ending = words.slice(sourceWordCount - endingWordCount).join(" ");
  const omittedWordCount = Math.max(
    0,
    sourceWordCount - openingWordCount - endingWordCount
  );
  const boundedText = [
    opening,
    `[${omittedWordCount.toLocaleString()} words omitted; use chunk summaries for the middle of the chapter.]`,
    ending
  ].join("\n\n");

  return {
    text: boundedText,
    sourceWordCount,
    contextWordCount: countWords(boundedText),
    omittedWordCount,
    strategy: "opening-ending-excerpt"
  };
}

function splitWords(text: string) {
  return text.split(/\s+/).filter(Boolean);
}
