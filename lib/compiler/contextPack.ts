import { AnalysisPassType } from "@prisma/client";
import { hashJson } from "@/lib/compiler/hash";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { countWords, truncateWords } from "@/lib/text/wordCount";

export type ContextPackPurpose =
  | "chapter_audit"
  | "chapter_rewrite"
  | "next_best_action"
  | "continuity_check";

export type ChapterContextPackInput = {
  manuscriptId: string;
  chapterId: string;
  purpose: ContextPackPurpose;
  persist?: boolean;
};

export async function buildChapterContextPack(input: ChapterContextPackInput) {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: input.manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      profile: true
    }
  });
  const chapter = manuscript.chapters.find(
    (candidate) => candidate.id === input.chapterId
  );

  if (!chapter) {
    throw new Error("Chapter not found for context pack.");
  }

  const previousChapter = manuscript.chapters
    .filter((candidate) => candidate.order < chapter.order)
    .at(-1);
  const nextChapter = manuscript.chapters.find(
    (candidate) => candidate.order > chapter.order
  );
  const [
    chapterCapsule,
    previousCapsule,
    nextCapsule,
    wholeBookMap,
    facts,
    characterStates,
    plotEvents,
    styleFingerprint,
    continuityRisks,
    corpusOutput
  ] = await Promise.all([
    latestArtifact(input.manuscriptId, "CHAPTER_CAPSULE", chapter.id),
    previousChapter
      ? latestArtifact(input.manuscriptId, "CHAPTER_CAPSULE", previousChapter.id)
      : null,
    nextChapter
      ? latestArtifact(input.manuscriptId, "CHAPTER_CAPSULE", nextChapter.id)
      : null,
    latestArtifact(input.manuscriptId, "WHOLE_BOOK_MAP"),
    prisma.narrativeFact.findMany({
      where: {
        manuscriptId: input.manuscriptId,
        status: { in: ["ACTIVE", "UNCERTAIN"] },
        OR: [{ chapterId: chapter.id }, { chapterId: previousChapter?.id }]
      },
      take: 120
    }),
    prisma.characterState.findMany({
      where: {
        manuscriptId: input.manuscriptId,
        OR: [{ chapterId: chapter.id }, { chapterId: previousChapter?.id }]
      },
      take: 80
    }),
    prisma.plotEvent.findMany({
      where: {
        manuscriptId: input.manuscriptId,
        OR: [{ chapterId: chapter.id }, { chapterId: previousChapter?.id }]
      },
      take: 80
    }),
    prisma.styleFingerprint.findFirst({
      where: { manuscriptId: input.manuscriptId, chapterId: chapter.id },
      orderBy: { createdAt: "desc" }
    }),
    prisma.finding.findMany({
      where: {
        manuscriptId: input.manuscriptId,
        chapterId: chapter.id,
        issueType: { contains: "continuity", mode: "insensitive" }
      },
      take: 40
    }),
    prisma.analysisOutput.findFirst({
      where: {
        manuscriptId: input.manuscriptId,
        passType: AnalysisPassType.CORPUS_COMPARISON,
        scopeType: "manuscript"
      },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const pack = {
    purpose: input.purpose,
    manuscript: {
      id: manuscript.id,
      title: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      wordCount: manuscript.wordCount,
      chapterCount: manuscript.chapterCount
    },
    chapter: {
      id: chapter.id,
      title: chapter.title,
      chapterIndex: chapter.chapterIndex || chapter.order,
      wordCount: chapter.wordCount,
      rawText: boundedChapterText(chapter.text)
    },
    adjacentChapters: {
      previous: previousChapter
        ? {
            id: previousChapter.id,
            title: previousChapter.title,
            capsule: previousCapsule?.output ?? null
          }
        : null,
      next: nextChapter
        ? {
            id: nextChapter.id,
            title: nextChapter.title,
            capsule: nextCapsule?.output ?? null
          }
        : null
    },
    chapterCapsule: chapterCapsule?.output ?? null,
    wholeBookMapSummary: summarizeWholeBookMap(wholeBookMap?.output),
    relevantFacts: facts.map((fact) => ({
      factType: fact.factType,
      subject: fact.subject,
      factText: fact.factText,
      status: fact.status,
      confidence: fact.confidence
    })),
    characterStates: characterStates.map((state) => ({
      characterName: state.characterName,
      canonicalName: state.canonicalName,
      emotionalState: state.emotionalState,
      goals: state.goals,
      knowledge: state.knowledge,
      relationships: state.relationships,
      confidence: state.confidence
    })),
    plotEvents: plotEvents.map((event) => ({
      eventText: event.eventText,
      consequence: event.consequence,
      opensThread: event.opensThread,
      closesThread: event.closesThread,
      stakes: event.stakes,
      confidence: event.confidence
    })),
    unresolvedContinuityRisks: continuityRisks.map((finding) => ({
      issueType: finding.issueType,
      severity: finding.severity,
      problem: finding.problem,
      recommendation: finding.recommendation
    })),
    voiceAndStyle: {
      styleFingerprint,
      manuscriptProfile: manuscript.profile
        ? {
            dialogueRatio: manuscript.profile.dialogueRatio,
            avgSentenceLength: manuscript.profile.avgSentenceLength,
            povEstimate: manuscript.profile.povEstimate,
            tenseEstimate: manuscript.profile.tenseEstimate,
            narrativeDistance: manuscript.profile.narrativeDistance,
            styleFingerprint: manuscript.profile.styleFingerprint
          }
        : null
    },
    corpusComparisonNotes: summarizeCorpusOutput(corpusOutput?.output),
    estimate: {
      characterCount: chapter.text.length,
      chapterWordCount: countWords(chapter.text),
      includesWholeManuscriptRawText: false
    }
  };

  if (input.persist !== false) {
    await prisma.compilerArtifact.upsert({
      where: {
        manuscriptId_artifactType_inputHash: {
          manuscriptId: input.manuscriptId,
          artifactType: "CONTEXT_PACK",
          inputHash: hashJson(pack)
        }
      },
      create: {
        manuscriptId: input.manuscriptId,
        chapterId: chapter.id,
        artifactType: "CONTEXT_PACK",
        model: "system",
        reasoningEffort: "none",
        promptVersion: "compiler-v1",
        inputHash: hashJson(pack),
        output: jsonInput(pack),
        rawText: JSON.stringify(pack)
      },
      update: {
        output: jsonInput(pack),
        rawText: JSON.stringify(pack),
        status: "COMPLETED",
        error: null
      }
    });
  }

  return pack;
}

async function latestArtifact(
  manuscriptId: string,
  artifactType: string,
  chapterId?: string
) {
  return prisma.compilerArtifact.findFirst({
    where: {
      manuscriptId,
      artifactType,
      ...(chapterId ? { chapterId } : {})
    },
    orderBy: { createdAt: "desc" }
  });
}

function boundedChapterText(text: string) {
  return truncateWords(text, 2500);
}

function summarizeWholeBookMap(value: unknown) {
  const record = toRecord(value);
  return {
    bookPremise: record.bookPremise,
    whatTheBookIsTryingToBe: record.whatTheBookIsTryingToBe,
    mainArc: record.mainArc,
    continuityRiskMap: record.continuityRiskMap,
    revisionStrategy: record.revisionStrategy,
    uncertainties: record.uncertainties
  };
}

function summarizeCorpusOutput(value: unknown) {
  const record = toRecord(value);
  return {
    summary: record.summary,
    benchmarkNotes: record.benchmarkNotes,
    rewritePatternNotes: record.rewritePatternNotes,
    marketOpportunity: record.marketOpportunity,
    marketRisk: record.marketRisk
  };
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
