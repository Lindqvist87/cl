import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRawEditorialMemoryItems,
  markEditorialMemoryForAnchorChanges,
  normalizeEditorialMemoryItems,
  planAnchorStaleUpdates,
  upsertEditorialMemoryItemsFromRawOutput
} from "../lib/editorialMemory";

test("raw editorial memory output normalizes into stable canonical items", () => {
  const raw = {
    memories: [
      {
        type: "Character Fact",
        title: "Mira hides the map",
        content: "Mira knows where the salt map is hidden.",
        confidence: 1.4,
        anchors: [{ chapterId: "chapter-1", textHash: "hash-a", revision: 1 }]
      },
      {
        type: "empty",
        content: " "
      }
    ]
  };

  const normalized = normalizeEditorialMemoryItems(extractRawEditorialMemoryItems(raw));

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].type, "character_fact");
  assert.equal(normalized[0].title, "Mira hides the map");
  assert.equal(normalized[0].confidence, 1);
  assert.match(normalized[0].key, /^character_fact:/);
  assert.deepEqual(normalized[0].anchors[0], {
    nodeId: null,
    chapterId: "chapter-1",
    sceneId: null,
    chunkId: null,
    paragraphStart: null,
    paragraphEnd: null,
    startOffset: null,
    endOffset: null,
    textHash: "hash-a",
    revision: 1,
    sourceTextSnippet: null,
    metadata: null
  });
});

test("upsertEditorialMemoryItemsFromRawOutput stores item source anchors and revision", async () => {
  const db = createMemoryDb();

  const result = await upsertEditorialMemoryItemsFromRawOutput(
    {
      manuscriptId: "manuscript-1",
      analysisRunId: "run-1",
      analysisOutputId: "output-1",
      snapshotId: "snapshot-1",
      rawOutput: {
        memories: [
          {
            key: "character:mira:map",
            type: "character_fact",
            title: "Mira knows the map",
            content: "Mira knows where the salt map is hidden.",
            confidence: 0.82,
            anchors: [
              {
                nodeId: "node-1",
                chapterId: "chapter-1",
                textHash: "hash-a",
                revision: 1,
                sourceTextSnippet: "salt map is hidden"
              }
            ]
          }
        ]
      },
      source: {
        sourceType: "analysis_output",
        sourceId: "output-1",
        promptVersion: "memory-v1",
        model: "gpt-5.4-mini",
        provenance: { passType: "CHAPTER_AUDIT" }
      }
    },
    db
  );

  assert.deepEqual(result, {
    upserted: 1,
    created: 1,
    updated: 0,
    sourceRows: 1,
    anchorRows: 1,
    revisionRows: 1,
    itemKeys: ["character:mira:map"]
  });
  assert.equal(db.items[0].status, "ACTIVE");
  assert.equal(db.sources[0].analysisRunId, "run-1");
  assert.equal(db.sources[0].analysisOutputId, "output-1");
  assert.equal(db.sources[0].snapshotId, "snapshot-1");
  assert.equal(db.sources[0].sourceType, "analysis_output");
  assert.equal(db.sources[0].provenance.passType, "CHAPTER_AUDIT");
  assert.equal(db.anchors[0].textHash, "hash-a");
  assert.equal(db.revisions[0].toStatus, "ACTIVE");
});

test("upsert refreshes existing memory item and replaces anchors", async () => {
  const db = createMemoryDb();
  db.items.push({
    id: "item-1",
    manuscriptId: "manuscript-1",
    key: "plot:door",
    type: "plot_fact",
    title: "Door",
    content: "Old content.",
    confidence: 0.4,
    status: "STALE"
  });
  db.anchors.push({
    id: "anchor-1",
    itemId: "item-1",
    manuscriptId: "manuscript-1",
    chapterId: "old-chapter",
    status: "STALE"
  });

  const result = await upsertEditorialMemoryItemsFromRawOutput(
    {
      manuscriptId: "manuscript-1",
      rawOutput: {
        items: [
          {
            key: "plot:door",
            type: "plot_fact",
            content: "The black door opens only after the oath.",
            anchors: [{ chapterId: "chapter-2", textHash: "hash-b" }]
          }
        ]
      }
    },
    db
  );

  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(db.items[0].status, "ACTIVE");
  assert.equal(db.items[0].content, "The black door opens only after the oath.");
  assert.equal(db.anchors.length, 1);
  assert.equal(db.anchors[0].chapterId, "chapter-2");
  assert.equal(db.revisions[0].fromStatus, "STALE");
});

test("anchor change planner distinguishes text reanchor from stale revision", () => {
  const plan = planAnchorStaleUpdates(
    [
      {
        id: "anchor-1",
        itemId: "item-1",
        manuscriptId: "manuscript-1",
        chapterId: "chapter-1",
        textHash: "hash-a",
        revision: 1,
        status: "ACTIVE"
      },
      {
        id: "anchor-2",
        itemId: "item-2",
        manuscriptId: "manuscript-1",
        nodeId: "node-2",
        textHash: "hash-b",
        revision: 1,
        status: "ACTIVE"
      }
    ],
    [
      { chapterId: "chapter-1", textHash: "hash-changed" },
      { nodeId: "node-2", revision: 2 }
    ]
  );

  assert.deepEqual(
    plan.map((entry) => ({
      anchorId: entry.anchorId,
      itemId: entry.itemId,
      status: entry.status
    })),
    [
      { anchorId: "anchor-1", itemId: "item-1", status: "NEEDS_REANCHOR" },
      { anchorId: "anchor-2", itemId: "item-2", status: "STALE" }
    ]
  );
});

test("markEditorialMemoryForAnchorChanges updates items anchors and revision log", async () => {
  const db = createMemoryDb();
  db.items.push(
    {
      id: "item-1",
      manuscriptId: "manuscript-1",
      key: "character:mira",
      type: "character_fact",
      content: "Mira carries the map.",
      status: "ACTIVE"
    },
    {
      id: "item-2",
      manuscriptId: "manuscript-1",
      key: "plot:oath",
      type: "plot_fact",
      content: "The oath opens the door.",
      status: "ACTIVE"
    }
  );
  db.anchors.push(
    {
      id: "anchor-1",
      itemId: "item-1",
      manuscriptId: "manuscript-1",
      chapterId: "chapter-1",
      textHash: "hash-a",
      revision: 1,
      status: "ACTIVE"
    },
    {
      id: "anchor-2",
      itemId: "item-2",
      manuscriptId: "manuscript-1",
      nodeId: "node-2",
      textHash: "hash-b",
      revision: 1,
      status: "ACTIVE"
    }
  );

  const result = await markEditorialMemoryForAnchorChanges(
    "manuscript-1",
    [
      { chapterId: "chapter-1", textHash: "hash-changed" },
      { nodeId: "node-2", revision: 2 }
    ],
    db
  );

  assert.deepEqual(result, {
    staleItems: 1,
    needsReanchorItems: 1,
    staleAnchors: 1,
    needsReanchorAnchors: 1,
    revisionRows: 2
  });
  assert.equal(db.items.find((item) => item.id === "item-1")?.status, "NEEDS_REANCHOR");
  assert.equal(db.items.find((item) => item.id === "item-2")?.status, "STALE");
  assert.equal(db.anchors.find((anchor) => anchor.id === "anchor-1")?.status, "NEEDS_REANCHOR");
  assert.equal(db.anchors.find((anchor) => anchor.id === "anchor-2")?.status, "STALE");
  assert.deepEqual(
    db.revisions.map((revision) => revision.toStatus).sort(),
    ["NEEDS_REANCHOR", "STALE"]
  );
});

function createMemoryDb() {
  const db = {
    items: [] as Array<Record<string, any>>,
    sources: [] as Array<Record<string, any>>,
    anchors: [] as Array<Record<string, any>>,
    revisions: [] as Array<Record<string, any>>,
    editorialMemoryItem: {
      findUnique: async (args: { where: Record<string, any> }) => {
        if (args.where.id) {
          return db.items.find((item) => item.id === args.where.id) ?? null;
        }
        const key = args.where.manuscriptId_key;
        return (
          db.items.find(
            (item) =>
              item.manuscriptId === key.manuscriptId && item.key === key.key
          ) ?? null
        );
      },
      upsert: async (args: {
        where: { manuscriptId_key: { manuscriptId: string; key: string } };
        create: Record<string, any>;
        update: Record<string, any>;
      }) => {
        const existing = db.items.find(
          (item) =>
            item.manuscriptId === args.where.manuscriptId_key.manuscriptId &&
            item.key === args.where.manuscriptId_key.key
        );
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const item = { id: `item-${db.items.length + 1}`, ...args.create };
        db.items.push(item);
        return item;
      },
      update: async (args: { where: { id: string }; data: Record<string, any> }) => {
        const item = db.items.find((candidate) => candidate.id === args.where.id);
        assert.ok(item);
        Object.assign(item, args.data);
        return item;
      }
    },
    editorialMemorySource: {
      create: async (args: { data: Record<string, any> }) => {
        const source = { id: `source-${db.sources.length + 1}`, ...args.data };
        db.sources.push(source);
        return source;
      }
    },
    editorialMemoryAnchor: {
      findMany: async (args: { where?: Record<string, any> } = {}) =>
        db.anchors.filter((anchor) => matchesWhere(anchor, args.where)),
      deleteMany: async (args: { where?: Record<string, any> } = {}) => {
        const before = db.anchors.length;
        db.anchors = db.anchors.filter((anchor) => !matchesWhere(anchor, args.where));
        return { count: before - db.anchors.length };
      },
      createMany: async (args: { data: Array<Record<string, any>> }) => {
        db.anchors.push(
          ...args.data.map((anchor, index) => ({
            id: `anchor-${db.anchors.length + index + 1}`,
            ...anchor
          }))
        );
        return { count: args.data.length };
      },
      updateMany: async (args: { where?: Record<string, any>; data: Record<string, any> }) => {
        const anchors = db.anchors.filter((anchor) => matchesWhere(anchor, args.where));
        anchors.forEach((anchor) => Object.assign(anchor, args.data));
        return { count: anchors.length };
      }
    },
    editorialMemoryRevision: {
      create: async (args: { data: Record<string, any> }) => {
        const revision = { id: `revision-${db.revisions.length + 1}`, ...args.data };
        db.revisions.push(revision);
        return revision;
      }
    }
  };

  return db;
}

function matchesWhere(item: Record<string, any>, where: Record<string, any> = {}) {
  if (!where) {
    return true;
  }

  const or = Array.isArray(where.OR) ? where.OR : [];
  if (or.length > 0 && !or.some((part) => matchesWhere(item, part))) {
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
  if (expected === null || typeof expected !== "object") {
    return actual === expected;
  }

  const record = expected as Record<string, unknown>;
  if (Array.isArray(record.in)) {
    return record.in.includes(actual);
  }

  return Object.entries(record).every(([key, value]) =>
    matchesField((actual as Record<string, unknown> | null)?.[key], value)
  );
}
