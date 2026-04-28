import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType,
  AnalysisStatus
} from "@prisma/client";
import { analyzeChapter } from "@/lib/ai/chapterAnalyzer";
import { rewriteChapter } from "@/lib/ai/chapterRewriter";
import { analyzeManuscriptChunk } from "@/lib/ai/chunkAnalyzer";
import { compareCorpus } from "@/lib/ai/corpusComparator";
import {
  createEmbedding,
  EDITOR_PROMPT_VERSION,
  getEditorModel,
  hasEditorModelKey
} from "@/lib/ai/editorModel";
import type {
  ChapterAnalysisResult,
  ChunkAnalysisResult,
  CorpusComparisonResult,
  FindingDraft,
  TrendComparisonResult,
  WholeBookAnalysisResult
} from "@/lib/ai/analysisTypes";
import { planRewrite } from "@/lib/ai/rewritePlanner";
import { compareTrends } from "@/lib/ai/trendComparator";
import { analyzeWholeBook } from "@/lib/ai/wholeBookAnalyzer";
import { auditReportToMarkdown } from "@/lib/analysis/report";
import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import { jsonInput } from "@/lib/json";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  isStepComplete,
  markStepComplete,
  markStepStarted,
  normalizeCheckpoint,
  type ManuscriptPipelineStep,
  type PipelineCheckpoint
} from "@/lib/pipeline/steps";
import { prisma } from "@/lib/prisma";
import { countWords, estimateTokensFromWords } from "@/lib/text/wordCount";
import type { AuditReportJson, IssueSeverity, JsonRecord } from "@/lib/types";

export async function runFullManuscriptPipeline(manuscriptId: string) {
  const run = await findOrCreatePipelineRun(manuscriptId);
  let checkpoint = normalizeCheckpoint(run.checkpoint);

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      status: "PIPELINE_RUNNING",
      analysisStatus: AnalysisStatus.RUNNING
    }
  });

  try {
    for (const step of FULL_MANUSCRIPT_PIPELINE_STEPS) {
      if (isStepComplete(checkpoint, step)) {
        continue;
      }

      checkpoint = await persistCheckpoint(run.id, markStepStarted(checkpoint, step));
      const metadata = await runStep(step, manuscriptId, run.id);
      checkpoint = await persistCheckpoint(
        run.id,
        markStepComplete(checkpoint, step, metadata)
      );
    }

    await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: AnalysisRunStatus.COMPLETED,
        completedAt: new Date(),
        currentPass: AnalysisPassType.SYNTHESIS,
        error: null,
        checkpoint: jsonInput(checkpoint)
      }
    });

    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "PIPELINE_COMPLETED",
        analysisStatus: AnalysisStatus.COMPLETED
      }
    });

    return prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Full manuscript pipeline failed.";

    await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: AnalysisRunStatus.FAILED,
        error: message,
        checkpoint: jsonInput(checkpoint)
      }
    });

    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "PIPELINE_FAILED",
        analysisStatus: AnalysisStatus.FAILED
      }
    });

    throw error;
  }
}

async function findOrCreatePipelineRun(manuscriptId: string) {
  const activeRun = await prisma.analysisRun.findFirst({
    where: {
      manuscriptId,
      type: AnalysisRunType.FULL_AUDIT,
      status: {
        in: [
          AnalysisRunStatus.QUEUED,
          AnalysisRunStatus.RUNNING,
          AnalysisRunStatus.FAILED
        ]
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (activeRun) {
    return prisma.analysisRun.update({
      where: { id: activeRun.id },
      data: {
        status: AnalysisRunStatus.RUNNING,
        model: getEditorModel(),
        error: null,
        metadata: jsonInput({
          pipelineVersion: "v2",
          steps: FULL_MANUSCRIPT_PIPELINE_STEPS
        })
      }
    });
  }

  return prisma.analysisRun.create({
    data: {
      manuscriptId,
      type: AnalysisRunType.FULL_AUDIT,
      status: AnalysisRunStatus.RUNNING,
      model: getEditorModel(),
      checkpoint: jsonInput({ completedSteps: [] }),
      metadata: jsonInput({
        pipelineVersion: "v2",
        steps: FULL_MANUSCRIPT_PIPELINE_STEPS
      })
    }
  });
}

async function persistCheckpoint(runId: string, checkpoint: PipelineCheckpoint) {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: {
      checkpoint: jsonInput(checkpoint),
      currentPass: passTypeForStep(checkpoint.currentStep)
    }
  });

  return checkpoint;
}

async function runStep(
  step: ManuscriptPipelineStep,
  manuscriptId: string,
  runId: string
) {
  switch (step) {
    case "parseAndNormalizeManuscript":
      return parseAndNormalizeManuscript(manuscriptId);
    case "splitIntoChapters":
      return splitIntoChapters(manuscriptId);
    case "splitIntoChunks":
      return splitIntoChunks(manuscriptId);
    case "createEmbeddingsForChunks":
      return createEmbeddingsForChunks(manuscriptId);
    case "summarizeChunks":
      return summarizeChunks(manuscriptId, runId);
    case "summarizeChapters":
      return summarizeChapters(manuscriptId);
    case "createManuscriptProfile":
      return createManuscriptProfile(manuscriptId);
    case "runChapterAudits":
      return runChapterAudits(manuscriptId, runId);
    case "runWholeBookAudit":
      return runWholeBookAudit(manuscriptId, runId);
    case "compareAgainstCorpus":
      return compareAgainstCorpus(manuscriptId, runId);
    case "compareAgainstTrendSignals":
      return compareAgainstTrendSignals(manuscriptId, runId);
    case "createRewritePlan":
      return createRewritePlan(manuscriptId, runId);
    case "generateChapterRewriteDrafts":
      return generateChapterRewriteDrafts(manuscriptId, runId);
  }
}

async function parseAndNormalizeManuscript(manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1
      }
    }
  });

  if (!manuscript) {
    throw new Error("Manuscript not found.");
  }

  const originalText = manuscript.originalText ?? manuscript.versions[0]?.sourceText;
  if (!originalText) {
    throw new Error("Manuscript has no stored source text.");
  }

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      originalText,
      status: "PARSED"
    }
  });

  return {
    wordCount: manuscript.wordCount,
    hasOriginalText: true
  };
}

async function splitIntoChapters(manuscriptId: string) {
  const chapters = await prisma.manuscriptChapter.findMany({
    where: { manuscriptId },
    orderBy: { order: "asc" },
    include: {
      paragraphs: {
        orderBy: { chapterOrder: "asc" }
      }
    }
  });

  if (chapters.length === 0) {
    throw new Error("No chapters found. Re-upload the manuscript to parse chapters.");
  }

  for (const chapter of chapters) {
    const text =
      chapter.text ||
      chapter.paragraphs.map((paragraph) => paragraph.text).join("\n\n");

    await prisma.manuscriptChapter.update({
      where: { id: chapter.id },
      data: {
        chapterIndex: chapter.chapterIndex || chapter.order,
        text,
        wordCount: chapter.wordCount || countWords(text),
        status: "CHAPTER_READY"
      }
    });
  }

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      chapterCount: chapters.length,
      status: "CHAPTERS_READY"
    }
  });

  return { chapterCount: chapters.length };
}

async function splitIntoChunks(manuscriptId: string) {
  const chunks = await prisma.manuscriptChunk.findMany({
    where: { manuscriptId },
    orderBy: { chunkIndex: "asc" }
  });

  if (chunks.length === 0) {
    throw new Error("No manuscript chunks found. Re-upload the manuscript to create chunks.");
  }

  for (const chunk of chunks) {
    const wordCount = chunk.wordCount || countWords(chunk.text);
    const tokenCount = chunk.tokenCount || chunk.tokenEstimate || estimateTokensFromWords(wordCount);

    await prisma.manuscriptChunk.update({
      where: { id: chunk.id },
      data: {
        paragraphStart: chunk.paragraphStart ?? chunk.startParagraph,
        paragraphEnd: chunk.paragraphEnd ?? chunk.endParagraph,
        wordCount,
        tokenCount,
        tokenEstimate: chunk.tokenEstimate || tokenCount
      }
    });
  }

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      chunkCount: chunks.length,
      status: "CHUNKS_READY"
    }
  });

  return { chunkCount: chunks.length };
}

async function createEmbeddingsForChunks(manuscriptId: string) {
  const chunks = await prisma.manuscriptChunk.findMany({
    where: { manuscriptId },
    orderBy: { chunkIndex: "asc" }
  });

  let stored = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    const metrics = toJsonRecord(chunk.localMetrics);
    if (
      metrics.embeddingStatus === "stored" ||
      (metrics.embeddingStatus === "skipped" && !hasEditorModelKey())
    ) {
      skipped += 1;
      continue;
    }

    if (!hasEditorModelKey()) {
      await prisma.manuscriptChunk.update({
        where: { id: chunk.id },
        data: {
          localMetrics: jsonInput({
            ...metrics,
            embeddingStatus: "skipped",
            embeddingReason: "OPENAI_API_KEY not configured"
          })
        }
      });
      skipped += 1;
      continue;
    }

    const embedding = await createEmbedding(chunk.text);
    if (embedding.length > 0) {
      await storeManuscriptChunkEmbedding(chunk.id, embedding);
      stored += 1;
    }

    await prisma.manuscriptChunk.update({
      where: { id: chunk.id },
      data: {
        localMetrics: jsonInput({
          ...metrics,
          embeddingStatus: embedding.length > 0 ? "stored" : "empty",
          embeddingModel: "text-embedding-3-small"
        })
      }
    });
  }

  return { stored, skipped };
}

async function summarizeChunks(manuscriptId: string, runId: string) {
  const manuscript = await getPipelineManuscript(manuscriptId);
  let analyzed = 0;

  for (const chunk of manuscript.chunks) {
    const existing = await findOutput(runId, AnalysisPassType.CHUNK_ANALYSIS, "chunk", chunk.id);
    if (existing) {
      continue;
    }

    const result = await analyzeManuscriptChunk({
      manuscriptTitle: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      chapterTitle: chunk.chapter.title,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text
    });

    await saveOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.CHUNK_ANALYSIS,
      scopeType: "chunk",
      scopeId: chunk.id,
      chunkId: chunk.id,
      chapterId: chunk.chapterId,
      model: result.model,
      output: result.json,
      rawText: result.rawText,
      inputSummary: {
        chunkIndex: chunk.chunkIndex,
        chapterTitle: chunk.chapter.title,
        wordCount: chunk.wordCount
      }
    });

    await prisma.manuscriptChunk.update({
      where: { id: chunk.id },
      data: {
        summary: result.json.summary,
        localMetrics: jsonInput({
          ...toJsonRecord(chunk.localMetrics),
          ...(result.json.metrics ?? {}),
          sceneFunction: result.json.sceneFunction
        })
      }
    });

    await saveFindings({
      runId,
      manuscriptId,
      chapterId: chunk.chapterId,
      chunkId: chunk.id,
      findings: result.json.findings
    });
    analyzed += 1;
  }

  return { analyzed };
}

async function summarizeChapters(manuscriptId: string) {
  const chapters = await prisma.manuscriptChapter.findMany({
    where: { manuscriptId },
    orderBy: { order: "asc" },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" }
      }
    }
  });

  let summarized = 0;

  for (const chapter of chapters) {
    if (chapter.summary) {
      continue;
    }

    const summary =
      chapter.chunks
        .map((chunk) => chunk.summary)
        .filter(Boolean)
        .join(" ")
        .slice(0, 1800) ||
      `${chapter.title}: ${chapter.wordCount.toLocaleString()} words. Chunk summaries pending.`;

    await prisma.manuscriptChapter.update({
      where: { id: chapter.id },
      data: {
        summary,
        status: "SUMMARIZED"
      }
    });
    summarized += 1;
  }

  return { summarized };
}

async function createManuscriptProfile(manuscriptId: string) {
  const existing = await prisma.manuscriptProfile.findUnique({
    where: { manuscriptId }
  });

  if (existing) {
    return { profileId: existing.id, reused: true };
  }

  const chapters = await prisma.manuscriptChapter.findMany({
    where: { manuscriptId },
    orderBy: { order: "asc" }
  });
  const profile = calculateProfileMetrics(
    chapters.map((chapter) => ({
      title: chapter.title,
      text: chapter.text,
      wordCount: chapter.wordCount
    }))
  );

  const created = await prisma.manuscriptProfile.create({
    data: {
      manuscriptId,
      wordCount: profile.wordCount,
      chapterCount: profile.chapterCount,
      avgChapterWords: profile.avgChapterWords,
      avgSentenceLength: profile.avgSentenceLength,
      dialogueRatio: profile.dialogueRatio,
      expositionRatio: profile.expositionRatio,
      actionRatio: profile.actionRatio,
      introspectionRatio: profile.introspectionRatio,
      pacingCurve: jsonInput(profile.pacingCurve),
      emotionalIntensityCurve: jsonInput(profile.emotionalIntensityCurve),
      conflictDensityCurve: jsonInput(profile.conflictDensityCurve),
      styleFingerprint: jsonInput(profile.styleFingerprint),
      genreMarkers: jsonInput(profile.genreMarkers),
      tropeMarkers: jsonInput(profile.tropeMarkers)
    }
  });

  return { profileId: created.id };
}

async function runChapterAudits(manuscriptId: string, runId: string) {
  const manuscript = await getPipelineManuscript(manuscriptId);
  let audited = 0;

  for (const chapter of manuscript.chapters) {
    const existing = await findOutput(runId, AnalysisPassType.CHAPTER_AUDIT, "chapter", chapter.id);
    if (existing) {
      continue;
    }

    const chunkSummaries = manuscript.chunks
      .filter((chunk) => chunk.chapterId === chapter.id)
      .map((chunk) => chunk.summary ?? "")
      .filter(Boolean);
    const result = await analyzeChapter({
      manuscriptTitle: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      chapterTitle: chapter.title,
      chapterIndex: chapter.chapterIndex || chapter.order,
      text: chapter.text,
      chunkSummaries
    });

    await saveOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.CHAPTER_AUDIT,
      scopeType: "chapter",
      scopeId: chapter.id,
      chapterId: chapter.id,
      model: result.model,
      output: result.json,
      rawText: result.rawText,
      inputSummary: {
        chapterTitle: chapter.title,
        wordCount: chapter.wordCount,
        chunkSummaryCount: chunkSummaries.length
      }
    });

    await prisma.manuscriptChapter.update({
      where: { id: chapter.id },
      data: {
        summary: result.json.summary,
        status: "AUDITED"
      }
    });

    await saveFindings({
      runId,
      manuscriptId,
      chapterId: chapter.id,
      findings: result.json.findings
    });
    audited += 1;
  }

  return { audited };
}

async function runWholeBookAudit(manuscriptId: string, runId: string) {
  const existing = await findOutput(
    runId,
    AnalysisPassType.WHOLE_BOOK_AUDIT,
    "manuscript",
    manuscriptId
  );
  if (existing) {
    return { reused: true };
  }

  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      profile: true
    }
  });

  const profile = toJsonRecord(manuscript.profile);
  const result = await analyzeWholeBook({
    manuscriptTitle: manuscript.title,
    targetGenre: manuscript.targetGenre,
    targetAudience: manuscript.targetAudience,
    wordCount: manuscript.wordCount,
    chapterSummaries: manuscript.chapters.map((chapter) => ({
      chapterIndex: chapter.chapterIndex || chapter.order,
      title: chapter.title,
      summary: chapter.summary,
      wordCount: chapter.wordCount
    })),
    profile
  });

  await saveOutput({
    runId,
    manuscriptId,
    passType: AnalysisPassType.WHOLE_BOOK_AUDIT,
    scopeType: "manuscript",
    scopeId: manuscriptId,
    model: result.model,
    output: result.json,
    rawText: result.rawText,
    inputSummary: {
      chapterCount: manuscript.chapters.length,
      profileId: manuscript.profile?.id
    }
  });

  await saveFindings({
    runId,
    manuscriptId,
    findings: result.json.topIssues
  });

  await createAuditReportFromWholeBook({
    manuscriptId,
    runId,
    title: manuscript.title,
    wholeBook: result.json
  });

  return { report: true };
}

async function compareAgainstCorpus(manuscriptId: string, runId: string) {
  const existing = await findOutput(
    runId,
    AnalysisPassType.CORPUS_COMPARISON,
    "manuscript",
    manuscriptId
  );
  if (existing) {
    return { reused: true };
  }

  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: { profile: true }
  });
  const profiles = await prisma.bookProfile.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
    include: { book: true }
  });
  const chunks = await prisma.corpusChunk.findMany({
    take: 12,
    orderBy: { createdAt: "desc" },
    include: { book: true }
  });
  const result = await compareCorpus({
    manuscriptTitle: manuscript.title,
    targetGenre: manuscript.targetGenre,
    manuscriptProfile: toJsonRecord(manuscript.profile),
    benchmarkProfiles: profiles.map((profile) => ({
      title: profile.book.title,
      author: profile.book.author,
      rightsStatus: profile.book.rightsStatus,
      genre: profile.book.genre,
      profile: toJsonRecord(profile)
    })),
    similarChunks: chunks.map((chunk) => ({
      bookTitle: chunk.book.title,
      author: chunk.book.author,
      summary: chunk.summary,
      metrics: chunk.metrics
    }))
  });

  await saveOutput({
    runId,
    manuscriptId,
    passType: AnalysisPassType.CORPUS_COMPARISON,
    scopeType: "manuscript",
    scopeId: manuscriptId,
    model: result.model,
    output: result.json,
    rawText: result.rawText,
    inputSummary: {
      benchmarkProfileCount: profiles.length,
      similarChunkCount: chunks.length
    }
  });

  await saveFindings({
    runId,
    manuscriptId,
    findings: result.json.findings
  });

  return { benchmarkProfileCount: profiles.length };
}

async function compareAgainstTrendSignals(manuscriptId: string, runId: string) {
  const existing = await findOutput(
    runId,
    AnalysisPassType.TREND_COMPARISON,
    "manuscript",
    manuscriptId
  );
  if (existing) {
    return { reused: true };
  }

  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId }
  });
  const where = manuscript.targetGenre
    ? {
        OR: [
          { genre: { contains: manuscript.targetGenre, mode: "insensitive" as const } },
          { category: { contains: manuscript.targetGenre, mode: "insensitive" as const } }
        ]
      }
    : {};
  const signals = await prisma.trendSignal.findMany({
    where,
    take: 50,
    orderBy: [{ signalDate: "desc" }, { createdAt: "desc" }]
  });
  const wholeBookOutput = await findOutput(
    runId,
    AnalysisPassType.WHOLE_BOOK_AUDIT,
    "manuscript",
    manuscriptId
  );
  const wholeBook = toJsonRecord(wholeBookOutput?.output);
  const result = await compareTrends({
    manuscriptTitle: manuscript.title,
    targetGenre: manuscript.targetGenre,
    targetAudience: manuscript.targetAudience,
    wholeBookSummary: String(wholeBook.executiveSummary ?? ""),
    trendSignals: signals
  });

  await saveOutput({
    runId,
    manuscriptId,
    passType: AnalysisPassType.TREND_COMPARISON,
    scopeType: "manuscript",
    scopeId: manuscriptId,
    model: result.model,
    output: result.json,
    rawText: result.rawText,
    inputSummary: {
      signalCount: signals.length,
      targetGenre: manuscript.targetGenre
    }
  });

  await saveFindings({
    runId,
    manuscriptId,
    findings: result.json.findings
  });

  return { signalCount: signals.length };
}

async function createRewritePlan(manuscriptId: string, runId: string) {
  const existing = await prisma.rewritePlan.findFirst({
    where: { manuscriptId, analysisRunId: runId },
    orderBy: { createdAt: "desc" }
  });
  if (existing) {
    return { rewritePlanId: existing.id, reused: true };
  }

  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } }
    }
  });
  const findings = await prisma.finding.findMany({
    where: { manuscriptId, analysisRunId: runId },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    take: 80
  });
  const wholeBook = await findOutput(
    runId,
    AnalysisPassType.WHOLE_BOOK_AUDIT,
    "manuscript",
    manuscriptId
  );
  const corpus = await findOutput(
    runId,
    AnalysisPassType.CORPUS_COMPARISON,
    "manuscript",
    manuscriptId
  );
  const trends = await findOutput(
    runId,
    AnalysisPassType.TREND_COMPARISON,
    "manuscript",
    manuscriptId
  );
  const result = await planRewrite({
    manuscriptTitle: manuscript.title,
    targetGenre: manuscript.targetGenre,
    targetAudience: manuscript.targetAudience,
    wholeBookAudit: wholeBook?.output,
    corpusComparison: corpus?.output,
    trendComparison: trends?.output,
    findings: findings.map((finding) => ({
      issueType: finding.issueType,
      severity: finding.severity,
      problem: finding.problem,
      recommendation: finding.recommendation,
      rewriteInstruction: finding.rewriteInstruction
    })),
    chapters: manuscript.chapters.map((chapter) => ({
      id: chapter.id,
      chapterIndex: chapter.chapterIndex || chapter.order,
      title: chapter.title,
      summary: chapter.summary,
      wordCount: chapter.wordCount
    }))
  });

  await saveOutput({
    runId,
    manuscriptId,
    passType: AnalysisPassType.REWRITE_PLAN,
    scopeType: "manuscript",
    scopeId: manuscriptId,
    model: result.model,
    output: result.json,
    rawText: result.rawText,
    inputSummary: {
      findingCount: findings.length,
      chapterCount: manuscript.chapters.length
    }
  });

  const plan = await prisma.rewritePlan.create({
    data: {
      manuscriptId,
      analysisRunId: runId,
      globalStrategy: result.json.globalStrategy,
      chapterPlans: jsonInput(result.json.chapterPlans),
      continuityRules: jsonInput(result.json.continuityRules),
      styleRules: jsonInput(result.json.styleRules),
      marketPositioning: jsonInput(result.json.marketPositioning)
    }
  });

  await updateAuditReportWithRewriteContext({
    runId,
    globalStrategy: result.json.globalStrategy,
    rewritePlanId: plan.id,
    corpusComparison: corpus?.output,
    trendComparison: trends?.output,
    marketPositioning: result.json.marketPositioning
  });

  return { rewritePlanId: plan.id };
}

async function generateChapterRewriteDrafts(manuscriptId: string, runId: string) {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } }
    }
  });
  const rewritePlan = await prisma.rewritePlan.findFirst({
    where: { manuscriptId, analysisRunId: runId },
    orderBy: { createdAt: "desc" }
  });

  if (!rewritePlan) {
    throw new Error("Rewrite plan must exist before chapter rewrites.");
  }

  let drafted = 0;
  const previousSummaries: Array<{ title: string; summary?: string | null }> = [];

  for (const chapter of manuscript.chapters) {
    const existing = await prisma.chapterRewrite.findFirst({
      where: {
        manuscriptId,
        chapterId: chapter.id,
        rewritePlanId: rewritePlan.id,
        status: { in: ["DRAFT", "ACCEPTED"] }
      }
    });
    if (existing) {
      previousSummaries.push({ title: chapter.title, summary: chapter.summary });
      continue;
    }

    const chapterAudit = await findOutput(
      runId,
      AnalysisPassType.CHAPTER_AUDIT,
      "chapter",
      chapter.id
    );
    const result = await rewriteChapter({
      manuscriptTitle: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      chapterTitle: chapter.title,
      chapterIndex: chapter.chapterIndex || chapter.order,
      originalChapter: chapter.text,
      chapterAnalysis: chapterAudit?.output,
      globalRewritePlan: {
        globalStrategy: rewritePlan.globalStrategy,
        chapterPlans: rewritePlan.chapterPlans,
        styleRules: rewritePlan.styleRules,
        marketPositioning: rewritePlan.marketPositioning
      },
      previousChapterSummaries: previousSummaries,
      continuityRules: rewritePlan.continuityRules
    });

    await saveOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.CHAPTER_REWRITE,
      scopeType: "chapter",
      scopeId: chapter.id,
      chapterId: chapter.id,
      model: result.model,
      output: result.json,
      rawText: result.rawText,
      inputSummary: {
        chapterTitle: chapter.title,
        previousChapterSummaryCount: previousSummaries.length
      }
    });

    await prisma.chapterRewrite.create({
      data: {
        manuscriptId,
        chapterId: chapter.id,
        runId,
        rewritePlanId: rewritePlan.id,
        version: 1,
        originalText: chapter.text,
        rewrittenText: result.json.rewrittenChapter,
        content: result.json.rewrittenChapter,
        changeLog: jsonInput(result.json.changeLog),
        continuityNotes: jsonInput(result.json.continuityNotes),
        rationale: jsonInput({
          inventedFactsWarnings: result.json.inventedFactsWarnings,
          nextChapterImplications: result.json.nextChapterImplications
        }),
        status: "DRAFT",
        promptVersion: EDITOR_PROMPT_VERSION,
        model: result.model
      }
    });

    previousSummaries.push({ title: chapter.title, summary: chapter.summary });
    drafted += 1;
  }

  return { drafted };
}

async function getPipelineManuscript(manuscriptId: string) {
  return prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: {
        orderBy: { order: "asc" }
      },
      chunks: {
        orderBy: { chunkIndex: "asc" },
        include: { chapter: true }
      }
    }
  });
}

async function findOutput(
  runId: string,
  passType: AnalysisPassType,
  scopeType: string,
  scopeId: string
) {
  return prisma.analysisOutput.findUnique({
    where: {
      runId_passType_scopeType_scopeId: {
        runId,
        passType,
        scopeType,
        scopeId
      }
    }
  });
}

async function saveOutput(input: {
  runId: string;
  manuscriptId: string;
  passType: AnalysisPassType;
  scopeType: string;
  scopeId: string;
  model: string;
  output:
    | ChunkAnalysisResult
    | ChapterAnalysisResult
    | WholeBookAnalysisResult
    | CorpusComparisonResult
    | TrendComparisonResult
    | JsonRecord
    | unknown;
  rawText: string;
  inputSummary?: Record<string, unknown>;
  chunkId?: string;
  chapterId?: string;
}) {
  await prisma.analysisOutput.upsert({
    where: {
      runId_passType_scopeType_scopeId: {
        runId: input.runId,
        passType: input.passType,
        scopeType: input.scopeType,
        scopeId: input.scopeId
      }
    },
    create: {
      runId: input.runId,
      manuscriptId: input.manuscriptId,
      passType: input.passType,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      chunkId: input.chunkId,
      chapterId: input.chapterId,
      promptVersion: EDITOR_PROMPT_VERSION,
      model: input.model,
      inputSummary: jsonInput(input.inputSummary ?? {}),
      output: jsonInput(input.output),
      rawText: input.rawText
    },
    update: {
      model: input.model,
      inputSummary: jsonInput(input.inputSummary ?? {}),
      output: jsonInput(input.output),
      rawText: input.rawText
    }
  });
}

async function saveFindings(input: {
  runId: string;
  manuscriptId: string;
  chapterId?: string;
  chunkId?: string;
  findings?: FindingDraft[];
}) {
  const findings = input.findings ?? [];
  if (findings.length === 0) {
    return;
  }

  await prisma.finding.createMany({
    data: findings.map((finding) => ({
      analysisRunId: input.runId,
      manuscriptId: input.manuscriptId,
      chapterId: input.chapterId,
      chunkId: input.chunkId,
      issueType: finding.issueType || "editorial",
      severity: clampInt(finding.severity, 1, 5),
      confidence: clampNumber(finding.confidence, 0, 1),
      problem: finding.problem || "Unspecified issue",
      evidence: finding.evidence,
      recommendation: finding.recommendation || "Review this passage.",
      rewriteInstruction: finding.rewriteInstruction
    }))
  });
}

async function createAuditReportFromWholeBook(input: {
  manuscriptId: string;
  runId: string;
  title: string;
  wholeBook: WholeBookAnalysisResult;
}) {
  const existing = await prisma.auditReport.findUnique({
    where: { runId: input.runId }
  });
  if (existing) {
    return existing;
  }

  const report = wholeBookToAuditReport(input.wholeBook);
  const markdown = auditReportToMarkdown(report, input.title);

  return prisma.auditReport.create({
    data: {
      manuscriptId: input.manuscriptId,
      runId: input.runId,
      executiveSummary: report.executiveSummary,
      topIssues: jsonInput(report.topIssues),
      chapterNotes: jsonInput(report.chapterNotes),
      rewriteStrategy: report.rewriteStrategy,
      structured: jsonInput(report),
      markdown
    }
  });
}

async function updateAuditReportWithRewriteContext(input: {
  runId: string;
  globalStrategy: string;
  rewritePlanId: string;
  corpusComparison?: unknown;
  trendComparison?: unknown;
  marketPositioning: unknown;
}) {
  const report = await prisma.auditReport.findUnique({
    where: { runId: input.runId },
    include: { manuscript: true }
  });

  if (!report) {
    return;
  }

  const structured = toJsonRecord(report.structured) as AuditReportJson;
  const metadata = toJsonRecord(structured.metadata);
  const updatedStructured: AuditReportJson = {
    ...structured,
    rewriteStrategy: input.globalStrategy,
    metadata: {
      ...metadata,
      rewritePlanId: input.rewritePlanId,
      corpusComparison: summarizeComparison(input.corpusComparison),
      trendComparison: summarizeComparison(input.trendComparison),
      marketPositioning: input.marketPositioning
    }
  };

  await prisma.auditReport.update({
    where: { id: report.id },
    data: {
      rewriteStrategy: input.globalStrategy,
      structured: jsonInput(updatedStructured),
      markdown: auditReportToMarkdown(updatedStructured, report.manuscript.title)
    }
  });
}

function wholeBookToAuditReport(wholeBook: WholeBookAnalysisResult): AuditReportJson {
  const topIssues = Array.isArray(wholeBook.topIssues) ? wholeBook.topIssues : [];
  const valueRaisingEdits = Array.isArray(wholeBook.valueRaisingEdits)
    ? wholeBook.valueRaisingEdits
    : [];

  return {
    executiveSummary: wholeBook.executiveSummary,
    topIssues: topIssues.map((issue) => ({
      title: issue.problem,
      severity: severityLabel(issue.severity),
      evidence: issue.evidence,
      recommendation: issue.recommendation
    })),
    chapterNotes: [],
    rewriteStrategy: valueRaisingEdits.join(" "),
    metadata: {
      commercialManuscriptScore: wholeBook.commercialManuscriptScore,
      premise: wholeBook.premise,
      genreFit: wholeBook.genreFit,
      marketFit: wholeBook.marketFit
    }
  };
}

function summarizeComparison(value: unknown) {
  const record = toJsonRecord(value);
  return {
    summary: record.summary,
    signalStrength: record.signalStrength,
    benchmarkNotes: record.benchmarkNotes,
    marketOpportunity: record.marketOpportunity,
    marketRisk: record.marketRisk
  };
}

function severityLabel(severity: number): IssueSeverity {
  if (severity >= 5) return "critical";
  if (severity >= 4) return "high";
  if (severity >= 3) return "medium";
  return "low";
}

function passTypeForStep(step?: string) {
  switch (step) {
    case "summarizeChunks":
      return AnalysisPassType.CHUNK_ANALYSIS;
    case "runChapterAudits":
      return AnalysisPassType.CHAPTER_AUDIT;
    case "runWholeBookAudit":
      return AnalysisPassType.WHOLE_BOOK_AUDIT;
    case "compareAgainstCorpus":
      return AnalysisPassType.CORPUS_COMPARISON;
    case "compareAgainstTrendSignals":
      return AnalysisPassType.TREND_COMPARISON;
    case "createRewritePlan":
      return AnalysisPassType.REWRITE_PLAN;
    case "generateChapterRewriteDrafts":
      return AnalysisPassType.CHAPTER_REWRITE;
    default:
      return undefined;
  }
}

async function storeManuscriptChunkEmbedding(chunkId: string, embedding: number[]) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  await prisma.$executeRawUnsafe(
    'UPDATE "ManuscriptChunk" SET "embedding" = $1::vector WHERE "id" = $2',
    vectorLiteral,
    chunkId
  );
}

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function clampInt(value: number, min: number, max: number) {
  const numeric = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, numeric));
}

function clampNumber(value: number, min: number, max: number) {
  const numeric = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, numeric));
}
