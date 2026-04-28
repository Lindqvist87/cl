export function normalizeWhitespace(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function countWords(input: string) {
  const words = input.match(/[\p{L}\p{N}'\u2019\u2013-]+/gu);
  return words?.length ?? 0;
}

export function estimateTokensFromWords(wordCount: number) {
  return Math.ceil(wordCount * 1.35);
}

export function truncateWords(input: string, maxWords: number) {
  const words = input.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return input;
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}
