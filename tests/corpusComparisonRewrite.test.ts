import test from "node:test";
import assert from "node:assert/strict";
import { compareCorpus } from "../lib/ai/corpusComparator";
import { rewriteChapter } from "../lib/ai/chapterRewriter";

test("corpus comparison uses Book DNA fields for rewrite pattern notes", async () => {
  const result = await compareCorpus({
    manuscriptTitle: "Test Manuscript",
    targetGenre: "literary thriller",
    manuscriptLanguage: "en",
    manuscriptProfile: {
      chapterCount: 2,
      dialogueRatio: 0.1,
      openingHookType: "atmospheric"
    },
    rightsStatusCounts: {
      PUBLIC_DOMAIN: 1
    },
    benchmarkProfiles: [
      {
        bookId: "book_1",
        title: "Benchmark Book",
        author: "Public Author",
        rightsStatus: "PUBLIC_DOMAIN",
        genre: "literary thriller",
        language: "en",
        profile: {
          openingHookType: "early-conflict",
          pacingCurve: [{ chapterIndex: 1, actionRatio: 0.2 }],
          chapterEndingPatterns: [{ chapterIndex: 1, endingType: "question" }],
          literaryCraftLessons: ["Move conflict into the opening promise."]
        }
      }
    ],
    sameLanguageProfiles: [],
    sameGenreProfiles: [],
    selectedProfiles: [],
    chunkSimilarityBasis: "embedding-ready chunks plus profile filters",
    similarChunks: []
  });

  assert.match(result.json.summary, /Compared against 1 stored corpus profiles/);
  assert.equal(result.json.rewritePatternNotes?.length, 1);
  assert.match(result.json.rewritePatternNotes?.[0] ?? "", /early-conflict/);
});

test("chapter rewrite receives corpus pattern notes without full corpus books", async () => {
  const fullCorpusBookText = "FULL_CORPUS_BOOK_TEXT_SHOULD_NOT_APPEAR";
  const result = await rewriteChapter({
    manuscriptTitle: "Test Manuscript",
    targetGenre: "literary thriller",
    targetAudience: "adult",
    chapterTitle: "Chapter 1",
    chapterIndex: 1,
    originalChapter: "The fog sat over the harbor.",
    chapterAnalysis: {
      pacing: "Slow atmospheric opening."
    },
    globalRewritePlan: {
      globalStrategy: "Move conflict earlier while preserving atmosphere."
    },
    previousChapterSummaries: [],
    continuityRules: [],
    corpusPatternNotes: [
      {
        pattern: "Atmospheric opening can work if conflict arrives in chapter 1.",
        evidence: "BookProfile pattern note, not source text.",
        suggestedUse: "Preserve mood while moving the inciting incident earlier."
      }
    ]
  });

  assert.deepEqual(result.json.corpusInfluence?.patternsUsed, [
    "Atmospheric opening can work if conflict arrives in chapter 1."
  ]);
  assert.equal(result.rawText.includes(fullCorpusBookText), false);
});
