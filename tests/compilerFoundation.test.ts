import test from "node:test";
import assert from "node:assert/strict";
import { buildManuscriptNodes } from "../lib/compiler/nodes";
import {
  compileSceneDigests,
  extractNarrativeMemory
} from "../lib/compiler/compiler";
import { prisma } from "../lib/prisma";
import {
  setOpenAIClientForTest,
  type OpenAIClient
} from "../lib/analysis/openai";

test("buildManuscriptNodes creates stable book chapter scene and chunk nodes", async () => {
  const db = createCompilerDb();

  await withPatchedPrisma(createNodePatches(db), async () => {
    const first = await buildManuscriptNodes(db.manuscript.id);
    const second = await buildManuscriptNodes(db.manuscript.id);

    assert.equal(first.nodeCount, 4);
    assert.equal(second.nodeCount, 4);
    assert.equal(db.nodes.length, 4);
    assert.deepEqual(
      db.nodes.map((node) => node.type),
      ["BOOK", "CHAPTER", "SCENE", "CHUNK"]
    );
  });
});

test("compileSceneDigests saves artifact and durable memory rows", async () => {
  const db = createCompilerDb();
  db.nodes.push({
    id: "scene-node-1",
    key: "node:scene",
    manuscriptId: db.manuscript.id,
    type: "SCENE",
    sceneId: "scene-1"
  });
  const requests: Array<Record<string, unknown>> = [];
  const restoreOpenAI = setOpenAIClientForTest(
    fakeOpenAIClient(requests, {
      summary: "A door opens and a choice is made.",
      scenePurpose: "Opening pressure.",
      emotionalMovement: "Curiosity to commitment.",
      conflict: "The protagonist must choose.",
      tensionLevel: 0.6,
      characterAppearances: [{ name: "Protagonist", emotionalState: "alert" }],
      keyEvents: [{ eventText: "The door opens." }],
      continuityFacts: [{ factText: "The door opens in chapter one." }],
      openThreads: ["What lies beyond the door?"],
      styleNotes: ["Direct prose"],
      mustNotForget: ["The choice is voluntary."],
      uncertainties: [],
      sourceAnchors: ["door opens"]
    })
  );

  try {
    await withPatchedPrisma(createSceneDigestPatches(db), async () => {
      const first = await compileSceneDigests(db.manuscript.id, { maxItems: 1 });
      const second = await compileSceneDigests(db.manuscript.id, { maxItems: 1 });

      assert.equal(first.compiled, 1);
      assert.equal(first.remaining, 0);
      assert.equal(second.compiled, 0);
      assert.equal(db.artifacts.length, 1);
      assert.equal(db.artifacts[0].artifactType, "SCENE_DIGEST");
      assert.equal(db.facts.length, 1);
      assert.equal(db.characters.length, 1);
      assert.equal(db.events.length, 1);
      assert.equal(db.styles.length, 1);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].model, "gpt-5.4-mini");
      assert.equal(requests[0].reasoning_effort, "medium");
    });
  } finally {
    restoreOpenAI();
  }
});

test("extractNarrativeMemory resumes pending scene digests across manual batches", async () => {
  const db = createCompilerDb();
  db.artifacts.push(...sceneDigestArtifacts(db.manuscript.id, 6));

  await withPatchedPrisma(createNarrativeMemoryExtractionPatches(db), async () => {
    const first = await extractNarrativeMemory(db.manuscript.id, { maxItems: 4 });
    const second = await extractNarrativeMemory(db.manuscript.id, { maxItems: 4 });
    const third = await extractNarrativeMemory(db.manuscript.id, { maxItems: 4 });

    assert.deepEqual(first, {
      refreshed: 4,
      total: 6,
      remaining: 2,
      complete: false
    });
    assert.deepEqual(second, {
      refreshed: 2,
      total: 6,
      remaining: 0,
      complete: true
    });
    assert.deepEqual(third, {
      refreshed: 0,
      total: 6,
      remaining: 0,
      complete: true
    });
    assert.deepEqual(
      db.facts.map((fact) => recordValue(fact.metadata)?.sourceArtifactId),
      [
        "artifact-1",
        "artifact-2",
        "artifact-3",
        "artifact-4",
        "artifact-5",
        "artifact-6"
      ]
    );
    assert.equal(db.styles.length, 6);
  });
});

test("extractNarrativeMemory completes when there are no scene digests", async () => {
  const db = createCompilerDb();

  await withPatchedPrisma(createNarrativeMemoryExtractionPatches(db), async () => {
    const result = await extractNarrativeMemory(db.manuscript.id, { maxItems: 4 });

    assert.deepEqual(result, {
      refreshed: 0,
      total: 0,
      remaining: 0,
      complete: true
    });
  });
});

function createCompilerDb() {
  const chapter = {
    id: "chapter-1",
    manuscriptId: "compiler-manuscript-1",
    order: 1,
    chapterIndex: 1,
    title: "Chapter One",
    heading: "Chapter One",
    text: "A door opens.\n\nA choice is made.",
    summary: null,
    wordCount: 7,
    status: "CHAPTER_READY",
    startOffset: 0,
    endOffset: 32,
    createdAt: new Date()
  };
  const scene = {
    id: "scene-1",
    manuscriptId: "compiler-manuscript-1",
    chapterId: chapter.id,
    order: 1,
    title: "Scene 1",
    wordCount: 7,
    marker: null,
    createdAt: new Date(),
    chapter,
    paragraphs: [
      {
        id: "paragraph-1",
        manuscriptId: "compiler-manuscript-1",
        chapterId: chapter.id,
        sceneId: "scene-1",
        globalOrder: 0,
        chapterOrder: 0,
        sceneOrder: 0,
        text: "A door opens.",
        wordCount: 3,
        approximateOffset: 0,
        createdAt: new Date()
      },
      {
        id: "paragraph-2",
        manuscriptId: "compiler-manuscript-1",
        chapterId: chapter.id,
        sceneId: "scene-1",
        globalOrder: 1,
        chapterOrder: 1,
        sceneOrder: 1,
        text: "A choice is made.",
        wordCount: 4,
        approximateOffset: 15,
        createdAt: new Date()
      }
    ]
  };
  const chunk = {
    id: "chunk-1",
    manuscriptId: "compiler-manuscript-1",
    chapterId: chapter.id,
    sceneId: scene.id,
    chunkIndex: 0,
    text: "A door opens.\n\nA choice is made.",
    wordCount: 7,
    startParagraph: 0,
    endParagraph: 1,
    paragraphStart: 0,
    paragraphEnd: 1,
    tokenEstimate: 10,
    tokenCount: 10,
    metadata: null,
    localMetrics: null,
    summary: null,
    embedding: null,
    createdAt: new Date()
  };

  return {
    manuscript: {
      id: "compiler-manuscript-1",
      title: "Compiler Manuscript",
      targetGenre: "Fantasy",
      targetAudience: "Adult",
      sourceFileName: "compiler.txt",
      originalText: "Chapter One\n\nA door opens.\n\nA choice is made.",
      wordCount: 9,
      chapterCount: 1
    },
    chapter,
    scene,
    chunk,
    nodes: [] as Array<Record<string, unknown>>,
    artifacts: [] as Array<Record<string, unknown>>,
    facts: [] as Array<Record<string, unknown>>,
    characters: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    styles: [] as Array<Record<string, unknown>>
  };
}

function createNodePatches(db: ReturnType<typeof createCompilerDb>) {
  return [
    [
      prisma.manuscript,
      {
        findUniqueOrThrow: async () => ({
          ...db.manuscript,
          chapters: [{ ...db.chapter, scenes: [db.scene] }],
          chunks: [db.chunk]
        })
      }
    ],
    [
      prisma.manuscriptNode,
      {
        upsert: async (args: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = db.nodes.find((node) => node.key === args.where.key);
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          const node = { id: `node-${db.nodes.length + 1}`, ...args.create };
          db.nodes.push(node);
          return node;
        }
      }
    ]
  ] as Array<[object, Record<string, unknown>]>;
}

function createSceneDigestPatches(db: ReturnType<typeof createCompilerDb>) {
  const tx = memoryTransaction(db);

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
        findUniqueOrThrow: async () => ({
          ...db.manuscript,
          chapters: [db.chapter]
        })
      }
    ],
    [
      prisma.scene,
      {
        findMany: async () => [db.scene]
      }
    ],
    [
      prisma.manuscriptNode,
      {
        findFirst: async () => db.nodes[0] ?? null,
        updateMany: async () => ({ count: 1 })
      }
    ],
    [
      prisma.compilerArtifact,
      {
        findFirst: async (args: { where: Record<string, unknown> }) =>
          db.artifacts.find(
            (artifact) =>
              artifact.manuscriptId === args.where.manuscriptId &&
              artifact.artifactType === args.where.artifactType &&
              artifact.inputHash === args.where.inputHash
          ) ?? null,
        upsert: async (args: {
          where: {
            manuscriptId_artifactType_inputHash: {
              manuscriptId: string;
              artifactType: string;
              inputHash: string;
            };
          };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = args.where.manuscriptId_artifactType_inputHash;
          const existing = db.artifacts.find(
            (artifact) =>
              artifact.manuscriptId === key.manuscriptId &&
              artifact.artifactType === key.artifactType &&
              artifact.inputHash === key.inputHash
          );
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          const artifact = {
            id: `artifact-${db.artifacts.length + 1}`,
            createdAt: new Date(),
            ...args.create
          };
          db.artifacts.push(artifact);
          return artifact;
        }
      }
    ]
  ] as Array<[object, Record<string, unknown>]>;
}

function createNarrativeMemoryExtractionPatches(
  db: ReturnType<typeof createCompilerDb>
) {
  const tx = memoryTransaction(db);

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
      prisma.compilerArtifact,
      {
        findMany: async (args: { where?: Record<string, unknown> } = {}) =>
          db.artifacts.filter((artifact) => matchesWhere(artifact, args.where))
      }
    ],
    [prisma.narrativeFact, tx.narrativeFact],
    [prisma.characterState, tx.characterState],
    [prisma.plotEvent, tx.plotEvent],
    [prisma.styleFingerprint, tx.styleFingerprint]
  ] as Array<[object, Record<string, unknown>]>;
}

function memoryTransaction(db: ReturnType<typeof createCompilerDb>) {
  return {
    narrativeFact: memoryDelegate(db.facts),
    characterState: memoryDelegate(db.characters),
    plotEvent: memoryDelegate(db.events),
    styleFingerprint: styleFingerprintDelegate(db)
  };
}

function memoryDelegate(rows: Array<Record<string, unknown>>) {
  return {
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      rows.filter((row) => matchesWhere(row, args.where)),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
      const before = rows.length;
      const remaining = rows.filter((row) => !matchesWhere(row, args.where));
      rows.splice(0, rows.length, ...remaining);
      return { count: before - rows.length };
    },
    createMany: async (args: { data: Array<Record<string, unknown>> }) => {
      rows.push(
        ...args.data.map((row, index) => ({
          id: `memory-${rows.length + index + 1}`,
          ...row
        }))
      );
      return { count: args.data.length };
    }
  };
}

function styleFingerprintDelegate(db: ReturnType<typeof createCompilerDb>) {
  return {
    findMany: async (args: { where?: Record<string, unknown> } = {}) =>
      db.styles.filter((style) => matchesWhere(style, args.where)),
    deleteMany: async (args: { where?: Record<string, unknown> } = {}) => {
      const before = db.styles.length;
      db.styles = db.styles.filter((style) => !matchesWhere(style, args.where));
      return { count: before - db.styles.length };
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const row = { id: `style-${db.styles.length + 1}`, ...args.data };
      db.styles.push(row);
      return row;
    }
  };
}

function sceneDigestArtifacts(manuscriptId: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const item = index + 1;

    return {
      id: `artifact-${item}`,
      manuscriptId,
      nodeId: `scene-node-${item}`,
      chapterId: "chapter-1",
      sceneId: `scene-${item}`,
      artifactType: "SCENE_DIGEST",
      model: "stub",
      reasoningEffort: "none",
      promptVersion: "compiler-v1",
      inputHash: `scene-digest-${item}`,
      output: {
        summary: `Scene ${item} summary.`,
        continuityFacts: [{ factText: `Fact ${item}.` }],
        characterAppearances: [],
        keyEvents: [],
        styleNotes: ["Direct prose"],
        mustNotForget: []
      },
      rawText: "{}",
      status: "COMPLETED",
      error: null,
      createdAt: new Date(`2026-05-01T08:00:0${item}Z`)
    };
  });
}

function fakeOpenAIClient(
  requests: Array<Record<string, unknown>>,
  jsonResponse: unknown
): OpenAIClient {
  return {
    chat: {
      completions: {
        create: async (request: Record<string, unknown>) => {
          requests.push(request);
          return {
            choices: [{ message: { content: JSON.stringify(jsonResponse) } }]
          };
        }
      }
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1] }] })
    }
  } as unknown as OpenAIClient;
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

function matchesWhere(item: Record<string, unknown>, where: Record<string, unknown> = {}) {
  if (!where) {
    return true;
  }

  const or = Array.isArray(where.OR) ? where.OR : [];
  if (or.length > 0 && !or.some((part) => matchesWhere(item, recordValue(part) ?? {}))) {
    return false;
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR") {
      continue;
    }
    if (!matchesField(item[key], expected)) {
      return false;
    }
  }

  return true;
}

function matchesField(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object" || expected instanceof Date) {
    return actual === expected;
  }

  const record = recordValue(expected);
  if (!record) {
    return actual === expected;
  }

  if (Array.isArray(record.in)) {
    return record.in.includes(actual);
  }

  if (record.path && record.equals !== undefined) {
    return nestedValue(actual, record.path) === record.equals;
  }

  return Object.entries(record).every(([key, value]) =>
    matchesField(recordValue(actual)?.[key], value)
  );
}

function nestedValue(value: unknown, path: unknown) {
  if (!Array.isArray(path)) {
    return undefined;
  }

  return path.reduce<unknown>((current, segment) => {
    const record = recordValue(current);
    return record ? record[String(segment)] : undefined;
  }, value);
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
