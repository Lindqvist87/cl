import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContinuityLedger,
  latestAcceptedRewriteByChapter,
  previousChapterContexts
} from "../lib/rewrite/continuity";

const now = new Date("2026-01-02T00:00:00Z");

test("latestAcceptedRewriteByChapter selects newest accepted rewrite only", () => {
  const rewrites = latestAcceptedRewriteByChapter([
    {
      id: "draft",
      chapterId: "c1",
      status: "DRAFT",
      version: 3,
      rewrittenText: "draft",
      content: "draft",
      createdAt: new Date("2026-01-03T00:00:00Z")
    },
    {
      id: "old",
      chapterId: "c1",
      status: "ACCEPTED",
      version: 1,
      rewrittenText: "old accepted",
      content: "old accepted",
      createdAt: new Date("2026-01-01T00:00:00Z")
    },
    {
      id: "new",
      chapterId: "c1",
      status: "ACCEPTED",
      version: 2,
      rewrittenText: "new accepted",
      content: "new accepted",
      createdAt: now
    }
  ]);

  assert.equal(rewrites.get("c1")?.id, "new");
});

test("previousChapterContexts treats accepted previous chapters as canon", () => {
  const accepted = latestAcceptedRewriteByChapter([
    {
      id: "r1",
      chapterId: "c1",
      status: "ACCEPTED",
      version: 2,
      rewrittenText: "accepted rewritten chapter text with carried facts",
      content: "",
      continuityNotes: { fact: "key carried fact" },
      createdAt: now
    }
  ]);
  const contexts = previousChapterContexts(
    [
      { id: "c1", order: 1, title: "Chapter 1", summary: "original summary" },
      { id: "c2", order: 2, title: "Chapter 2", summary: "current" }
    ],
    2,
    accepted,
    4
  );

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].canonStatus, "accepted_rewrite");
  assert.equal(contexts[0].acceptedRewriteId, "r1");
  assert.deepEqual(contexts[0].continuityNotes, { fact: "key carried fact" });

  const ledger = buildContinuityLedger({
    continuityRules: ["preserve names"],
    previousChapters: contexts
  });

  assert.equal(ledger.acceptedCanonChapterCount, 1);
  assert.equal(ledger.acceptedCanon[0].chapterId, "c1");
});
