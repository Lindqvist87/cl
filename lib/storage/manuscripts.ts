import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ParsedChunk, ParsedManuscript } from "@/lib/types";
import {
  importManifestFromMetadata,
  importSignatureFromManifest,
  metadataWithImportManifest
} from "@/lib/import/v2/manifest";
import type { ImportManifest } from "@/lib/import/v2/types";
import { jsonInput } from "@/lib/json";
import { countWords, normalizeWhitespace } from "@/lib/text/wordCount";

type CreateManuscriptInput = {
  parsed: ParsedManuscript;
  chunks: ParsedChunk[];
  sourceFileName: string;
  sourceMimeType?: string;
  sourceFormat: Prisma.ManuscriptCreateInput["sourceFormat"];
  authorName?: string;
  targetGenre?: string;
  targetAudience?: string;
};

type CreateUploadedManuscriptShellInput = {
  originalText: string;
  sourceFileName: string;
  sourceMimeType?: string;
  sourceFormat: Prisma.ManuscriptCreateInput["sourceFormat"];
  authorName?: string;
  targetGenre?: string;
  targetAudience?: string;
  title?: string;
  importManifest?: ImportManifest;
};

const CREATE_MANY_BATCH_SIZE = 500;
const MANUSCRIPT_UPLOAD_TRANSACTION = {
  maxWait: 10_000,
  timeout: 120_000
} as const;

export async function createStoredManuscript(input: CreateManuscriptInput) {
  const parsedManifest = importManifestFromMetadata(input.parsed.metadata);
  const parsedMetadata = parsedManifest
    ? metadataWithImportManifest(input.parsed.metadata, parsedManifest)
    : input.parsed.metadata;
  const parserVersion = parsedManifest?.parserVersion ?? "mvp-1";
  const sourceHash =
    parsedManifest?.fileHash ??
    createHash("sha256").update(input.parsed.normalizedText).digest("hex");

  return prisma.$transaction(async (tx) => {
    const manuscript = await tx.manuscript.create({
      data: {
        title: input.parsed.title,
        authorName: input.authorName,
        targetGenre: input.targetGenre,
        targetAudience: input.targetAudience,
        sourceFileName: input.sourceFileName,
        sourceMimeType: input.sourceMimeType,
        sourceFormat: input.sourceFormat,
        originalText: input.parsed.normalizedText,
        wordCount: input.parsed.wordCount,
        chapterCount: input.parsed.chapters.length,
        paragraphCount: input.parsed.paragraphCount,
        chunkCount: input.chunks.length,
        metadata: jsonInput(parsedMetadata)
      }
    });

    await tx.manuscriptVersion.create({
      data: {
        manuscriptId: manuscript.id,
        versionNumber: 1,
        sourceText: input.parsed.normalizedText,
        sourceHash,
        parserVersion
      }
    });

    const chapterRows: Prisma.ManuscriptChapterCreateManyInput[] = [];
    const sceneRows: Prisma.SceneCreateManyInput[] = [];
    const paragraphRows: Prisma.ParagraphCreateManyInput[] = [];
    const chunkRows: Prisma.ManuscriptChunkCreateManyInput[] = [];
    const chapterIdByOrder = new Map<number, string>();
    const sceneIdByKey = new Map<string, string>();

    for (const chapter of input.parsed.chapters) {
      const chapterId = randomUUID();
      const chapterText = chapter.scenes
        .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
        .join("\n\n");

      chapterRows.push({
        id: chapterId,
        manuscriptId: manuscript.id,
        order: chapter.order,
        chapterIndex: chapter.order,
        title: chapter.title,
        heading: chapter.heading,
        text: chapterText,
        wordCount: chapter.wordCount,
        startOffset: chapter.startOffset,
        endOffset: chapter.endOffset
      });

      chapterIdByOrder.set(chapter.order, chapterId);

      for (const scene of chapter.scenes) {
        const sceneId = randomUUID();

        sceneRows.push({
          id: sceneId,
          manuscriptId: manuscript.id,
          chapterId,
          order: scene.order,
          title: scene.title,
          wordCount: scene.wordCount,
          marker: scene.marker
        });

        sceneIdByKey.set(sceneKey(chapter.order, scene.order), sceneId);

        for (const paragraph of scene.paragraphs) {
          paragraphRows.push({
            manuscriptId: manuscript.id,
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

    for (const chunk of input.chunks) {
      const chapterId = chapterIdByOrder.get(chunk.chapterOrder);
      if (!chapterId) {
        throw new Error(`Missing chapter for chunk ${chunk.chunkIndex}`);
      }

      const sceneId =
        chunk.sceneOrder === undefined
          ? null
          : sceneIdByKey.get(sceneKey(chunk.chapterOrder, chunk.sceneOrder));

      if (chunk.sceneOrder !== undefined && !sceneId) {
        throw new Error(`Missing scene for chunk ${chunk.chunkIndex}`);
      }

      chunkRows.push({
        manuscriptId: manuscript.id,
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
        metadata: jsonInput(chunk.metadata)
      });
    }

    await createManyInBatches(chapterRows, (data) =>
      tx.manuscriptChapter.createMany({ data })
    );
    await createManyInBatches(sceneRows, (data) => tx.scene.createMany({ data }));
    await createManyInBatches(paragraphRows, (data) =>
      tx.paragraph.createMany({ data })
    );
    await createManyInBatches(chunkRows, (data) =>
      tx.manuscriptChunk.createMany({ data })
    );

    return manuscript;
  }, MANUSCRIPT_UPLOAD_TRANSACTION);
}

export async function createUploadedManuscriptShell(
  input: CreateUploadedManuscriptShellInput
) {
  const originalText = normalizeWhitespace(input.originalText);
  const wordCount = countWords(originalText);

  if (wordCount === 0) {
    throw new Error("No readable manuscript text was found in the uploaded file.");
  }

  const importManifest = input.importManifest;
  const sourceHash =
    importManifest?.fileHash ?? createHash("sha256").update(originalText).digest("hex");
  const importSignature = importManifest
    ? importSignatureFromManifest(importManifest)
    : null;
  const title =
    input.title?.trim() ||
    inferManuscriptTitle(originalText, input.sourceFileName);
  const metadata = {
    compilerVersion: "compiler-v1",
    importFlow: "shell",
    sourceFileName: input.sourceFileName,
    sourceMimeType: input.sourceMimeType,
    sourceFormat: input.sourceFormat,
    sourceHash,
    roughWordCount: wordCount,
    ...(importSignature ? { importSignature } : {})
  };

  return prisma.$transaction(async (tx) => {
    const manuscript = await tx.manuscript.create({
      data: {
        title,
        authorName: input.authorName,
        targetGenre: input.targetGenre,
        targetAudience: input.targetAudience,
        sourceFileName: input.sourceFileName,
        sourceMimeType: input.sourceMimeType,
        sourceFormat: input.sourceFormat,
        originalText,
        wordCount,
        chapterCount: 0,
        paragraphCount: 0,
        chunkCount: 0,
        status: "IMPORT_QUEUED",
        analysisStatus: "NOT_STARTED",
        metadata: jsonInput(
          importManifest
            ? metadataWithImportManifest(metadata, importManifest)
            : metadata
        )
      }
    });

    await tx.manuscriptVersion.create({
      data: {
        manuscriptId: manuscript.id,
        versionNumber: 1,
        sourceText: originalText,
        sourceHash,
        parserVersion: importManifest?.parserVersion ?? "compiler-shell-v1"
      }
    });

    return manuscript;
  });
}

function sceneKey(chapterOrder: number, sceneOrder: number) {
  return `${chapterOrder}:${sceneOrder}`;
}

async function createManyInBatches<T>(
  rows: T[],
  createMany: (data: T[]) => Prisma.PrismaPromise<unknown>
) {
  for (let index = 0; index < rows.length; index += CREATE_MANY_BATCH_SIZE) {
    await createMany(rows.slice(index, index + CREATE_MANY_BATCH_SIZE));
  }
}

function inferManuscriptTitle(text: string, sourceFileName: string) {
  const firstShortParagraph = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => {
      const words = countWords(paragraph);
      return words > 0 && words <= 14 && paragraph.length <= 120;
    });

  if (firstShortParagraph) {
    return firstShortParagraph;
  }

  return sourceFileName.replace(/\.(docx|txt)$/i, "").replace(/[_-]+/g, " ");
}
