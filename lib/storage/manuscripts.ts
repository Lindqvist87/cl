import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ParsedChunk, ParsedManuscript } from "@/lib/types";
import { jsonInput } from "@/lib/json";

type CreateManuscriptInput = {
  parsed: ParsedManuscript;
  chunks: ParsedChunk[];
  sourceFileName: string;
  sourceMimeType?: string;
  sourceFormat: Prisma.ManuscriptCreateInput["sourceFormat"];
};

export async function createStoredManuscript(input: CreateManuscriptInput) {
  return prisma.$transaction(async (tx) => {
    const manuscript = await tx.manuscript.create({
      data: {
        title: input.parsed.title,
        sourceFileName: input.sourceFileName,
        sourceMimeType: input.sourceMimeType,
        sourceFormat: input.sourceFormat,
        wordCount: input.parsed.wordCount,
        chapterCount: input.parsed.chapters.length,
        paragraphCount: input.parsed.paragraphCount,
        chunkCount: input.chunks.length,
        metadata: jsonInput(input.parsed.metadata)
      }
    });

    await tx.manuscriptVersion.create({
      data: {
        manuscriptId: manuscript.id,
        versionNumber: 1,
        sourceText: input.parsed.normalizedText,
        sourceHash: createHash("sha256")
          .update(input.parsed.normalizedText)
          .digest("hex"),
        parserVersion: "mvp-1"
      }
    });

    const chapterIdByOrder = new Map<number, string>();
    const sceneIdByKey = new Map<string, string>();

    for (const chapter of input.parsed.chapters) {
      const storedChapter = await tx.chapter.create({
        data: {
          manuscriptId: manuscript.id,
          order: chapter.order,
          title: chapter.title,
          heading: chapter.heading,
          wordCount: chapter.wordCount,
          startOffset: chapter.startOffset,
          endOffset: chapter.endOffset
        }
      });

      chapterIdByOrder.set(chapter.order, storedChapter.id);

      for (const scene of chapter.scenes) {
        const storedScene = await tx.scene.create({
          data: {
            manuscriptId: manuscript.id,
            chapterId: storedChapter.id,
            order: scene.order,
            title: scene.title,
            wordCount: scene.wordCount,
            marker: scene.marker
          }
        });

        sceneIdByKey.set(sceneKey(chapter.order, scene.order), storedScene.id);

        if (scene.paragraphs.length > 0) {
          await tx.paragraph.createMany({
            data: scene.paragraphs.map((paragraph) => ({
              manuscriptId: manuscript.id,
              chapterId: storedChapter.id,
              sceneId: storedScene.id,
              globalOrder: paragraph.globalOrder,
              chapterOrder: paragraph.chapterOrder,
              sceneOrder: paragraph.sceneOrder,
              text: paragraph.text,
              wordCount: paragraph.wordCount,
              approximateOffset: paragraph.approximateOffset
            }))
          });
        }
      }
    }

    if (input.chunks.length > 0) {
      await tx.manuscriptChunk.createMany({
        data: input.chunks.map((chunk) => {
          const chapterId = chapterIdByOrder.get(chunk.chapterOrder);
          if (!chapterId) {
            throw new Error(`Missing chapter for chunk ${chunk.chunkIndex}`);
          }

          return {
            manuscriptId: manuscript.id,
            chapterId,
            sceneId:
              chunk.sceneOrder === undefined
                ? undefined
                : sceneIdByKey.get(sceneKey(chunk.chapterOrder, chunk.sceneOrder)),
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            wordCount: chunk.wordCount,
            startParagraph: chunk.startParagraph,
            endParagraph: chunk.endParagraph,
            tokenEstimate: chunk.tokenEstimate,
            metadata: jsonInput(chunk.metadata)
          };
        })
      });
    }

    return manuscript;
  });
}

function sceneKey(chapterOrder: number, sceneOrder: number) {
  return `${chapterOrder}:${sceneOrder}`;
}
