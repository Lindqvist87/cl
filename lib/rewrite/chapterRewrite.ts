import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType
} from "@prisma/client";
import type {
  ChapterRewrite,
  ManuscriptChapter,
  ManuscriptChunk,
  RewritePlan
} from "@prisma/client";
import { rewriteChapter } from "@/lib/ai/chapterRewriter";
import type { ChapterRewriteResult } from "@/lib/ai/analysisTypes";
import { EDITOR_PROMPT_VERSION } from "@/lib/ai/editorModel";
import {
  aggregateUsageLogs,
  withAiUsage,
  type AiUsageLog
} from "@/lib/ai/usage";
import { buildChapterContextPack } from "@/lib/compiler/contextPack";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import {
  buildContinuityLedger,
  latestAcceptedRewriteByChapter,
  previousChapterContexts,
  summarizeRewriteText,
  type RewriteForContinuity
} from "@/lib/rewrite/continuity";
import { countWords } from "@/lib/text/wordCount";
import type { JsonRecord } from "@/lib/types";

type DraftChapterRewriteInput = {
  manuscriptId: string;
  chapterId: string;
  runId: string;
  rewritePlanId: string;
  forceNewVersion?: boolean;
};

type DraftChapterRewriteResult = {
  rewrite: ChapterRewrite;
  created: boolean;
};

type RewriteSection = {
  id: string;
  scopeId: string;
  chunkId?: string;
  chunkIndex?: number;
  sectionIndex: number;
  totalSections: number;
  text: string;
  wordCount: number;
};

export async function regenerateChapterRewrite(
  manuscriptId: string,
  chapterId: string
) {
  const run = await prisma.analysisRun.findFirst({
    where: {
      manuscriptId,
      type: AnalysisRunType.FULL_AUDIT,
      status: AnalysisRunStatus.COMPLETED
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }]
  });

  if (!run) {
    throw new Error("Run the full manuscript pipeline before regenerating a chapter.");
  }

  const rewritePlan = await prisma.rewritePlan.findFirst({
    where: {
      manuscriptId,
      analysisRunId: run.id
    },
    orderBy: { createdAt: "desc" }
  });

  if (!rewritePlan) {
    throw new Error("A rewrite plan is required before regenerating a chapter.");
  }

  await prisma.chapterRewrite.updateMany({
    where: {
      manuscriptId,
      chapterId,
      status: "DRAFT"
    },
    data: { status: "REJECTED" }
  });

  return draftChapterRewrite({
    manuscriptId,
    chapterId,
    runId: run.id,
    rewritePlanId: rewritePlan.id,
    forceNewVersion: true
  });
}

export async function rewriteFirstChapter(manuscriptId: string) {
  const chapter = await prisma.manuscriptChapter.findFirst({
    where: { manuscriptId },
    orderBy: { order: "asc" }
  });

  if (!chapter) {
    throw new Error("No first chapter found.");
  }

  return regenerateChapterRewrite(manuscriptId, chapter.id);
}

export async function draftChapterRewrite(
  input: DraftChapterRewriteInput
): Promise<DraftChapterRewriteResult> {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: input.manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      chunks: { orderBy: { chunkIndex: "asc" } }
    }
  });
  const chapter = manuscript.chapters.find(
    (candidate) => candidate.id === input.chapterId
  );

  if (!chapter) {
    throw new Error("Chapter not found for this manuscript.");
  }

  const rewritePlan = await prisma.rewritePlan.findFirstOrThrow({
    where: {
      id: input.rewritePlanId,
      manuscriptId: input.manuscriptId,
      analysisRunId: input.runId
    }
  });

  if (!input.forceNewVersion) {
    const existing = await prisma.chapterRewrite.findFirst({
      where: {
        manuscriptId: input.manuscriptId,
        chapterId: input.chapterId,
        rewritePlanId: rewritePlan.id,
        status: { in: ["DRAFT", "ACCEPTED"] }
      },
      orderBy: { createdAt: "desc" }
    });

    if (existing) {
      await ensureChapterRewriteOutput(existing, input.runId);
      return { rewrite: existing, created: false };
    }
  }

  const acceptedByChapter = await acceptedRewriteMapForManuscript(
    input.manuscriptId
  );
  const previousContexts = previousChapterContexts(
    manuscript.chapters,
    chapter.order,
    acceptedByChapter
  );
  const continuityLedger = buildContinuityLedger({
    continuityRules: rewritePlan.continuityRules,
    previousChapters: previousContexts
  });
  const sections = chapterRewriteSections(
    chapter,
    manuscript.chunks.filter((chunk) => chunk.chapterId === chapter.id)
  );
  const chapterAudit = await prisma.analysisOutput.findFirst({
    where: {
      manuscriptId: input.manuscriptId,
      runId: input.runId,
      chapterId: chapter.id,
      passType: AnalysisPassType.CHAPTER_AUDIT
    },
    orderBy: { createdAt: "desc" }
  });
  const corpusPatternNotes = await rewriteCorpusPatternNotes(
    input.runId,
    input.manuscriptId
  );
  const compilerContextPack = await safeChapterContextPack({
    manuscriptId: input.manuscriptId,
    chapterId: chapter.id
  });

  const rewrittenParts: string[] = [];
  const sectionResults: ChapterRewriteResult[] = [];
  const usageLogs: AiUsageLog[] = [];
  const previousSectionSummaries: Array<{
    sectionIndex: number;
    summary?: string;
  }> = [];

  for (const section of sections) {
    const existingOutput = await findRewriteOutput(
      input.runId,
      "chapter_chunk",
      section.scopeId
    );
    const result = existingOutput
      ? {
          json: toChapterRewriteResult(existingOutput.output),
          rawText: existingOutput.rawText ?? "",
          model: existingOutput.model,
          usage: usageFromInputSummary(existingOutput.inputSummary)
        }
      : await rewriteChapter({
          manuscriptTitle: manuscript.title,
          targetGenre: manuscript.targetGenre,
          targetAudience: manuscript.targetAudience,
          chapterTitle: chapter.title,
          chapterIndex: chapter.chapterIndex || chapter.order,
          originalChapter: section.text,
          chapterAnalysis: chapterAudit?.output,
          globalRewritePlan: globalRewritePlanForPrompt(rewritePlan),
          previousChapterSummaries: previousContexts,
          previousSectionSummaries,
          continuityRules: continuityLedger,
          corpusPatternNotes,
          contextPack: compilerContextPack,
          rewriteScope: {
            type: "chunk",
            sectionIndex: section.sectionIndex,
            totalSections: section.totalSections,
            chunkIndex: section.chunkIndex
          }
        });

    if (!existingOutput) {
      await saveRewriteOutput({
        runId: input.runId,
        manuscriptId: input.manuscriptId,
        scopeType: "chapter_chunk",
        scopeId: section.scopeId,
        chunkId: section.chunkId,
        chapterId: chapter.id,
        model: result.model,
        output: result.json,
        rawText: result.rawText,
        usage: result.usage,
        inputSummary: {
          chapterTitle: chapter.title,
          sectionIndex: section.sectionIndex,
          totalSections: section.totalSections,
          chunkIndex: section.chunkIndex,
          wordCount: section.wordCount,
          previousCanonChapterCount: continuityLedger.acceptedCanonChapterCount,
          corpusPatternNoteCount: corpusPatternNotes.length,
          contextPackAvailable: Boolean(compilerContextPack),
          corpusPayloadPolicy: "summarized_patterns_only_no_full_books"
        }
      });
    }

    rewrittenParts.push(result.json.rewrittenChapter);
    sectionResults.push(result.json);
    if (result.usage) {
      usageLogs.push(result.usage);
    }
    previousSectionSummaries.push({
      sectionIndex: section.sectionIndex,
      summary: summarizeRewriteText(result.json.rewrittenChapter)
    });
  }

  const rewrittenText = rewrittenParts.join("\n\n");
  const outputModel = usageLogs[0]?.model ?? "stub";
  const finalUsage = aggregateUsageLogs(outputModel, usageLogs);
  const finalJson = finalRewriteJson({
    rewrittenText,
    sectionResults,
    continuityLedger,
    sections
  });
  const version = await nextRewriteVersion(input.manuscriptId, chapter.id);
  const rewrite = await prisma.chapterRewrite.create({
    data: {
      manuscriptId: input.manuscriptId,
      chapterId: chapter.id,
      runId: input.runId,
      rewritePlanId: rewritePlan.id,
      version,
      originalText: chapter.text,
      rewrittenText,
      content: rewrittenText,
      changeLog: jsonInput(finalJson.changeLog),
      continuityNotes: jsonInput(finalJson.continuityNotes),
      rationale: jsonInput({
        inventedFactsWarnings: finalJson.inventedFactsWarnings,
        nextChapterImplications: finalJson.nextChapterImplications,
        usage: finalUsage
      }),
      status: "DRAFT",
      promptVersion: EDITOR_PROMPT_VERSION,
      model: outputModel,
      sourceSummary: jsonInput({
        source: sections.length > 1 ? "chunked" : "single-section",
        sectionCount: sections.length,
        originalWordCount: countWords(chapter.text),
        previousCanonChapterCount: continuityLedger.acceptedCanonChapterCount,
        corpusPatternNoteCount: corpusPatternNotes.length,
        contextPackAvailable: Boolean(compilerContextPack),
        corpusPayloadPolicy: "summarized_patterns_only_no_full_books"
      })
    }
  });

  await saveRewriteOutput({
    runId: input.runId,
    manuscriptId: input.manuscriptId,
    scopeType: "chapter",
    scopeId: chapter.id,
    chapterId: chapter.id,
    model: rewrite.model,
    output: finalJson,
    rawText: JSON.stringify(finalJson),
    usage: finalUsage,
    inputSummary: {
      chapterTitle: chapter.title,
      sectionCount: sections.length,
      originalWordCount: countWords(chapter.text),
      previousCanonChapterCount: continuityLedger.acceptedCanonChapterCount,
      contextPackAvailable: Boolean(compilerContextPack)
    }
  });

  return { rewrite, created: true };
}

async function safeChapterContextPack(input: {
  manuscriptId: string;
  chapterId: string;
}) {
  try {
    return await buildChapterContextPack({
      manuscriptId: input.manuscriptId,
      chapterId: input.chapterId,
      purpose: "chapter_rewrite"
    });
  } catch {
    return null;
  }
}

async function ensureChapterRewriteOutput(rewrite: ChapterRewrite, runId: string) {
  const existing = await findRewriteOutput(runId, "chapter", rewrite.chapterId);
  if (existing) {
    return;
  }

  await saveRewriteOutput({
    runId,
    manuscriptId: rewrite.manuscriptId,
    scopeType: "chapter",
    scopeId: rewrite.chapterId,
    chapterId: rewrite.chapterId,
    model: rewrite.model,
    output: {
      rewrittenChapter: rewrite.rewrittenText || rewrite.content,
      changeLog: rewrite.changeLog ?? [],
      continuityNotes: rewrite.continuityNotes ?? {},
      inventedFactsWarnings: [],
      nextChapterImplications: []
    },
    rawText: rewrite.rewrittenText || rewrite.content,
    inputSummary: {
      chapterRewriteId: rewrite.id,
      recoveredFromExistingRewrite: true
    }
  });
}

async function acceptedRewriteMapForManuscript(manuscriptId: string) {
  const accepted = await prisma.chapterRewrite.findMany({
    where: {
      manuscriptId,
      status: "ACCEPTED"
    },
    orderBy: { createdAt: "desc" }
  });

  return latestAcceptedRewriteByChapter(
    accepted.map((rewrite) => rewrite as RewriteForContinuity)
  );
}

function chapterRewriteSections(
  chapter: ManuscriptChapter,
  chunks: ManuscriptChunk[]
): RewriteSection[] {
  const sourceChunks = chunks.length > 0 ? chunks : undefined;

  if (!sourceChunks) {
    return [
      {
        id: chapter.id,
        scopeId: `${chapter.id}:chapter`,
        sectionIndex: 1,
        totalSections: 1,
        text: chapter.text,
        wordCount: countWords(chapter.text)
      }
    ];
  }

  return sourceChunks.map((chunk, index) => ({
    id: chunk.id,
    scopeId: chunk.id,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    sectionIndex: index + 1,
    totalSections: sourceChunks.length,
    text: chunk.text,
    wordCount: chunk.wordCount || countWords(chunk.text)
  }));
}

function finalRewriteJson(input: {
  rewrittenText: string;
  sectionResults: ChapterRewriteResult[];
  continuityLedger: ReturnType<typeof buildContinuityLedger>;
  sections: RewriteSection[];
}): ChapterRewriteResult & JsonRecord {
  return {
    rewrittenChapter: input.rewrittenText,
    changeLog: input.sectionResults.flatMap((result, index) =>
      result.changeLog.map((change) => ({
        sectionIndex: input.sections[index]?.sectionIndex,
        ...change
      }))
    ),
    continuityNotes: {
      ledger: input.continuityLedger,
      sections: input.sectionResults.map((result, index) => ({
        sectionIndex: input.sections[index]?.sectionIndex,
        continuityNotes: result.continuityNotes
      }))
    },
    corpusInfluence: {
      patternsUsed: uniqueStrings(
        input.sectionResults.flatMap(
          (result) => result.corpusInfluence?.patternsUsed ?? []
        )
      ),
      changed: uniqueStrings(
        input.sectionResults.flatMap(
          (result) => result.corpusInfluence?.changed ?? []
        )
      ),
      preserved: uniqueStrings(
        input.sectionResults.flatMap(
          (result) => result.corpusInfluence?.preserved ?? []
        )
      ),
      risksIntroduced: uniqueStrings(
        input.sectionResults.flatMap(
          (result) => result.corpusInfluence?.risksIntroduced ?? []
        )
      )
    },
    inventedFactsWarnings: input.sectionResults.flatMap(
      (result) => result.inventedFactsWarnings
    ),
    nextChapterImplications: input.sectionResults.flatMap(
      (result) => result.nextChapterImplications
    ),
    sectionCount: input.sections.length
  };
}

function globalRewritePlanForPrompt(rewritePlan: RewritePlan) {
  return {
    globalStrategy: rewritePlan.globalStrategy,
    chapterPlans: rewritePlan.chapterPlans,
    styleRules: rewritePlan.styleRules,
    marketPositioning: rewritePlan.marketPositioning
  };
}

async function nextRewriteVersion(manuscriptId: string, chapterId: string) {
  const aggregate = await prisma.chapterRewrite.aggregate({
    where: { manuscriptId, chapterId },
    _max: { version: true }
  });

  return (aggregate._max.version ?? 0) + 1;
}

async function findRewriteOutput(
  runId: string,
  scopeType: string,
  scopeId: string
) {
  return prisma.analysisOutput.findUnique({
    where: {
      runId_passType_scopeType_scopeId: {
        runId,
        passType: AnalysisPassType.CHAPTER_REWRITE,
        scopeType,
        scopeId
      }
    }
  });
}

async function saveRewriteOutput(input: {
  runId: string;
  manuscriptId: string;
  scopeType: string;
  scopeId: string;
  model: string;
  output: unknown;
  rawText: string;
  inputSummary?: Record<string, unknown>;
  usage?: AiUsageLog;
  chunkId?: string;
  chapterId?: string;
}) {
  await prisma.analysisOutput.upsert({
    where: {
      runId_passType_scopeType_scopeId: {
        runId: input.runId,
        passType: AnalysisPassType.CHAPTER_REWRITE,
        scopeType: input.scopeType,
        scopeId: input.scopeId
      }
    },
    create: {
      runId: input.runId,
      manuscriptId: input.manuscriptId,
      passType: AnalysisPassType.CHAPTER_REWRITE,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      chunkId: input.chunkId,
      chapterId: input.chapterId,
      promptVersion: EDITOR_PROMPT_VERSION,
      model: input.model,
      inputSummary: jsonInput(withAiUsage(input.inputSummary ?? {}, input.usage)),
      output: jsonInput(input.output),
      rawText: input.rawText
    },
    update: {
      model: input.model,
      inputSummary: jsonInput(withAiUsage(input.inputSummary ?? {}, input.usage)),
      output: jsonInput(input.output),
      rawText: input.rawText
    }
  });
}

function toChapterRewriteResult(value: unknown): ChapterRewriteResult {
  const record = toJsonRecord(value);

  return {
    rewrittenChapter: String(record.rewrittenChapter ?? ""),
    changeLog: Array.isArray(record.changeLog)
      ? (record.changeLog as Array<Record<string, unknown>>)
      : [],
    continuityNotes: toJsonRecord(record.continuityNotes),
    corpusInfluence: normalizeCorpusInfluence(record.corpusInfluence),
    inventedFactsWarnings: stringArray(record.inventedFactsWarnings),
    nextChapterImplications: stringArray(record.nextChapterImplications)
  };
}

async function rewriteCorpusPatternNotes(runId: string, manuscriptId: string) {
  const corpusOutput = await prisma.analysisOutput.findUnique({
    where: {
      runId_passType_scopeType_scopeId: {
        runId,
        passType: AnalysisPassType.CORPUS_COMPARISON,
        scopeType: "manuscript",
        scopeId: manuscriptId
      }
    }
  });
  const output = toJsonRecord(corpusOutput?.output);
  const notes = [
    ...stringArray(output.rewritePatternNotes),
    ...stringArray(output.patternSuggestions),
    ...stringArray(output.riskyDivergences).map((note) => `Risk to watch: ${note}`),
    ...stringArray(output.benchmarkNotes)
  ];

  return uniqueStrings(notes)
    .slice(0, 8)
    .map((note) => ({
      pattern: truncatePatternNote(note),
      source: "Corpus BookProfile comparison",
      suggestedUse:
        "Use as a craft pattern for structure, tempo, or emphasis; do not imitate source text."
    }));
}

function truncatePatternNote(note: string) {
  const words = note.split(/\s+/).filter(Boolean);
  return words.length > 40 ? `${words.slice(0, 40).join(" ")}...` : note;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function usageFromInputSummary(value: unknown) {
  const record = toJsonRecord(value);
  const usage = record.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }

  return usage as AiUsageLog;
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeCorpusInfluence(value: unknown) {
  const record = toJsonRecord(value);
  return {
    patternsUsed: stringArray(record.patternsUsed),
    changed: stringArray(record.changed),
    preserved: stringArray(record.preserved),
    risksIntroduced: stringArray(record.risksIntroduced)
  };
}
