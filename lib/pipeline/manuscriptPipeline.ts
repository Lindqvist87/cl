import {
  AnalysisPassType,
  AnalysisRunStatus,
  AnalysisRunType,
  AnalysisStatus,
  type Prisma
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { analyzeChapter } from "@/lib/ai/chapterAnalyzer";
import { analyzeManuscriptChunk } from "@/lib/ai/chunkAnalyzer";
import {
  buildBoundedCorpusComparisonInput,
  compareCorpus,
  DEFAULT_CORPUS_COMPARISON_LIMITS,
  isCorpusRequestTooLargeError
} from "@/lib/ai/corpusComparator";
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
import { withAiUsage, type AiUsageLog } from "@/lib/ai/usage";
import { buildBoundedChapterContext } from "@/lib/analysis/chapterContext";
import { profileDataFromMetrics } from "@/lib/corpus/bookDna";
import {
  compileChapterCapsules,
  compileSceneDigests,
  compileWholeBookMap,
  createNextBestEditorialActions,
  extractNarrativeMemory
} from "@/lib/compiler/compiler";
import { buildManuscriptNodes } from "@/lib/compiler/nodes";
import { planRewrite } from "@/lib/ai/rewritePlanner";
import { compareTrends } from "@/lib/ai/trendComparator";
import { analyzeWholeBook } from "@/lib/ai/wholeBookAnalyzer";
import { auditReportToMarkdown } from "@/lib/analysis/report";
import { calculateProfileMetrics } from "@/lib/analysis/textMetrics";
import {
  canUseForChunkContext,
  canUseForCorpusBenchmark,
  rightsStatusCounts
} from "@/lib/corpus/rights";
import { jsonInput } from "@/lib/json";
import {
  extractRawEditorialMemoryItems,
  upsertEditorialMemoryItemsFromRawOutput
} from "@/lib/editorialMemory";
import {
  importManifestFromMetadata,
  importManifestToNormalizedText,
  importSignatureFromManifest,
  importSignatureFromMetadata,
  metadataWithImportManifest
} from "@/lib/import/v2/manifest";
import {
  buildImportInvalidationPlan,
  invalidateImportDerivedArtifacts,
  type ImportInvalidationPlan
} from "@/lib/import/v2/invalidation";
import { importManifestToParsedManuscript } from "@/lib/import/v2/adapter";
import { buildTextImportManifest } from "@/lib/import/v2/text";
import type { ImportManifest } from "@/lib/import/v2/types";
import { chunkParsedManuscript } from "@/lib/parsing/chunker";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  isImportCriticalManuscriptPipelineStep,
  isStepComplete,
  markStepComplete,
  markStepStarted,
  normalizeCheckpoint,
  type ManuscriptPipelineStep,
  type PipelineCheckpoint
} from "@/lib/pipeline/steps";
import {
  createLockedAnalysisSnapshot,
  snapshotRunMetadata
} from "@/lib/pipeline/analysisSnapshot";
import { prisma } from "@/lib/prisma";
import { draftChapterRewrite } from "@/lib/rewrite/chapterRewrite";
import { countWords, estimateTokensFromWords } from "@/lib/text/wordCount";
import type {
  AuditReportJson,
  IssueSeverity,
  JsonRecord,
  ParsedChunk,
  ParsedManuscript
} from "@/lib/types";

export type PipelineStepRunOptions = {
  maxItems?: number;
  forceCompilerFallback?: boolean;
  snapshotId?: string | null;
};

export type PipelineStepRunResult = Record<string, unknown> & {
  complete?: boolean;
  remaining?: number;
};

type CorpusComparisonRunner = typeof compareCorpus;

let corpusComparisonRunner: CorpusComparisonRunner = compareCorpus;

export function setCorpusComparisonRunnerForTest(runner: CorpusComparisonRunner) {
  const previous = corpusComparisonRunner;
  corpusComparisonRunner = runner;

  return () => {
    corpusComparisonRunner = previous;
  };
}

export async function runFullManuscriptPipeline(manuscriptId: string) {
  const snapshot = await createLockedAnalysisSnapshot(manuscriptId);
  const run = await findOrCreatePipelineRun(manuscriptId, snapshot.id);
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
      const metadata = await runPipelineStep(step, manuscriptId, run.id, {
        snapshotId: snapshot.id
      });
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

export async function findOrCreatePipelineRun(
  manuscriptId: string,
  snapshotId?: string | null
) {
  const snapshot = snapshotId
    ? await prisma.analysisSnapshot.findUnique({ where: { id: snapshotId } })
    : null;
  const runScope = {
    manuscriptId,
    type: AnalysisRunType.FULL_AUDIT,
    ...(snapshotId ? { snapshotId } : {})
  };
  const activeRun = await prisma.analysisRun.findFirst({
    where: {
      ...runScope,
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
        snapshotId: snapshotId ?? activeRun.snapshotId,
        model: getEditorModel(),
        error: null,
        metadata: jsonInput({
          pipelineVersion: "v2",
          steps: FULL_MANUSCRIPT_PIPELINE_STEPS,
          ...(snapshot ? { snapshot: snapshotRunMetadata(snapshot) } : {})
        })
      }
    });
  }

  const completedRun = await prisma.analysisRun.findFirst({
    where: {
      ...runScope,
      status: AnalysisRunStatus.COMPLETED
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }]
  });

  if (completedRun) {
    return completedRun;
  }

  return prisma.analysisRun.create({
    data: {
      manuscriptId,
      snapshotId: snapshotId ?? undefined,
      type: AnalysisRunType.FULL_AUDIT,
      status: AnalysisRunStatus.RUNNING,
      model: getEditorModel(),
      checkpoint: jsonInput({ completedSteps: [] }),
      metadata: jsonInput({
        pipelineVersion: "v2",
        steps: FULL_MANUSCRIPT_PIPELINE_STEPS,
        ...(snapshot ? { snapshot: snapshotRunMetadata(snapshot) } : {})
      })
    }
  });
}

export async function persistPipelineCheckpoint(
  runId: string,
  checkpoint: PipelineCheckpoint
) {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: {
      checkpoint: jsonInput(checkpoint),
      currentPass: passTypeForStep(checkpoint.currentStep)
    }
  });

  return checkpoint;
}

const persistCheckpoint = persistPipelineCheckpoint;

export async function runPipelineStep(
  step: ManuscriptPipelineStep,
  manuscriptId: string,
  runId: string,
  options: PipelineStepRunOptions = {}
) {
  const importGate = await importVerificationGate(step, manuscriptId);
  if (importGate) {
    return importGate;
  }
  const snapshotOptions = async () => ({
    ...options,
    snapshotId: options.snapshotId ?? (await snapshotIdForRun(runId))
  });

  switch (step) {
    case "parseAndNormalizeManuscript":
      return parseAndNormalizeManuscript(manuscriptId);
    case "splitIntoChapters":
      return splitIntoChapters(manuscriptId, runId);
    case "splitIntoChunks":
      return splitIntoChunks(manuscriptId);
    case "createEmbeddingsForChunks":
      return createEmbeddingsForChunks(manuscriptId, options);
    case "summarizeChunks":
      return summarizeChunks(manuscriptId, runId, options);
    case "summarizeChapters":
      return summarizeChapters(manuscriptId);
    case "createManuscriptProfile":
      return createManuscriptProfile(manuscriptId);
    case "buildManuscriptNodes":
      return buildManuscriptNodes(manuscriptId);
    case "compileSceneDigests":
      return compileSceneDigests(manuscriptId, await snapshotOptions());
    case "extractNarrativeMemory":
      return extractNarrativeMemory(manuscriptId, await snapshotOptions());
    case "compileChapterCapsules":
      return compileChapterCapsules(manuscriptId, await snapshotOptions());
    case "compileWholeBookMap":
      return compileWholeBookMap(manuscriptId, await snapshotOptions());
    case "createNextBestEditorialActions":
      return createNextBestEditorialActions(manuscriptId, await snapshotOptions());
    case "runChapterAudits":
      return runChapterAudits(manuscriptId, runId, options);
    case "runWholeBookAudit":
      return runWholeBookAudit(manuscriptId, runId);
    case "compareAgainstCorpus":
      return compareAgainstCorpus(manuscriptId, runId);
    case "compareAgainstTrendSignals":
      return compareAgainstTrendSignals(manuscriptId, runId);
    case "createRewritePlan":
      return createRewritePlan(manuscriptId, runId);
    case "generateChapterRewriteDrafts":
      return generateChapterRewriteDrafts(manuscriptId, runId, options);
  }
}

async function importVerificationGate(
  step: ManuscriptPipelineStep,
  manuscriptId: string
): Promise<PipelineStepRunResult | null> {
  if (isImportCriticalManuscriptPipelineStep(step)) {
    return null;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  let manuscript: { metadata: unknown } | null;

  try {
    manuscript = await prisma.manuscript.findUnique({
      where: { id: manuscriptId },
      select: { metadata: true }
    });
  } catch {
    return null;
  }
  const metadata = toJsonRecord(manuscript?.metadata);
  const reviewGate = importStructureReviewGate(metadata);

  if (!reviewGate) {
    return importArtifactReadinessGate(step, manuscriptId);
  }

  return reviewGate;
}

export function isImportStructureReviewRequired(metadata: unknown) {
  return Boolean(importStructureReviewGate(metadata));
}

function importStructureReviewGate(
  metadata: unknown
): PipelineStepRunResult | null {
  const record = toJsonRecord(metadata);
  const manifest = importManifestFromMetadata(record);
  const structureReview = toJsonRecord(record.structureReview);
  const importV2 = toJsonRecord(record.importV2);
  const approved =
    importV2.reviewStatus === "approved" || manifest?.review.status === "approved";
  const needsReview =
    toJsonRecord(record.importReview).pendingInvalidation === true ||
    manifest?.review.verifiedEnough === false ||
    structureReview.recommended === true;

  if (!manifest || approved || !needsReview) {
    return null;
  }

  return {
    complete: false,
    remaining: 1,
    blockedReason: "import_structure_review_required",
    reviewStatus: manifest.review.status,
    warningCount:
      numberOrZero(structureReview.warningCount) || manifest.review.warningCount,
    nextStep: "Open import inspector and approve the structure before deep analysis."
  };
}

async function importArtifactReadinessGate(
  step: ManuscriptPipelineStep,
  manuscriptId: string
): Promise<PipelineStepRunResult | null> {
  if (isImportCriticalManuscriptPipelineStep(step)) {
    return null;
  }

  let chapterCount = 0;
  let chunkCount = 0;

  try {
    [chapterCount, chunkCount] = await Promise.all([
      prisma.manuscriptChapter.count({ where: { manuscriptId } }),
      prisma.manuscriptChunk.count({ where: { manuscriptId } })
    ]);
  } catch {
    return null;
  }

  if (chapterCount <= 0) {
    return missingImportArtifactGate({
      artifact: "chapters",
      artifactReason: "No chapters were created during import.",
      blockedReason: "manuscript_has_no_chapters",
      nextStep: "Run splitIntoChapters before deep analysis."
    });
  }

  if (chunkCount <= 0) {
    return missingImportArtifactGate({
      artifact: "chunks",
      artifactReason: "No chunks were created during import.",
      blockedReason: "manuscript_has_no_chunks",
      nextStep: "Run splitIntoChunks before deep analysis."
    });
  }

  return null;
}

function missingImportArtifactGate(input: {
  artifact: "chapters" | "chunks";
  artifactReason: string;
  blockedReason: string;
  nextStep: string;
}): PipelineStepRunResult {
  return {
    complete: false,
    remaining: 1,
    blockedReason: input.blockedReason,
    artifactReason: input.artifactReason,
    missingArtifact: input.artifact,
    nextStep: input.nextStep
  };
}

export function isPipelineStepRunComplete(result: PipelineStepRunResult) {
  if (result.complete === false) {
    return false;
  }

  return typeof result.remaining !== "number" || result.remaining <= 0;
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
  const manifest = importManifestFromMetadata(manuscript.metadata) ??
    buildTextImportManifest({
      rawText: originalText,
      sourceFileName: manuscript.sourceFileName,
      sourceMimeType: manuscript.sourceMimeType ?? undefined
    });
  const normalized = importManifestToNormalizedText(manifest);
  const wordCount = countWords(normalized);
  const importSignature = importSignatureFromManifest(manifest);

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      originalText: normalized,
      wordCount,
      status: "PARSED",
      metadata: jsonInput(
        metadataWithImportManifest(
          {
            ...toJsonRecord(manuscript.metadata),
            import: {
              ...toJsonRecord(toJsonRecord(manuscript.metadata).import),
              parserVersion: manifest.parserVersion,
              normalizedAt: new Date().toISOString(),
              sourceHash: manifest.fileHash,
              normalizedTextHash: createHash("sha256")
                .update(normalized)
                .digest("hex"),
              importSignature
            }
          },
          manifest
        )
      )
    }
  });

  return {
    wordCount,
    hasOriginalText: true,
    importSignature,
    parserVersion: manifest.parserVersion
  };
}

async function splitIntoChapters(manuscriptId: string, runId?: string) {
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

  const chapters = await prisma.manuscriptChapter.findMany({
    where: { manuscriptId },
    orderBy: { order: "asc" },
    include: {
      paragraphs: {
        orderBy: { chapterOrder: "asc" }
      }
    }
  });
  const existingParagraphCount = await prisma.paragraph.count({
    where: { manuscriptId }
  });

  if (
    chapters.length === 0 ||
    (manuscript.chapterCount === 0 && existingParagraphCount === 0)
  ) {
    const originalText =
      manuscript.originalText ?? manuscript.versions[0]?.sourceText;
    if (!originalText) {
      throw new Error("Manuscript has no stored source text.");
    }

    const manifest = importManifestFromMetadata(manuscript.metadata) ??
      buildTextImportManifest({
        rawText: originalText,
        sourceFileName: manuscript.sourceFileName,
        sourceMimeType: manuscript.sourceMimeType ?? undefined
      });
    const parsed = importManifestToParsedManuscript(manifest);
    const previousSignature = importSignatureFromMetadata(manuscript.metadata);
    const invalidationPlan = buildImportInvalidationPlan({
      previousSignature,
      manifest
    });
    const replaceExisting = chapters.length > 0 || existingParagraphCount > 0;

    await persistParsedManuscriptStructure(manuscriptId, parsed, {
      replaceExisting,
      invalidationPlan: replaceExisting ? invalidationPlan : undefined,
      keepAnalysisRunId: runId,
      previousMetadata: manuscript.metadata
    });

    return {
      chapterCount: parsed.chapters.length,
      paragraphCount: parsed.paragraphCount,
      wordCount: parsed.wordCount,
      importSignature: importSignatureFromManifest(manifest),
      invalidated: replaceExisting && invalidationPlan.changed
    };
  }

  let paragraphCount = 0;
  let wordCount = 0;

  for (const chapter of chapters) {
    const text =
      chapter.text ||
      chapter.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
    const chapterWordCount = chapter.wordCount || countWords(text);

    await prisma.manuscriptChapter.update({
      where: { id: chapter.id },
      data: {
        chapterIndex: chapter.chapterIndex || chapter.order,
        text,
        wordCount: chapterWordCount,
        status: "CHAPTER_READY"
      }
    });
    paragraphCount += chapter.paragraphs.length;
    wordCount += chapterWordCount;
  }

  await prisma.manuscript.update({
    where: { id: manuscriptId },
    data: {
      chapterCount: chapters.length,
      paragraphCount,
      wordCount,
      status: "CHAPTERS_READY"
    }
  });

  return { chapterCount: chapters.length, paragraphCount, wordCount };
}

async function splitIntoChunks(manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUnique({
    where: { id: manuscriptId },
    select: { chunkCount: true, metadata: true }
  });
  const chunks = await prisma.manuscriptChunk.findMany({
    where: { manuscriptId },
    orderBy: { chunkIndex: "asc" }
  });

  if (chunks.length === 0 || (manuscript?.chunkCount === 0 && chunks.length > 0)) {
    const parsed = await storedManuscriptAsParsed(manuscriptId);
    const parsedChunks = chunkParsedManuscript(parsed);
    await persistParsedChunks(manuscriptId, parsedChunks, {
      replaceExisting: chunks.length > 0,
      previousMetadata: manuscript?.metadata
    });

    return {
      chunkCount: parsedChunks.length,
      complete: true
    };
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

async function persistParsedManuscriptStructure(
  manuscriptId: string,
  parsed: ParsedManuscript,
  options: {
    replaceExisting?: boolean;
    invalidationPlan?: ImportInvalidationPlan;
    keepAnalysisRunId?: string;
    previousMetadata?: unknown;
  } = {}
) {
  const manifest = importManifestFromMetadata(parsed.metadata);
  const chapterRows: Prisma.ManuscriptChapterCreateManyInput[] = [];
  const sceneRows: Prisma.SceneCreateManyInput[] = [];
  const paragraphRows: Prisma.ParagraphCreateManyInput[] = [];
  const chapterIdByOrder = new Map<number, string>();

  for (const chapter of parsed.chapters) {
    const chapterId = randomUUID();
    const chapterText = chapter.scenes
      .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
      .join("\n\n");

    chapterRows.push({
      id: chapterId,
      manuscriptId,
      order: chapter.order,
      chapterIndex: chapter.order,
      title: chapter.title,
      heading: chapter.heading,
      text: chapterText,
      wordCount: chapter.wordCount,
      startOffset: chapter.startOffset,
      endOffset: chapter.endOffset,
      status: "CHAPTER_READY"
    });
    chapterIdByOrder.set(chapter.order, chapterId);

    for (const scene of chapter.scenes) {
      const sceneId = randomUUID();

      sceneRows.push({
        id: sceneId,
        manuscriptId,
        chapterId,
        order: scene.order,
        title: scene.title,
        wordCount: scene.wordCount,
        marker: scene.marker
      });

      for (const paragraph of scene.paragraphs) {
        paragraphRows.push({
          manuscriptId,
          chapterId,
          sceneId,
          globalOrder: paragraph.globalOrder,
          chapterOrder: paragraph.chapterOrder,
          sceneOrder: paragraph.sceneOrder,
          text: paragraph.text,
          wordCount: paragraph.wordCount,
          approximateOffset: paragraph.approximateOffset
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (options.invalidationPlan?.changed) {
      await invalidateImportDerivedArtifacts(tx, {
        manuscriptId,
        plan: options.invalidationPlan,
        keepAnalysisRunId: options.keepAnalysisRunId
      });
    }

    if (options.replaceExisting) {
      await tx.manuscriptChunk.deleteMany({ where: { manuscriptId } });
      await tx.paragraph.deleteMany({ where: { manuscriptId } });
      await tx.scene.deleteMany({ where: { manuscriptId } });
      await tx.manuscriptChapter.deleteMany({ where: { manuscriptId } });
    }

    await createManyInBatches(chapterRows, (data) =>
      tx.manuscriptChapter.createMany({ data, skipDuplicates: true })
    );
    await createManyInBatches(sceneRows, (data) =>
      tx.scene.createMany({ data, skipDuplicates: true })
    );
    await createManyInBatches(paragraphRows, (data) =>
      tx.paragraph.createMany({ data, skipDuplicates: true })
    );

    await tx.manuscript.update({
      where: { id: manuscriptId },
      data: {
        title: parsed.title,
        originalText: parsed.normalizedText,
        wordCount: parsed.wordCount,
        chapterCount: parsed.chapters.length,
        paragraphCount: parsed.paragraphCount,
        status: "CHAPTERS_READY",
        metadata: jsonInput({
          ...toJsonRecord(options.previousMetadata),
          ...(manifest
            ? metadataWithImportManifest(parsed.metadata, manifest)
            : parsed.metadata),
          importReview: {
            ...toJsonRecord(toJsonRecord(options.previousMetadata).importReview),
            pendingInvalidation: false,
            rebuiltAt: new Date().toISOString()
          },
          compilerVersion: "compiler-v1",
          importFlow: "pipeline",
          structuralHash: createHash("sha256")
            .update(parsed.normalizedText)
            .digest("hex"),
          importSignature: manifest ? importSignatureFromManifest(manifest) : undefined
        })
      }
    });
  });
}

async function storedManuscriptAsParsed(
  manuscriptId: string
): Promise<ParsedManuscript> {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: {
        orderBy: { order: "asc" },
        include: {
          scenes: {
            orderBy: { order: "asc" },
            include: {
              paragraphs: {
                orderBy: { globalOrder: "asc" }
              }
            }
          }
        }
      }
    }
  });

  if (manuscript.chapters.length === 0) {
    throw new Error("No chapters found. Run splitIntoChapters first.");
  }

  const manifest = importManifestFromMetadata(manuscript.metadata);
  const paragraphBlocks = manifest
    ? manifest.blocks.filter(
        (block) =>
          block.type === "paragraph" ||
          block.type === "list_item" ||
          block.type === "front_matter"
      )
    : [];
  const chapters: ParsedManuscript["chapters"] = manuscript.chapters.map(
    (chapter) => ({
      order: chapter.order,
      title: chapter.title,
      heading: chapter.heading ?? undefined,
      wordCount: chapter.wordCount || countWords(chapter.text),
      startOffset: chapter.startOffset ?? undefined,
      endOffset: chapter.endOffset ?? undefined,
      scenes: chapter.scenes.map((scene) => ({
        order: scene.order,
        title: scene.title,
        marker: scene.marker ?? undefined,
        wordCount: scene.wordCount,
        paragraphs: scene.paragraphs.map((paragraph) => ({
          text: paragraph.text,
          wordCount: paragraph.wordCount,
          globalOrder: paragraph.globalOrder,
          chapterOrder: paragraph.chapterOrder,
          sceneOrder: paragraph.sceneOrder,
          approximateOffset: paragraph.approximateOffset ?? undefined,
          sourceAnchor: paragraphBlocks[paragraph.globalOrder]?.sourceAnchor,
          importBlockId: paragraphBlocks[paragraph.globalOrder]?.id,
          confidence: paragraphBlocks[paragraph.globalOrder]?.confidence,
          warnings: paragraphBlocks[paragraph.globalOrder]?.warnings
        }))
      }))
    })
  );

  return {
    title: manuscript.title,
    normalizedText:
      manuscript.originalText ??
      chapters
        .flatMap((chapter) =>
          chapter.scenes.flatMap((scene) =>
            scene.paragraphs.map((paragraph) => paragraph.text)
          )
        )
        .join("\n\n"),
    wordCount: manuscript.wordCount,
    paragraphCount: manuscript.paragraphCount,
    chapters,
    metadata: {
      ...toJsonRecord(manuscript.metadata),
      sourceFileName: manuscript.sourceFileName,
      parserVersion: "stored-compiler-v1"
    }
  };
}

async function persistParsedChunks(
  manuscriptId: string,
  parsedChunks: ParsedChunk[],
  options: { replaceExisting?: boolean; previousMetadata?: unknown } = {}
) {
  const previousMetadata = toJsonRecord(options.previousMetadata);
  const importV2 = toJsonRecord(previousMetadata.importV2);
  const chunkHash = createHash("sha256")
    .update(
      JSON.stringify(
        parsedChunks.map((chunk) => ({
          chapterOrder: chunk.chapterOrder,
          sceneOrder: chunk.sceneOrder,
          text: chunk.text,
          startParagraph: chunk.startParagraph,
          endParagraph: chunk.endParagraph
        }))
      )
    )
    .digest("hex");
  const chapters = await prisma.manuscriptChapter.findMany({
    where: { manuscriptId },
    orderBy: { order: "asc" },
    include: { scenes: { orderBy: { order: "asc" } } }
  });
  const chapterIdByOrder = new Map(
    chapters.map((chapter) => [chapter.order, chapter.id])
  );
  const sceneIdByKey = new Map<string, string>();

  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      sceneIdByKey.set(sceneKey(chapter.order, scene.order), scene.id);
    }
  }

  const rows: Prisma.ManuscriptChunkCreateManyInput[] = parsedChunks.map(
    (chunk) => {
      const chapterId = chapterIdByOrder.get(chunk.chapterOrder);
      if (!chapterId) {
        throw new Error(`Missing chapter for chunk ${chunk.chunkIndex}.`);
      }

      const sceneId =
        chunk.sceneOrder === undefined
          ? null
          : sceneIdByKey.get(sceneKey(chunk.chapterOrder, chunk.sceneOrder));

      if (chunk.sceneOrder !== undefined && !sceneId) {
        throw new Error(`Missing scene for chunk ${chunk.chunkIndex}.`);
      }

      return {
        manuscriptId,
        chapterId,
        sceneId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        wordCount: chunk.wordCount,
        startParagraph: chunk.startParagraph,
        endParagraph: chunk.endParagraph,
        paragraphStart: chunk.startParagraph,
        paragraphEnd: chunk.endParagraph,
        tokenEstimate: chunk.tokenEstimate,
        tokenCount: chunk.tokenEstimate,
        metadata: jsonInput({
          ...chunk.metadata,
          source: "compiler-v1",
          importSignature: importV2.signature,
          importStructureHash: importV2.structureHash,
          chunkHash
        })
      };
    }
  );

  await prisma.$transaction(async (tx) => {
    if (options.replaceExisting) {
      await tx.manuscriptChunk.deleteMany({ where: { manuscriptId } });
    }

    await createManyInBatches(rows, (data) =>
      tx.manuscriptChunk.createMany({ data, skipDuplicates: true })
    );

    await tx.manuscript.update({
      where: { id: manuscriptId },
      data: {
        chunkCount: rows.length,
        status: "CHUNKS_READY",
        metadata: jsonInput({
          ...previousMetadata,
          importV2: {
            ...importV2,
            chunkHash
          }
        })
      }
    });
  });
}

async function createEmbeddingsForChunks(
  manuscriptId: string,
  options: PipelineStepRunOptions = {}
) {
  const chunks = await prisma.manuscriptChunk.findMany({
    where: { manuscriptId },
    orderBy: { chunkIndex: "asc" }
  });
  const candidates = chunks.filter((chunk) => {
    const metrics = toJsonRecord(chunk.localMetrics);
    return !(
      metrics.embeddingStatus === "stored" ||
      metrics.embeddingStatus === "empty" ||
      (metrics.embeddingStatus === "skipped" && !hasEditorModelKey())
    );
  });
  const maxItems = normalizeMaxItems(options.maxItems, candidates.length);

  let stored = 0;
  let skipped = 0;
  let processed = 0;

  for (const chunk of candidates.slice(0, maxItems)) {
    processed += 1;
    const metrics = toJsonRecord(chunk.localMetrics);
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

  const remaining = Math.max(candidates.length - processed, 0);
  return { stored, skipped, remaining, complete: remaining === 0 };
}

async function summarizeChunks(
  manuscriptId: string,
  runId: string,
  options: PipelineStepRunOptions = {}
) {
  const manuscript = await getPipelineManuscript(manuscriptId);
  let analyzed = 0;
  const pendingChunks: typeof manuscript.chunks = [];

  for (const chunk of manuscript.chunks) {
    const existing = await findOutput(runId, AnalysisPassType.CHUNK_ANALYSIS, "chunk", chunk.id);
    if (existing) {
      continue;
    }
    pendingChunks.push(chunk);
  }

  const maxItems = normalizeMaxItems(options.maxItems, pendingChunks.length);
  for (const chunk of pendingChunks.slice(0, maxItems)) {
    const result = await analyzeManuscriptChunk({
      manuscriptTitle: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      chapterTitle: chunk.chapter.title,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text
    });

    await saveFindings({
      runId,
      manuscriptId,
      chapterId: chunk.chapterId,
      chunkId: chunk.id,
      findings: result.json.findings
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
      usage: result.usage,
      inputSummary: {
        chunkIndex: chunk.chunkIndex,
        chapterTitle: chunk.chapter.title,
        wordCount: chunk.wordCount
      }
    });
    analyzed += 1;
  }

  const remaining = Math.max(pendingChunks.length - analyzed, 0);
  return { analyzed, remaining, complete: remaining === 0 };
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
      ...profileDataFromMetrics(profile)
    }
  });

  return { profileId: created.id };
}

async function runChapterAudits(
  manuscriptId: string,
  runId: string,
  options: PipelineStepRunOptions = {}
) {
  const manuscript = await getPipelineManuscript(manuscriptId);
  let audited = 0;
  const pendingChapters: typeof manuscript.chapters = [];
  const total = manuscript.chapters.length;

  for (const chapter of manuscript.chapters) {
    const existing = await findOutput(runId, AnalysisPassType.CHAPTER_AUDIT, "chapter", chapter.id);
    if (existing) {
      continue;
    }
    pendingChapters.push(chapter);
  }

  const maxItems = normalizeMaxItems(options.maxItems, pendingChapters.length);
  for (const chapter of pendingChapters.slice(0, maxItems)) {
    const chunkSummaries = manuscript.chunks
      .filter((chunk) => chunk.chapterId === chapter.id)
      .map((chunk) => chunk.summary ?? "")
      .filter(Boolean);
    const chapterContext = buildBoundedChapterContext(chapter.text);
    const result = await analyzeChapter({
      manuscriptTitle: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      chapterTitle: chapter.title,
      chapterIndex: chapter.chapterIndex || chapter.order,
      text: chapterContext.text,
      chunkSummaries
    });

    await saveFindings({
      runId,
      manuscriptId,
      chapterId: chapter.id,
      findings: result.json.findings
    });
    await prisma.manuscriptChapter.update({
      where: { id: chapter.id },
      data: {
        summary: result.json.summary,
        status: "AUDITED"
      }
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
      usage: result.usage,
      inputSummary: {
        chapterTitle: chapter.title,
        wordCount: chapter.wordCount,
        chunkSummaryCount: chunkSummaries.length,
        contextStrategy: chapterContext.strategy,
        contextWordCount: chapterContext.contextWordCount,
        omittedWordCount: chapterContext.omittedWordCount
      }
    });
    audited += 1;
  }

  const remaining = Math.max(pendingChapters.length - audited, 0);
  const alreadyAudited = total - pendingChapters.length;

  return {
    audited: alreadyAudited + audited,
    processed: audited,
    total,
    remaining,
    complete: remaining === 0
  };
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

  await saveOutput({
    runId,
    manuscriptId,
    passType: AnalysisPassType.WHOLE_BOOK_AUDIT,
    scopeType: "manuscript",
    scopeId: manuscriptId,
    model: result.model,
    output: result.json,
    rawText: result.rawText,
    usage: result.usage,
    inputSummary: {
      chapterCount: manuscript.chapters.length,
      profileId: manuscript.profile?.id
    }
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
  const manuscriptMetadata = toJsonRecord(manuscript.metadata);
  const manuscriptLanguage = stringOrNull(manuscriptMetadata.language);
  const selectedCorpusBookIds = stringArray(manuscriptMetadata.selectedCorpusBookIds);
  const profileCandidates = await prisma.bookProfile.findMany({
    take: 60,
    orderBy: { createdAt: "desc" },
    include: { book: true }
  });
  const profiles = profileCandidates
    .filter((profile) => profile.book.benchmarkReady && canUseForCorpusBenchmark(profile.book))
    .sort(
      (a, b) =>
        corpusProfileRank(
          b.book,
          manuscriptLanguage,
          manuscript.targetGenre,
          selectedCorpusBookIds
        ) -
        corpusProfileRank(
          a.book,
          manuscriptLanguage,
          manuscript.targetGenre,
          selectedCorpusBookIds
        )
    )
    .slice(0, DEFAULT_CORPUS_COMPARISON_LIMITS.maxBenchmarkProfiles);
  const promptProfiles = profiles.map((profile) => ({
    bookId: profile.book.id,
    title: profile.book.title,
    author: profile.book.author,
    rightsStatus: profile.book.rightsStatus,
    genre: profile.book.genre,
    language: profile.book.language,
    profile: profileForPrompt(profile)
  }));
  const sameLanguageProfiles = promptProfiles.filter((profile) =>
    sameNormalizedValue(profile.language, manuscriptLanguage)
  ).map((profile) => profileReferenceForPrompt(profile, "same_language"));
  const sameGenreProfiles = promptProfiles.filter((profile) =>
    sameGenre(profile.genre, manuscript.targetGenre)
  ).map((profile) => profileReferenceForPrompt(profile, "same_genre"));
  const selectedProfiles = promptProfiles.filter((profile) =>
    selectedCorpusBookIds.includes(profilesKey(profile))
  ).map((profile) => profileReferenceForPrompt(profile, "selected_by_manuscript"));
  const chunkCandidates = await prisma.corpusChunk.findMany({
    take: 60,
    orderBy: { createdAt: "desc" },
    include: { book: true }
  });
  const chunks = chunkCandidates
    .filter((chunk) => chunk.book.benchmarkReady && canUseForChunkContext(chunk.book))
    .sort((a, b) => corpusChunkRank(b.book, manuscriptLanguage, manuscript.targetGenre) - corpusChunkRank(a.book, manuscriptLanguage, manuscript.targetGenre))
    .slice(0, DEFAULT_CORPUS_COMPARISON_LIMITS.maxCorpusChunks);

  if (profiles.length === 0 && chunks.length === 0) {
    return saveSkippedComparisonOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.CORPUS_COMPARISON,
      reason: "no_benchmark_corpus",
      summary:
        "No benchmark corpus profiles or rights-safe corpus chunks are available yet.",
      inputSummary: {
        benchmarkProfileCount: 0,
        similarChunkCount: 0,
        rightsStatusCounts: rightsStatusCounts([])
      }
    });
  }

  const storedCorpusEmbeddings = chunks.filter((chunk) => chunk.embeddingStatus === "STORED").length;
  const manuscriptEmbeddingReady = await prisma.manuscriptChunk.count({
    where: {
      manuscriptId,
      localMetrics: {
        path: ["embeddingStatus"],
        equals: "stored"
      }
    }
  });
  const chunkSimilarityBasis =
    storedCorpusEmbeddings > 0 && manuscriptEmbeddingReady > 0
      ? "embedding-ready chunks plus profile filters"
      : "profile-filtered chunks; embeddings unavailable or incomplete";
  const wholeBookOutput = await findOutput(
    runId,
    AnalysisPassType.WHOLE_BOOK_AUDIT,
    "manuscript",
    manuscriptId
  );
  const corpusContext = buildBoundedCorpusComparisonInput({
    manuscriptTitle: manuscript.title,
    targetGenre: manuscript.targetGenre,
    manuscriptLanguage,
    manuscriptProfile: toJsonRecord(manuscript.profile),
    wholeBookAudit: toJsonRecord(wholeBookOutput?.output),
    rightsStatusCounts: rightsStatusCounts(profiles.map((profile) => profile.book)),
    benchmarkProfiles: promptProfiles,
    sameLanguageProfiles,
    sameGenreProfiles,
    selectedProfiles,
    chunkSimilarityBasis,
    similarChunks: chunks.map((chunk) => ({
      bookTitle: chunk.book.title,
      author: chunk.book.author,
      rightsStatus: chunk.book.rightsStatus,
      summary: chunk.summary,
      excerpt: chunk.text,
      metrics: chunk.metrics
    }))
  });
  const corpusContextMetadata = {
    estimatedInputCharacters: corpusContext.estimatedInputCharacters,
    includedProfileCount: corpusContext.includedProfileCount,
    includedChunkCount: corpusContext.includedChunkCount,
    includedWholeBookNoteCount: corpusContext.includedWholeBookNoteCount,
    maxBudget: corpusContext.maxBudget,
    limits: DEFAULT_CORPUS_COMPARISON_LIMITS
  };

  if (corpusContext.overBudget) {
    return saveSkippedComparisonOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.CORPUS_COMPARISON,
      reason: "corpus_context_too_large",
      summary:
        "Corpus comparison was skipped because the bounded context package was still too large for a safe model request.",
      metadata: corpusContextMetadata,
      inputSummary: {
        ...corpusContextMetadata,
        benchmarkProfileCount: corpusContext.includedProfileCount,
        sameLanguageProfileCount: sameLanguageProfiles.length,
        sameGenreProfileCount: sameGenreProfiles.length,
        selectedProfileCount: selectedProfiles.length,
        similarChunkCount: corpusContext.includedChunkCount,
        chunkSimilarityBasis,
        rightsStatusCounts: rightsStatusCounts(profiles.map((profile) => profile.book))
      }
    });
  }

  let result;
  try {
    result = await corpusComparisonRunner(corpusContext.input, { retries: 0 });
  } catch (error) {
    const requestTooLarge = isCorpusRequestTooLargeError(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return saveSkippedComparisonOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.CORPUS_COMPARISON,
      reason: requestTooLarge
        ? "corpus_request_too_large"
        : "corpus_model_unavailable",
      summary: requestTooLarge
        ? "Corpus comparison was skipped after the model rejected the bounded request as too large."
        : "Corpus comparison was skipped because the model did not complete inside the safe import window.",
      metadata: {
        ...corpusContextMetadata,
        errorMessage
      },
      inputSummary: {
        ...corpusContextMetadata,
        errorMessage,
        benchmarkProfileCount: corpusContext.includedProfileCount,
        sameLanguageProfileCount: sameLanguageProfiles.length,
        sameGenreProfileCount: sameGenreProfiles.length,
        selectedProfileCount: selectedProfiles.length,
        similarChunkCount: corpusContext.includedChunkCount,
        chunkSimilarityBasis,
        rightsStatusCounts: rightsStatusCounts(profiles.map((profile) => profile.book))
      }
    });
  }

  await saveFindings({
    runId,
    manuscriptId,
    findings: result.json.findings
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
    usage: result.usage,
    inputSummary: {
      ...corpusContextMetadata,
      benchmarkProfileCount: corpusContext.includedProfileCount,
      sameLanguageProfileCount: sameLanguageProfiles.length,
      sameGenreProfileCount: sameGenreProfiles.length,
      selectedProfileCount: selectedProfiles.length,
      similarChunkCount: corpusContext.includedChunkCount,
      chunkSimilarityBasis,
      rightsStatusCounts: rightsStatusCounts(profiles.map((profile) => profile.book))
    }
  });

  return {
    benchmarkProfileCount: corpusContext.includedProfileCount,
    estimatedInputCharacters: corpusContext.estimatedInputCharacters
  };
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

  if (signals.length === 0) {
    return saveSkippedComparisonOutput({
      runId,
      manuscriptId,
      passType: AnalysisPassType.TREND_COMPARISON,
      reason: "no_trend_signals",
      summary: "No trend signals are available for this manuscript genre yet.",
      inputSummary: {
        signalCount: 0,
        targetGenre: manuscript.targetGenre,
        trendSignalsUse: "metadata_context_only"
      }
    });
  }

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

  await saveFindings({
    runId,
    manuscriptId,
    findings: result.json.findings
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
    usage: result.usage,
    inputSummary: {
      signalCount: signals.length,
      targetGenre: manuscript.targetGenre,
      trendSignalsUse: "metadata_context_only"
    }
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
  const rewriteFindings = findings.filter(
    (finding) => !isTrendContextFinding(finding.issueType)
  );
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
    trendComparison: trendContextOnly(trends?.output),
    findings: rewriteFindings.map((finding) => ({
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
    usage: result.usage,
    inputSummary: {
      findingCount: rewriteFindings.length,
      trendFindingCountExcluded: findings.length - rewriteFindings.length,
      chapterCount: manuscript.chapters.length
    }
  });

  const plan = await prisma.rewritePlan.create({
    data: {
      manuscriptId,
      analysisRunId: runId,
      snapshotId: await snapshotIdForRun(runId),
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

async function generateChapterRewriteDrafts(
  manuscriptId: string,
  runId: string,
  options: PipelineStepRunOptions = {}
) {
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

  const existingRewrites = await prisma.chapterRewrite.findMany({
    where: {
      manuscriptId,
      rewritePlanId: rewritePlan.id,
      status: { in: ["DRAFT", "ACCEPTED"] }
    },
    select: { chapterId: true }
  });
  const draftedChapterIds = new Set(
    existingRewrites.map((rewrite) => rewrite.chapterId)
  );
  const pendingChapters = manuscript.chapters.filter(
    (chapter) => !draftedChapterIds.has(chapter.id)
  );
  const maxItems = normalizeMaxItems(options.maxItems, pendingChapters.length);
  let drafted = 0;

  for (const chapter of pendingChapters.slice(0, maxItems)) {
    const result = await draftChapterRewrite({
      manuscriptId,
      chapterId: chapter.id,
      runId,
      rewritePlanId: rewritePlan.id
    });

    if (result.created) {
      drafted += 1;
    }
  }

  const remaining = Math.max(pendingChapters.length - drafted, 0);
  return { drafted, remaining, complete: remaining === 0 };
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

async function snapshotIdForRun(runId: string) {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    const run = await prisma.analysisRun.findUnique({
      where: { id: runId },
      select: { snapshotId: true }
    });

    return run?.snapshotId ?? null;
  } catch {
    return null;
  }
}

async function saveOutput(input: {
  runId: string;
  manuscriptId: string;
  snapshotId?: string | null;
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
  usage?: AiUsageLog;
  inputSummary?: Record<string, unknown>;
  chunkId?: string;
  chapterId?: string;
}) {
  const snapshotId = input.snapshotId ?? (await snapshotIdForRun(input.runId));

  const outputRow = await prisma.analysisOutput.upsert({
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
      snapshotId,
      passType: input.passType,
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
      snapshotId,
      model: input.model,
      inputSummary: jsonInput(withAiUsage(input.inputSummary ?? {}, input.usage)),
      output: jsonInput(input.output),
      rawText: input.rawText
    }
  });

  if (extractRawEditorialMemoryItems(input.output).length > 0) {
    await upsertEditorialMemoryItemsFromRawOutput({
      manuscriptId: input.manuscriptId,
      analysisRunId: input.runId,
      analysisOutputId: outputRow.id,
      snapshotId,
      rawOutput: input.output,
      source: {
        sourceType: "analysis_output",
        sourceId: outputRow.id,
        promptVersion: EDITOR_PROMPT_VERSION,
        model: input.model,
        provenance: {
          passType: input.passType,
          scopeType: input.scopeType,
          scopeId: input.scopeId
        }
      }
    });
  }
}

async function saveSkippedComparisonOutput(input: {
  runId: string;
  manuscriptId: string;
  passType: AnalysisPassType;
  reason: string;
  summary: string;
  metadata?: Record<string, unknown>;
  inputSummary?: Record<string, unknown>;
}) {
  const output = {
    status: "skipped",
    skipped: true,
    reason: input.reason,
    summary: input.summary,
    metadata: input.metadata ?? {},
    findings: []
  };

  await saveOutput({
    runId: input.runId,
    manuscriptId: input.manuscriptId,
    passType: input.passType,
    scopeType: "manuscript",
    scopeId: input.manuscriptId,
    model: "system",
    output,
    rawText: JSON.stringify(output),
    inputSummary: {
      ...(input.inputSummary ?? {}),
      skipped: true,
      skipReason: input.reason
    }
  });

  return { skipped: true, reason: input.reason, complete: true };
}

async function saveFindings(input: {
  runId: string;
  manuscriptId: string;
  snapshotId?: string | null;
  chapterId?: string;
  chunkId?: string;
  findings?: FindingDraft[];
}) {
  const findings = input.findings ?? [];
  await prisma.finding.deleteMany({
    where: {
      analysisRunId: input.runId,
      manuscriptId: input.manuscriptId,
      chapterId: input.chapterId ?? null,
      chunkId: input.chunkId ?? null
    }
  });

  if (findings.length === 0) {
    return;
  }

  const snapshotId = input.snapshotId ?? (await snapshotIdForRun(input.runId));

  await prisma.finding.createMany({
    data: findings.map((finding) => ({
      analysisRunId: input.runId,
      manuscriptId: input.manuscriptId,
      snapshotId,
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
  const snapshotId = await snapshotIdForRun(input.runId);

  return prisma.auditReport.create({
    data: {
      manuscriptId: input.manuscriptId,
      runId: input.runId,
      snapshotId,
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

const TREND_CONTEXT_ISSUE_TYPES = new Set([
  "market-positioning",
  "trope",
  "category",
  "audience",
  "signal-quality"
]);

function isTrendContextFinding(issueType: string) {
  return TREND_CONTEXT_ISSUE_TYPES.has(issueType);
}

function trendContextOnly(value: unknown) {
  const record = toJsonRecord(value);
  return {
    metadataOnly: true,
    summary: record.summary,
    signalStrength: record.signalStrength,
    dominantTropes: record.dominantTropes,
    positioningNotes: record.positioningNotes,
    marketOpportunity: record.marketOpportunity,
    marketRisk: record.marketRisk
  };
}

function profileForPrompt(profile: unknown) {
  const record = toJsonRecord(profile);
  const {
    id: _id,
    bookId: _bookId,
    book: _book,
    manuscriptId: _manuscriptId,
    manuscript: _manuscript,
    createdAt: _createdAt,
    ...metrics
  } = record;

  return metrics;
}

function profileReferenceForPrompt(
  profile: {
    bookId?: string;
    title: string;
    author?: string | null;
    rightsStatus: string;
    genre?: string | null;
    language?: string | null;
  },
  matchReason: string
) {
  return {
    bookId: profile.bookId,
    title: profile.title,
    author: profile.author,
    rightsStatus: profile.rightsStatus,
    genre: profile.genre,
    language: profile.language,
    matchReason
  };
}

function sameNormalizedValue(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameGenre(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

function profilesKey(profile: { bookId?: string }) {
  return profile.bookId ?? "";
}

function corpusProfileRank(
  book: { id?: string; language?: string | null; genre?: string | null },
  manuscriptLanguage?: string | null,
  targetGenre?: string | null,
  selectedCorpusBookIds: string[] = []
) {
  let score = 0;
  if (book.id && selectedCorpusBookIds.includes(book.id)) score += 4;
  if (sameNormalizedValue(book.language, manuscriptLanguage)) score += 2;
  if (sameGenre(book.genre, targetGenre)) score += 2;
  return score;
}

function corpusChunkRank(
  book: { language?: string | null; genre?: string | null },
  manuscriptLanguage?: string | null,
  targetGenre?: string | null
) {
  let score = 0;
  if (sameNormalizedValue(book.language, manuscriptLanguage)) score += 2;
  if (sameGenre(book.genre, targetGenre)) score += 2;
  return score;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
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

function normalizeMaxItems(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return Math.max(1, fallback);
  }

  return Math.max(1, Math.floor(value));
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sceneKey(chapterOrder: number, sceneOrder: number) {
  return `${chapterOrder}:${sceneOrder}`;
}

async function createManyInBatches<T>(
  rows: T[],
  createMany: (data: T[]) => Prisma.PrismaPromise<unknown>
) {
  const batchSize = 500;

  for (let index = 0; index < rows.length; index += batchSize) {
    await createMany(rows.slice(index, index + batchSize));
  }
}
