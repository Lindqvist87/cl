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
  medianChapterWords: number;
  minChapterWords: number;
  maxChapterWords: number;
  avgSentenceLength: number;
  dialogueRatio: number;
  questionRatio: number;
  exclamationRatio: number;
  expositionRatio: number;
  actionRatio: number;
  introspectionRatio: number;
  lexicalDensity: number;
  paragraphLengthDistribution: Record<string, unknown>;
  sentenceLengthDistribution: Record<string, unknown>;
  repeatedTerms: Array<Record<string, unknown>>;
  chapterLengthCurve: Array<Record<string, unknown>>;
  povEstimate: string;
  tenseEstimate: string;
  openingHookType: string;
  pacingCurve: Array<Record<string, unknown>>;
  emotionalIntensityCurve: Array<Record<string, unknown>>;
  conflictDensityCurve: Array<Record<string, unknown>>;
  chapterEndingPatterns: Array<Record<string, unknown>>;
  dominantSceneModes: Array<Record<string, unknown>>;
  narrativeDistance: string;
  styleFingerprint: Record<string, unknown>;
  dialogueStyle: Record<string, unknown>;
  expositionStyle: Record<string, unknown>;
  genreMarkers: Record<string, unknown>;
  tropeMarkers: Record<string, unknown>;
  literaryCraftLessons: Array<string>;
  deterministicMetrics: Record<string, unknown>;
  aiMetrics: Record<string, unknown>;
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
  const sentenceWordCounts = sentences.map(countWords).filter((count) => count > 0);
  const paragraphs = splitParagraphs(allText);
  const paragraphWordCounts = paragraphs.map(countWords).filter((count) => count > 0);
  const chapterWordCounts = normalized.map((chapter) => chapter.wordCount);
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
  const avgSentenceLength = round(sentences.length > 0 ? wordCount / sentences.length : 0);
  const dialogueRatio = ratio(dialogueWords, wordCount);
  const actionRatio = ratio(actionWords, wordCount);
  const introspectionRatio = ratio(introspectionWords, wordCount);
  const expositionRatio = ratio(expositionWords, wordCount);
  const chapterLengthCurve = normalized.map((chapter, index) => ({
    chapterIndex: index + 1,
    title: chapter.title,
    wordCount: chapter.wordCount,
    relativeLength:
      wordCount > 0 && chapterCount > 0
        ? round(chapter.wordCount / Math.max(1, wordCount / chapterCount))
        : 0
  }));
  const pacingCurve = normalized.map((chapter, index) => ({
    chapterIndex: index + 1,
    title: chapter.title,
    wordCount: chapter.wordCount,
    tokenEstimate: estimateTokensFromWords(chapter.wordCount),
    actionRatio: ratio(countMatches(wordsFor(chapter.text), ACTION_WORDS), chapter.wordCount),
    dialogueRatio: ratio(countDialogueWords(chapter.text), chapter.wordCount)
  }));
  const emotionalIntensityCurve = normalized.map((chapter, index) => ({
    chapterIndex: index + 1,
    score: ratio(countMatches(wordsFor(chapter.text), EMOTION_WORDS), chapter.wordCount)
  }));
  const conflictDensityCurve = normalized.map((chapter, index) => ({
    chapterIndex: index + 1,
    score: ratio(countMatches(wordsFor(chapter.text), CONFLICT_WORDS), chapter.wordCount)
  }));
  const chapterEndingPatterns = normalized.map((chapter, index) => ({
    chapterIndex: index + 1,
    endingType: estimateEndingType(chapter.text)
  }));
  const styleFingerprint = {
    avgSentenceLength,
    dialogueRatio,
    lexicalDensity: ratio(uniqueWords.size, words.length),
    sentenceCount: sentences.length,
    paragraphMedianWords: median(paragraphWordCounts),
    repeatedTermCount: repeatedTerms(lowerWords).length
  };
  const dialogueStyle = estimateDialogueStyle(allText, dialogueRatio);
  const expositionStyle = estimateExpositionStyle(avgSentenceLength, expositionRatio);
  const dominantSceneModes = [
    { mode: "dialogue", ratio: dialogueRatio },
    { mode: "action", ratio: actionRatio },
    { mode: "introspection", ratio: introspectionRatio },
    { mode: "exposition", ratio: expositionRatio }
  ].sort((a, b) => b.ratio - a.ratio);
  const deterministicMetrics = {
    wordCount,
    chapterCount,
    avgChapterWords: chapterCount > 0 ? Math.round(wordCount / chapterCount) : 0,
    medianChapterWords: median(chapterWordCounts),
    minChapterWords: min(chapterWordCounts),
    maxChapterWords: max(chapterWordCounts),
    paragraphLengthDistribution: distribution(paragraphWordCounts),
    sentenceLengthDistribution: distribution(sentenceWordCounts),
    dialogueRatio,
    questionRatio: ratio(countSentenceEndings(allText, "?"), sentences.length),
    exclamationRatio: ratio(countSentenceEndings(allText, "!"), sentences.length),
    expositionRatio,
    actionRatio,
    introspectionRatio,
    repeatedTerms: repeatedTerms(lowerWords),
    chapterLengthCurve
  };
  const aiMetrics = {
    povEstimate: estimatePov(lowerWords),
    tenseEstimate: estimateTense(lowerWords),
    openingHookType: estimateOpeningHook(normalized[0]?.text ?? ""),
    pacingCurve,
    emotionalIntensityCurve,
    conflictDensityCurve,
    chapterEndingPatterns,
    dominantSceneModes,
    narrativeDistance: estimateNarrativeDistance(lowerWords, dialogueRatio),
    styleFingerprint,
    dialogueStyle,
    expositionStyle,
    genreMarkers: {
      conflictDensity: ratio(conflictWords, wordCount),
      emotionalIntensity: ratio(emotionWords, wordCount)
    },
    tropeMarkers: {},
    literaryCraftLessons: craftLessons({
      dialogueRatio,
      actionRatio,
      introspectionRatio,
      expositionRatio,
      avgSentenceLength
    })
  };

  return {
    wordCount,
    chapterCount,
    avgChapterWords: chapterCount > 0 ? Math.round(wordCount / chapterCount) : 0,
    medianChapterWords: median(chapterWordCounts),
    minChapterWords: min(chapterWordCounts),
    maxChapterWords: max(chapterWordCounts),
    avgSentenceLength,
    dialogueRatio,
    questionRatio: ratio(countSentenceEndings(allText, "?"), sentences.length),
    exclamationRatio: ratio(countSentenceEndings(allText, "!"), sentences.length),
    expositionRatio,
    actionRatio,
    introspectionRatio,
    lexicalDensity: ratio(uniqueWords.size, words.length),
    paragraphLengthDistribution: distribution(paragraphWordCounts),
    sentenceLengthDistribution: distribution(sentenceWordCounts),
    repeatedTerms: repeatedTerms(lowerWords),
    chapterLengthCurve,
    povEstimate: estimatePov(lowerWords),
    tenseEstimate: estimateTense(lowerWords),
    openingHookType: estimateOpeningHook(normalized[0]?.text ?? ""),
    pacingCurve,
    emotionalIntensityCurve,
    conflictDensityCurve,
    chapterEndingPatterns,
    dominantSceneModes,
    narrativeDistance: estimateNarrativeDistance(lowerWords, dialogueRatio),
    styleFingerprint,
    dialogueStyle,
    expositionStyle,
    genreMarkers: {
      conflictDensity: ratio(conflictWords, wordCount),
      emotionalIntensity: ratio(emotionWords, wordCount)
    },
    tropeMarkers: {},
    literaryCraftLessons: aiMetrics.literaryCraftLessons as string[],
    deterministicMetrics,
    aiMetrics
  };
}

function splitSentences(text: string) {
  return text.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function splitParagraphs(text: string) {
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
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

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function min(values: number[]) {
  return values.length > 0 ? Math.min(...values) : 0;
}

function max(values: number[]) {
  return values.length > 0 ? Math.max(...values) : 0;
}

function distribution(values: number[]) {
  return {
    count: values.length,
    min: min(values),
    p25: percentile(values, 0.25),
    median: median(values),
    p75: percentile(values, 0.75),
    max: max(values),
    average:
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : 0
  };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * percentileValue))
  );
  return sorted[index];
}

function repeatedTerms(words: string[]) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "that",
    "with",
    "was",
    "were",
    "this",
    "have",
    "from",
    "you",
    "your",
    "but",
    "not",
    "och",
    "det",
    "att",
    "som",
    "hon",
    "han",
    "var",
    "med"
  ]);
  const counts = new Map<string, number>();

  for (const word of words) {
    if (word.length < 4 || stopWords.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));
}

function countSentenceEndings(text: string, mark: "?" | "!") {
  return text.split(mark).length - 1;
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

function estimateNarrativeDistance(words: string[], dialogueRatio: number) {
  const interiority = countMatches(words, INTROSPECTION_WORDS);
  if (dialogueRatio > 0.35) return "close, scene-forward";
  if (interiority / Math.max(1, words.length) > 0.02) return "close interior";
  return "moderate/observational";
}

function estimateDialogueStyle(text: string, dialogueRatio: number) {
  const dialogue = text.match(/["\u201c][^"\u201d]+["\u201d]/g) ?? [];
  const questionLines = dialogue.filter((line) => line.includes("?")).length;
  return {
    ratio: dialogueRatio,
    lineCount: dialogue.length,
    averageDialogueWords:
      dialogue.length > 0
        ? Math.round(dialogue.reduce((sum, line) => sum + countWords(line), 0) / dialogue.length)
        : 0,
    questionShare: ratio(questionLines, dialogue.length),
    mode: dialogueRatio > 0.25 ? "dialogue-forward" : "dialogue-sparse"
  };
}

function estimateExpositionStyle(avgSentenceLength: number, expositionRatio: number) {
  return {
    ratio: expositionRatio,
    sentenceTexture:
      avgSentenceLength > 24
        ? "long reflective sentences"
        : avgSentenceLength < 12
          ? "compressed sentences"
          : "moderate sentence length",
    density: expositionRatio > 0.75 ? "high" : expositionRatio > 0.55 ? "moderate" : "low"
  };
}

function craftLessons(input: {
  dialogueRatio: number;
  actionRatio: number;
  introspectionRatio: number;
  expositionRatio: number;
  avgSentenceLength: number;
}) {
  const lessons: string[] = [];

  if (input.dialogueRatio > 0.25) {
    lessons.push("Sustained dialogue can carry pace when scene goals remain clear.");
  }
  if (input.expositionRatio > 0.7) {
    lessons.push("Atmospheric exposition needs early promise signals to keep narrative pressure alive.");
  }
  if (input.actionRatio > input.introspectionRatio) {
    lessons.push("External movement can create a visible tempo curve across chapters.");
  } else {
    lessons.push("Interior movement can function as plot when desire, fear, and choice are legible.");
  }
  if (input.avgSentenceLength > 22) {
    lessons.push("Long sentence textures benefit from periodic short sentences at turns and chapter endings.");
  }

  return lessons;
}
