import test from "node:test";
import assert from "node:assert/strict";
import { ManuscriptFormat } from "@prisma/client";
import { createStoredManuscript } from "../lib/storage/manuscripts";
import { prisma } from "../lib/prisma";
import type { ParsedChunk, ParsedManuscript } from "../lib/types";

type CreateManyCall = {
  model: string;
  data: Array<Record<string, unknown>>;
};

test("createStoredManuscript persists large parsed manuscripts with batched createMany calls", async () => {
  const { parsed, chunks, expected } = buildLargeParsedManuscript();
  const createManyCalls: CreateManyCall[] = [];
  const sequentialCreateCalls: string[] = [];
  let transactionOptions:
    | { maxWait?: number; timeout?: number }
    | undefined;
  let manuscriptId = "";

  const tx = {
    manuscript: {
      create: async (args: { data: Record<string, unknown> }) => {
        manuscriptId = String(args.data.id ?? "manuscript-large");
        return {
          id: manuscriptId,
          ...args.data
        };
      }
    },
    manuscriptVersion: {
      create: async () => ({ id: "version-1" })
    },
    manuscriptChapter: createManyOnlyDelegate(
      "manuscriptChapter",
      createManyCalls,
      sequentialCreateCalls
    ),
    scene: createManyOnlyDelegate("scene", createManyCalls, sequentialCreateCalls),
    paragraph: createManyOnlyDelegate(
      "paragraph",
      createManyCalls,
      sequentialCreateCalls
    ),
    manuscriptChunk: createManyOnlyDelegate(
      "manuscriptChunk",
      createManyCalls,
      sequentialCreateCalls
    )
  };

  await withPatchedPrisma(
    [
      [
        prisma,
        {
          $transaction: async (
            callback: (transactionClient: typeof tx) => Promise<unknown>,
            options?: { maxWait?: number; timeout?: number }
          ) => {
            transactionOptions = options;
            return callback(tx);
          }
        }
      ]
    ],
    async () => {
      const manuscript = await createStoredManuscript({
        parsed,
        chunks,
        sourceFileName: "large.docx",
        sourceMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sourceFormat: ManuscriptFormat.DOCX
      });

      assert.equal(manuscript.id, manuscriptId);
    }
  );

  assert.deepEqual(sequentialCreateCalls, []);
  assert.equal(transactionOptions?.maxWait, 10_000);
  assert.equal(transactionOptions?.timeout, 120_000);
  assert.equal(totalRows(createManyCalls, "manuscriptChapter"), expected.chapters);
  assert.equal(totalRows(createManyCalls, "scene"), expected.scenes);
  assert.equal(totalRows(createManyCalls, "paragraph"), expected.paragraphs);
  assert.equal(totalRows(createManyCalls, "manuscriptChunk"), expected.chunks);
  assert.ok(
    createManyCalls.every((call) => call.data.length <= 500),
    "all createMany calls should be bounded to safe batch sizes"
  );
  assert.ok(
    createManyCalls.filter((call) => call.model === "paragraph").length > 1,
    "large paragraph sets should be split into multiple createMany batches"
  );
  assert.ok(
    createManyCalls.filter((call) => call.model === "manuscriptChunk").length > 1,
    "large chunk sets should be split into multiple createMany batches"
  );

  const chapters = rowsFor(createManyCalls, "manuscriptChapter");
  const scenes = rowsFor(createManyCalls, "scene");
  const paragraphs = rowsFor(createManyCalls, "paragraph");
  const storedChunks = rowsFor(createManyCalls, "manuscriptChunk");
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const sceneIds = new Set(scenes.map((scene) => scene.id));

  assert.equal(chapterIds.size, expected.chapters);
  assert.equal(sceneIds.size, expected.scenes);
  assert.ok(chapters.every((chapter) => chapter.manuscriptId === manuscriptId));
  assert.ok(
    scenes.every(
      (scene) =>
        scene.manuscriptId === manuscriptId && chapterIds.has(scene.chapterId)
    )
  );
  assert.ok(
    paragraphs.every(
      (paragraph) =>
        paragraph.manuscriptId === manuscriptId &&
        chapterIds.has(paragraph.chapterId) &&
        sceneIds.has(paragraph.sceneId)
    )
  );
  assert.ok(
    storedChunks.every(
      (chunk) =>
        chunk.manuscriptId === manuscriptId &&
        chapterIds.has(chunk.chapterId) &&
        (chunk.sceneId === null || sceneIds.has(chunk.sceneId))
    )
  );
});

function createManyOnlyDelegate(
  model: string,
  createManyCalls: CreateManyCall[],
  sequentialCreateCalls: string[]
) {
  return {
    create: async () => {
      sequentialCreateCalls.push(`${model}.create`);
      throw new Error(`${model}.create should not be used for bulk upload`);
    },
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      createManyCalls.push({
        model,
        data: args.data.map((row) => ({ ...row }))
      });
      return { count: args.data.length };
    }
  };
}

async function withPatchedPrisma<T>(
  patches: Array<[object, Record<string, unknown>]>,
  callback: () => Promise<T>
) {
  const originals: Array<{
    target: object;
    key: string;
    descriptor: PropertyDescriptor | undefined;
  }> = [];

  for (const [target, patch] of patches) {
    for (const [key, value] of Object.entries(patch)) {
      originals.push({
        target,
        key,
        descriptor: Object.getOwnPropertyDescriptor(target, key)
      });
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value
      });
    }
  }

  try {
    return await callback();
  } finally {
    for (const original of originals.reverse()) {
      if (original.descriptor) {
        Object.defineProperty(original.target, original.key, original.descriptor);
      } else {
        delete (original.target as Record<string, unknown>)[original.key];
      }
    }
  }
}

function totalRows(createManyCalls: CreateManyCall[], model: string) {
  return rowsFor(createManyCalls, model).length;
}

function rowsFor(createManyCalls: CreateManyCall[], model: string) {
  return createManyCalls
    .filter((call) => call.model === model)
    .flatMap((call) => call.data);
}

function buildLargeParsedManuscript(): {
  parsed: ParsedManuscript;
  chunks: ParsedChunk[];
  expected: {
    chapters: number;
    scenes: number;
    paragraphs: number;
    chunks: number;
  };
} {
  const chapterCount = 40;
  const scenesPerChapter = 5;
  const paragraphsPerScene = 50;
  const paragraphWordCount = 10;
  const paragraphsPerChunk = 10;
  const chapters: ParsedManuscript["chapters"] = [];
  const chunks: ParsedChunk[] = [];
  const normalizedParagraphs: string[] = [];
  let globalOrder = 0;
  let chunkIndex = 0;
  let approximateOffset = 0;

  for (let chapterOrder = 1; chapterOrder <= chapterCount; chapterOrder += 1) {
    const scenes: ParsedManuscript["chapters"][number]["scenes"] = [];

    for (let sceneOrder = 1; sceneOrder <= scenesPerChapter; sceneOrder += 1) {
      const paragraphs: ParsedManuscript["chapters"][number]["scenes"][number]["paragraphs"] =
        [];
      const sceneStartParagraph = globalOrder;

      for (
        let paragraphIndex = 0;
        paragraphIndex < paragraphsPerScene;
        paragraphIndex += 1
      ) {
        const text = Array.from(
          { length: paragraphWordCount },
          (_, wordIndex) =>
            `w${chapterOrder}_${sceneOrder}_${paragraphIndex}_${wordIndex}`
        ).join(" ");

        paragraphs.push({
          text,
          wordCount: paragraphWordCount,
          globalOrder,
          chapterOrder: (sceneOrder - 1) * paragraphsPerScene + paragraphIndex,
          sceneOrder: paragraphIndex,
          approximateOffset
        });
        normalizedParagraphs.push(text);
        approximateOffset += text.length + 2;
        globalOrder += 1;
      }

      for (
        let start = sceneStartParagraph;
        start < globalOrder;
        start += paragraphsPerChunk
      ) {
        const end = Math.min(start + paragraphsPerChunk - 1, globalOrder - 1);
        chunks.push({
          chunkIndex,
          chapterOrder,
          sceneOrder,
          text: paragraphs
            .slice(start - sceneStartParagraph, end - sceneStartParagraph + 1)
            .map((paragraph) => paragraph.text)
            .join("\n\n"),
          wordCount: (end - start + 1) * paragraphWordCount,
          tokenEstimate: (end - start + 1) * paragraphWordCount,
          startParagraph: start,
          endParagraph: end,
          metadata: {
            chapterOrder,
            sceneOrder
          }
        });
        chunkIndex += 1;
      }

      scenes.push({
        order: sceneOrder,
        title: `Scene ${chapterOrder}.${sceneOrder}`,
        wordCount: paragraphsPerScene * paragraphWordCount,
        paragraphs
      });
    }

    chapters.push({
      order: chapterOrder,
      title: `Chapter ${chapterOrder}`,
      heading: `Chapter ${chapterOrder}`,
      wordCount: scenesPerChapter * paragraphsPerScene * paragraphWordCount,
      scenes
    });
  }

  return {
    parsed: {
      title: "Large Manuscript",
      normalizedText: normalizedParagraphs.join("\n\n"),
      wordCount:
        chapterCount *
        scenesPerChapter *
        paragraphsPerScene *
        paragraphWordCount,
      paragraphCount: globalOrder,
      chapters,
      metadata: {
        fixture: "large-manuscript"
      }
    },
    chunks,
    expected: {
      chapters: chapterCount,
      scenes: chapterCount * scenesPerChapter,
      paragraphs: globalOrder,
      chunks: chunks.length
    }
  };
}
