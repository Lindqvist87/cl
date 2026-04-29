import type { RightsStatus } from "@prisma/client";
import type { ProfileMetrics } from "@/lib/analysis/textMetrics";
import { canUseForCorpusBenchmark } from "@/lib/corpus/rights";
import { jsonInput } from "@/lib/json";
import { countWords } from "@/lib/text/wordCount";
import type { ParsedManuscript } from "@/lib/types";

export function chaptersForProfile(parsed: ParsedManuscript) {
  return parsed.chapters.map((chapter) => ({
    title: chapter.title,
    text: chapter.scenes
      .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
      .join("\n\n"),
    wordCount: chapter.wordCount
  }));
}

export function chapterMetrics(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const dialogueParagraphs = paragraphs.filter((paragraph) =>
    /^["\u201c\u201d'\\-]/.test(paragraph)
  ).length;

  return {
    wordCount: countWords(text),
    paragraphCount: paragraphs.length,
    dialogueParagraphRatio:
      paragraphs.length > 0
        ? Math.round((dialogueParagraphs / paragraphs.length) * 1000) / 1000
        : 0
  };
}

export function profileDataFromMetrics(profile: ProfileMetrics) {
  return {
    wordCount: profile.wordCount,
    chapterCount: profile.chapterCount,
    avgChapterWords: profile.avgChapterWords,
    medianChapterWords: profile.medianChapterWords,
    minChapterWords: profile.minChapterWords,
    maxChapterWords: profile.maxChapterWords,
    avgSentenceLength: profile.avgSentenceLength,
    dialogueRatio: profile.dialogueRatio,
    questionRatio: profile.questionRatio,
    exclamationRatio: profile.exclamationRatio,
    expositionRatio: profile.expositionRatio,
    actionRatio: profile.actionRatio,
    introspectionRatio: profile.introspectionRatio,
    lexicalDensity: profile.lexicalDensity,
    paragraphLengthDistribution: jsonInput(profile.paragraphLengthDistribution),
    sentenceLengthDistribution: jsonInput(profile.sentenceLengthDistribution),
    repeatedTerms: jsonInput(profile.repeatedTerms),
    chapterLengthCurve: jsonInput(profile.chapterLengthCurve),
    povEstimate: profile.povEstimate,
    tenseEstimate: profile.tenseEstimate,
    openingHookType: profile.openingHookType,
    pacingCurve: jsonInput(profile.pacingCurve),
    emotionalIntensityCurve: jsonInput(profile.emotionalIntensityCurve),
    conflictDensityCurve: jsonInput(profile.conflictDensityCurve),
    chapterEndingPatterns: jsonInput(profile.chapterEndingPatterns),
    dominantSceneModes: jsonInput(profile.dominantSceneModes),
    narrativeDistance: profile.narrativeDistance,
    styleFingerprint: jsonInput(profile.styleFingerprint),
    dialogueStyle: jsonInput(profile.dialogueStyle),
    expositionStyle: jsonInput(profile.expositionStyle),
    genreMarkers: jsonInput(profile.genreMarkers),
    tropeMarkers: jsonInput(profile.tropeMarkers),
    literaryCraftLessons: jsonInput(profile.literaryCraftLessons),
    deterministicMetrics: jsonInput(profile.deterministicMetrics),
    aiMetrics: jsonInput(profile.aiMetrics)
  };
}

export function corpusBenchmarkReady(input: {
  rightsStatus: RightsStatus | string;
  allowedUses?: unknown;
  benchmarkAllowed: boolean;
  profileExists: boolean;
  chunkCount: number;
}) {
  return (
    input.benchmarkAllowed &&
    input.profileExists &&
    input.chunkCount > 0 &&
    canUseForCorpusBenchmark({
      rightsStatus: input.rightsStatus,
      allowedUses: input.allowedUses
    })
  );
}
