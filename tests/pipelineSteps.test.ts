import test from "node:test";
import assert from "node:assert/strict";
import {
  FULL_MANUSCRIPT_PIPELINE_STEPS,
  IMPORT_CRITICAL_MANUSCRIPT_PIPELINE_STEPS,
  isStepComplete,
  markStepComplete,
  markStepStarted,
  normalizeCheckpoint,
  pipelineProgress
} from "../lib/pipeline/steps";
import {
  runPipelineStep,
  type PipelineStepRunResult
} from "../lib/pipeline/manuscriptPipeline";
import { prisma } from "../lib/prisma";

test("pipeline checkpoint helpers make steps idempotent", () => {
  const started = markStepStarted({}, "splitIntoChunks");
  assert.equal(started.currentStep, "splitIntoChunks");
  assert.equal(isStepComplete(started, "splitIntoChunks"), false);

  const completedOnce = markStepComplete(started, "splitIntoChunks");
  const completedTwice = markStepComplete(completedOnce, "splitIntoChunks");

  assert.equal(isStepComplete(completedTwice, "splitIntoChunks"), true);
  assert.deepEqual(completedTwice.completedSteps, ["splitIntoChunks"]);
});

test("pipeline progress ignores unknown checkpoint values", () => {
  const checkpoint = normalizeCheckpoint({
    completedSteps: ["splitIntoChunks", "unknown"]
  });
  const progress = pipelineProgress(checkpoint);

  assert.equal(progress.completed, 1);
  assert.equal(progress.total > 1, true);
});

test("import-critical pipeline steps stay as the prereview prefix", () => {
  assert.deepEqual(
    FULL_MANUSCRIPT_PIPELINE_STEPS.slice(
      0,
      IMPORT_CRITICAL_MANUSCRIPT_PIPELINE_STEPS.length
    ),
    [...IMPORT_CRITICAL_MANUSCRIPT_PIPELINE_STEPS]
  );
});

test("pipeline import steps create structure from a shell idempotently", async () => {
  const db = createImportDb();

  await withPatchedPrisma(createImportPatches(db), async () => {
    await runPipelineStep(
      "parseAndNormalizeManuscript",
      db.manuscript.id,
      "run-1"
    );
    assert.equal(db.manuscript.status, "PARSED");
    assert.equal(db.manuscript.wordCount > 0, true);

    await runPipelineStep("splitIntoChapters", db.manuscript.id, "run-1");
    assert.equal(db.chapters.length, 2);
    assert.equal(db.scenes.length, 2);
    assert.equal(db.paragraphs.length, 4);
    assert.equal(db.manuscript.status, "CHAPTERS_READY");

    await runPipelineStep("splitIntoChunks", db.manuscript.id, "run-1");
    assert.equal(db.chunks.length > 0, true);
    assert.equal(db.manuscript.status, "CHUNKS_READY");

    const counts = {
      chapters: db.chapters.length,
      scenes: db.scenes.length,
      paragraphs: db.paragraphs.length,
      chunks: db.chunks.length
    };

    await runPipelineStep("splitIntoChapters", db.manuscript.id, "run-1");
    await runPipelineStep("splitIntoChunks", db.manuscript.id, "run-1");

    assert.deepEqual(
      {
        chapters: db.chapters.length,
        scenes: db.scenes.length,
        paragraphs: db.paragraphs.length,
        chunks: db.chunks.length
      },
      counts
    );
  });
});

test("deep analysis is blocked when import created no chapters", async () => {
  const db = createImportDb();
  const oldDatabaseUrl = process.env.DATABASE_URL;

  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

  try {
    await withPatchedPrisma(createImportPatches(db), async () => {
      const result = (await runPipelineStep(
        "createEmbeddingsForChunks",
        db.manuscript.id,
        "run-1"
      )) as PipelineStepRunResult;

      assert.equal(result.complete, false);
      assert.equal(result.blockedReason, "manuscript_has_no_chapters");
      assert.equal(result.missingArtifact, "chapters");
      assert.match(String(result.artifactReason), /No chapters/i);
    });
  } finally {
    restoreEnv("DATABASE_URL", oldDatabaseUrl);
  }
});

test("deep analysis is blocked when import created no chunks", async () => {
  const db = createImportDb();
  const oldDatabaseUrl = process.env.DATABASE_URL;

  db.chapters.push({
    id: "chapter-1",
    manuscriptId: db.manuscript.id,
    order: 1,
    chapterIndex: 1,
    title: "Chapter One",
    heading: "Chapter One",
    text: "A chapter without chunks.",
    wordCount: 4
  });

  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

  try {
    await withPatchedPrisma(createImportPatches(db), async () => {
      const result = (await runPipelineStep(
        "createEmbeddingsForChunks",
        db.manuscript.id,
        "run-1"
      )) as PipelineStepRunResult;

      assert.equal(result.complete, false);
      assert.equal(result.blockedReason, "manuscript_has_no_chunks");
      assert.equal(result.missingArtifact, "chunks");
      assert.match(String(result.artifactReason), /No chunks/i);
    });
  } finally {
    restoreEnv("DATABASE_URL", oldDatabaseUrl);
  }
});

function createImportDb() {
  const manuscript = {
    id: "shell-import-1",
    title: "Shell Import",
    sourceFileName: "shell.txt",
    sourceMimeType: "text/plain",
    sourceFormat: "TXT",
    originalText:
      "Chapter One\n\nA door opens.\n\nA choice is made.\n\nChapter Two\n\nThe cost arrives.\n\nThe promise deepens.",
    wordCount: 0,
    chapterCount: 0,
    paragraphCount: 0,
    chunkCount: 0,
    status: "IMPORT_QUEUED",
    analysisStatus: "NOT_STARTED",
    targetGenre: "Fantasy",
    targetAudience: "Adult",
    metadata: null,
    versions: [
      {
        sourceText:
          "Chapter One\n\nA door opens.\n\nA choice is made.\n\nChapter Two\n\nThe cost arrives.\n\nThe promise deepens."
      }
    ]
  };

  return {
    manuscript,
    chapters: [] as Array<Record<string, unknown>>,
    scenes: [] as Array<Record<string, unknown>>,
    paragraphs: [] as Array<Record<string, unknown>>,
    chunks: [] as Array<Record<string, unknown>>
  };
}

function createImportPatches(db: ReturnType<typeof createImportDb>) {
  const tx = {
    manuscriptChunk: {
      deleteMany: async () => {
        db.chunks = [];
        return { count: 0 };
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        for (const row of args.data) {
          if (
            !db.chunks.some(
              (chunk) => chunk.chunkIndex === row.chunkIndex
            )
          ) {
            db.chunks.push({ id: `chunk-${db.chunks.length + 1}`, ...row });
          }
        }
        return { count: args.data.length };
      }
    },
    paragraph: {
      deleteMany: async () => {
        db.paragraphs = [];
        return { count: 0 };
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        for (const row of args.data) {
          if (
            !db.paragraphs.some(
              (paragraph) => paragraph.globalOrder === row.globalOrder
            )
          ) {
            db.paragraphs.push({
              id: `paragraph-${db.paragraphs.length + 1}`,
              ...row
            });
          }
        }
        return { count: args.data.length };
      }
    },
    scene: {
      deleteMany: async () => {
        db.scenes = [];
        return { count: 0 };
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        for (const row of args.data) {
          if (
            !db.scenes.some(
              (scene) =>
                scene.chapterId === row.chapterId && scene.order === row.order
            )
          ) {
            db.scenes.push(row);
          }
        }
        return { count: args.data.length };
      }
    },
    manuscriptChapter: {
      deleteMany: async () => {
        db.chapters = [];
        return { count: 0 };
      },
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        for (const row of args.data) {
          if (!db.chapters.some((chapter) => chapter.order === row.order)) {
            db.chapters.push(row);
          }
        }
        return { count: args.data.length };
      }
    },
    manuscript: {
      update: async (args: { data: Record<string, unknown> }) => {
        Object.assign(db.manuscript, args.data);
        return db.manuscript;
      }
    }
  };

  return [
    [
      prisma,
      {
        $transaction: async (
          callback: (transactionClient: typeof tx) => Promise<unknown>
        ) => callback(tx)
      }
    ],
    [
      prisma.manuscript,
      {
        findUnique: async (args: { select?: Record<string, unknown> } = {}) =>
          args.select?.chunkCount
            ? { chunkCount: db.manuscript.chunkCount }
            : db.manuscript,
        findUniqueOrThrow: async () => ({
          ...db.manuscript,
          chapters: db.chapters
            .sort((a, b) => Number(a.order) - Number(b.order))
            .map((chapter) => ({
              ...chapter,
              scenes: db.scenes
                .filter((scene) => scene.chapterId === chapter.id)
                .sort((a, b) => Number(a.order) - Number(b.order))
                .map((scene) => ({
                  ...scene,
                  paragraphs: db.paragraphs
                    .filter((paragraph) => paragraph.sceneId === scene.id)
                    .sort(
                      (a, b) =>
                        Number(a.globalOrder) - Number(b.globalOrder)
                    )
                }))
            }))
        }),
        update: async (args: { data: Record<string, unknown> }) => {
          Object.assign(db.manuscript, args.data);
          return db.manuscript;
        }
      }
    ],
    [
      prisma.manuscriptChapter,
      {
        count: async () => db.chapters.length,
        findMany: async (args: { include?: Record<string, unknown> } = {}) =>
          db.chapters.map((chapter) => ({
            ...chapter,
            paragraphs: args.include?.paragraphs
              ? db.paragraphs.filter(
                  (paragraph) => paragraph.chapterId === chapter.id
                )
              : undefined,
            scenes: args.include?.scenes
              ? db.scenes.filter((scene) => scene.chapterId === chapter.id)
              : undefined
          })),
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const chapter = db.chapters.find(
            (candidate) => candidate.id === args.where.id
          );
          assert.ok(chapter);
          Object.assign(chapter, args.data);
          return chapter;
        }
      }
    ],
    [
      prisma.paragraph,
      {
        count: async () => db.paragraphs.length
      }
    ],
    [
      prisma.manuscriptChunk,
      {
        count: async () => db.chunks.length,
        findMany: async () => db.chunks,
        update: async (args: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const chunk = db.chunks.find(
            (candidate) => candidate.id === args.where.id
          );
          assert.ok(chunk);
          Object.assign(chunk, args.data);
          return chunk;
        }
      }
    ]
  ] as Array<[object, Record<string, unknown>]>;
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
