import { countWords, estimateTokensFromWords } from "@/lib/text/wordCount";

type ChapterLike = {
  title: string;
  text: string;
  wordCount?: number;
};

export type ProfileMetrics = {
  wordCount: number;
  chapterCount: number;
  avgChapterWords: number;
  avgSentenceLength: number;
  dialogueRatio: number;
  expositionRatio: number;
  actionRatio: number;
  introspectionRatio: number;
  lexicalDensity: number;
  povEstimate: string;
  tenseEstimate: string;
  openingHookType: string;
  pacingCurve: Array<Record<string, unknown>>;
  emotionalIntensityCurve: Array<Record<string, unknown>>;
  conflictDensityCurve: Array<Record<string, unknown>>;
  chapterEndingPatterns: Array<Record<string, unknown>>;
  styleFingerprint: Record<string, unknown>;
  genreMarkers: Record<string, unknown>;
  tropeMarkers: Record<string, unknown>;
};

const ACTION_WORDS = [
  "ran",
  "run",
  "grabbed",
  "hit",
  "opened",
  "closed",
  "turned",
  "pulled",
  "pushed",
  "fought",
  "fell",
  "started",
  "stopped"
];

const INTROSPECTION_WORDS = [
  "thought",
  "felt",
  "remembered",
  "wondered",
  "feared",
  "hoped",
  "knew",
  "realized",
  "wanted",
  "needed"
];

const CONFLICT_WORDS = [
  "but",
  "however",
  "threat",
  "danger",
  "argued",
  "fight",
  "wrong",
  "secret",
  "refused",
  "lost"
];

const EMOTION_WORDS = [
  "love",
  "fear",
  "angry",
  "grief",
  "joy",
  "shame",
  "hope",
  "panic",
  "sad",
  "alone"
];

export function calculateProfileMetrics(chapters: ChapterLike[]): ProfileMetrics {
  const normalized = chapters.map((chapter) => ({
    ...chapter,
    wordCount: chapter.wordCount ?? countWords(chapter.text)
  }));
  const allText = normalized.map((chapter) => chapter.text).join("\n\n");
  const wordCount = normalized.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const chapterCount = normalized.length;
  const sentences = splitSentences(allText);
  const words = allText.match(/[\p{L}\p{N}'\u2019-]+/gu) ?? [];
  const lowerWords = words.map((word) => word.toLowerCase());
  const uniqueWords = new Set(lowerWords);
  const dialogueWords = countDialogueWords(allText);
  const actionWords = countMatches(lowerWords, ACTION_WORDS);
  const introspectionWords = countMatches(lowerWords, INTROSPECTION_WORDS);
  const conflictWords = countMatches(lowerWords, CONFLICT_WORDS);
  const emotionWords = countMatches(lowerWords, EMOTION_WORDS);
  const expositionWords = Math.max(
    0,
    wordCount - dialogueWords - actionWords - introspectionWords
  );

  return {
    wordCount,
    chapterCount,
    avgChapterWords: chapterCount > 0 ? Math.round(wordCount / chapterCount) : 0,
    avgSentenceLength: round(sentences.length > 0 ? wordCount / sentences.length : 0),
    dialogueRatio: ratio(dialogueWords, wordCount),
    expositionRatio: ratio(expositionWords, wordCount),
    actionRatio: ratio(actionWords, wordCount),
    introspectionRatio: ratio(introspectionWords, wordCount),
    lexicalDensity: ratio(uniqueWords.size, words.length),
    povEstimate: estimatePov(lowerWords),
    tenseEstimate: estimateTense(lowerWords),
    openingHookType: estimateOpeningHook(normalized[0]?.text ?? ""),
    pacingCurve: normalized.map((chapter, index) => ({
      chapterIndex: index + 1,
      title: chapter.title,
      wordCount: chapter.wordCount,
      tokenEstimate: estimateTokensFromWords(chapter.wordCount),
      actionRatio: ratio(countMatches(wordsFor(chapter.text), ACTION_WORDS), chapter.wordCount),
      dialogueRatio: ratio(countDialogueWords(chapter.text), chapter.wordCount)
    })),
    emotionalIntensityCurve: normalized.map((chapter, index) => ({
      chapterIndex: index + 1,
      score: ratio(countMatches(wordsFor(chapter.text), EMOTION_WORDS), chapter.wordCount)
    })),
    conflictDensityCurve: normalized.map((chapter, index) => ({
      chapterIndex: index + 1,
      score: ratio(countMatches(wordsFor(chapter.text), CONFLICT_WORDS), chapter.wordCount)
    })),
    chapterEndingPatterns: normalized.map((chapter, index) => ({
      chapterIndex: index + 1,
      endingType: estimateEndingType(chapter.text)
    })),
    styleFingerprint: {
      avgSentenceLength: round(sentences.length > 0 ? wordCount / sentences.length : 0),
      dialogueRatio: ratio(dialogueWords, wordCount),
      lexicalDensity: ratio(uniqueWords.size, words.length),
      sentenceCount: sentences.length
    },
    genreMarkers: {
      conflictDensity: ratio(conflictWords, wordCount),
      emotionalIntensity: ratio(emotionWords, wordCount)
    },
    tropeMarkers: {}
  };
}

function splitSentences(text: string) {
  return text.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function countDialogueWords(text: string) {
  const dialogue = text.match(/["\u201c][^"\u201d]+["\u201d]/g) ?? [];
  return dialogue.reduce((sum, phrase) => sum + countWords(phrase), 0);
}

function countMatches(words: string[], dictionary: string[]) {
  const set = new Set(dictionary);
  return words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0);
}

function wordsFor(text: string) {
  return (text.match(/[\p{L}\p{N}'\u2019-]+/gu) ?? []).map((word) =>
    word.toLowerCase()
  );
}

function ratio(part: number, whole: number) {
  return whole > 0 ? round(part / whole) : 0;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function estimatePov(words: string[]) {
  const firstPerson = words.filter((word) => ["i", "me", "my", "we", "our"].includes(word)).length;
  const thirdPerson = words.filter((word) => ["he", "she", "they", "his", "her"].includes(word)).length;
  return firstPerson > thirdPerson ? "first-person" : "third-person/unknown";
}

function estimateTense(words: string[]) {
  const present = words.filter((word) => ["is", "are", "has", "have", "goes"].includes(word)).length;
  const past = words.filter((word) => ["was", "were", "had", "went", "said"].includes(word)).length;
  return present > past ? "present/unknown" : "past/unknown";
}

function estimateOpeningHook(text: string) {
  const firstSentence = splitSentences(text)[0] ?? "";
  if (/[?]$/.test(firstSentence)) return "question";
  if (/(blood|dead|danger|secret|never|last)\b/i.test(firstSentence)) return "threat";
  if (/["\u201c]/.test(firstSentence)) return "dialogue";
  if (countWords(firstSentence) < 12) return "compressed-image";
  return "contextual";
}

function estimateEndingType(text: string) {
  const sentences = splitSentences(text);
  const last = sentences[sentences.length - 1] ?? "";
  if (/\?$/.test(last)) return "question";
  if (/(but|until|suddenly|never|secret|gone|dead)\b/i.test(last)) return "cliffhanger";
  if (/(knew|realized|understood|decided)\b/i.test(last)) return "realization";
  return "soft-close";
}
