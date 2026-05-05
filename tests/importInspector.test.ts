import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportInspectorData,
  textPreview
} from "../lib/editorial/importInspector";

test("import inspector calculates section stats and averages", () => {
  const inspection = buildImportInspectorData({
    manuscript: {
      wordCount: 2400,
      chunkCount: 4
    },
    sections: [
      {
        id: "c2",
        order: 2,
        title: "Chapter 2",
        heading: "Chapter 2",
        text: "Second chapter text.",
        wordCount: 1000,
        chunks: [
          { id: "k3", chunkIndex: 3, text: "Chunk three", wordCount: 500 },
          { id: "k2", chunkIndex: 2, text: "Chunk two", wordCount: 500 }
        ]
      },
      {
        id: "c1",
        order: 1,
        title: "Chapter 1",
        heading: "Chapter 1",
        text: "Opening chapter text.",
        wordCount: 1400,
        chunks: [
          { id: "k0", chunkIndex: 0, text: "Chunk zero", wordCount: 700 },
          { id: "k1", chunkIndex: 1, text: "Chunk one", wordCount: 700 }
        ]
      }
    ]
  });

  assert.deepEqual(inspection.stats, {
    totalWords: 2400,
    detectedSections: 2,
    chunkCount: 4,
    averageWordsPerSection: 1200,
    averageChunksPerSection: 2,
    warningCount: 0
  });
  assert.deepEqual(
    inspection.sections.map((section) => section.id),
    ["c1", "c2"]
  );
  assert.deepEqual(
    inspection.sections[1].chunks.map((chunk) => chunk.chunkIndex),
    [2, 3]
  );
});

test("import inspector derives deterministic structure warnings", () => {
  const inspection = buildImportInspectorData({
    manuscript: {
      wordCount: 100,
      chunkCount: 0
    },
    sections: [
      {
        id: "c1",
        order: 1,
        title: "",
        text: "A very brief imported section.",
        wordCount: 5,
        chunks: []
      }
    ]
  });

  assert.deepEqual(
    inspection.warnings.map((warning) => warning.code),
    [
      "no_chunks",
      "missing_title",
      "unknown_section_type",
      "very_short_section",
      "no_chunks",
      "possible_false_chapter_split"
    ]
  );
  assert.equal(
    inspection.sections[0].warnings.find(
      (warning) => warning.code === "possible_false_chapter_split"
    )?.message,
    "This may be a false split"
  );
});

test("import inspector exposes parser structure warning metadata", () => {
  const inspection = buildImportInspectorData({
    manuscript: {
      wordCount: 45,
      chunkCount: 3,
      metadata: {
        structureReview: {
          recommended: true,
          warnings: [
            {
              code: "chapter_word_count_under_80",
              message: "Detected chapter is under 80 words; review for a false split.",
              chapterOrder: 2
            },
            {
              code: "numeric_to_prose_fragment_headings",
              message:
                "Chapter headings jump from numeric labels to short prose fragments; review for accidental splits.",
              chapterOrder: 3
            }
          ]
        }
      }
    },
    sections: [
      {
        id: "c1",
        order: 1,
        title: "Kapitel 1",
        wordCount: 20,
        chunks: [{ id: "k1", chunkIndex: 1, wordCount: 20 }]
      },
      {
        id: "c2",
        order: 2,
        title: "Kapitel 2",
        wordCount: 15,
        chunks: [{ id: "k2", chunkIndex: 2, wordCount: 15 }]
      },
      {
        id: "c3",
        order: 3,
        title: "JAG VILL TRO",
        wordCount: 10,
        chunks: [{ id: "k3", chunkIndex: 3, wordCount: 10 }]
      }
    ]
  });

  assert.ok(
    inspection.warnings.some(
      (warning) =>
        warning.code === "chapter_word_count_under_80" &&
        warning.sectionId === "c2"
    )
  );
  assert.ok(
    inspection.warnings.some(
      (warning) =>
        warning.code === "numeric_to_prose_fragment_headings" &&
        warning.sectionId === "c3"
    )
  );
});

test("import inspector flags unusually broad imports", () => {
  const sections = Array.from({ length: 81 }, (_, index) => ({
    id: `c${index}`,
    order: index + 1,
    title: `Chapter ${index + 1}`,
    wordCount: 300,
    chunks: [{ id: `k${index}`, chunkIndex: index, wordCount: 300 }]
  }));

  const inspection = buildImportInspectorData({
    manuscript: {
      wordCount: 24_300,
      chunkCount: 301
    },
    sections
  });

  assert.equal(inspection.stats.detectedSections, 81);
  assert.equal(inspection.stats.averageWordsPerSection, 300);
  assert.deepEqual(
    inspection.warnings.map((warning) => warning.code),
    ["many_detected_sections", "large_chunk_count"]
  );
});

test("import inspector handles empty or missing data safely", () => {
  const inspection = buildImportInspectorData({
    manuscript: null,
    sections: null
  });

  assert.deepEqual(inspection.stats, {
    totalWords: 0,
    detectedSections: 0,
    chunkCount: 0,
    averageWordsPerSection: 0,
    averageChunksPerSection: 0,
    warningCount: 1
  });
  assert.deepEqual(inspection.sections, []);
  assert.deepEqual(
    inspection.warnings.map((warning) => warning.code),
    ["no_chunks"]
  );
});

test("text previews normalize whitespace and cap long text", () => {
  const preview = textPreview("One\n\n two   three four five", 15);

  assert.equal(preview, "One two thre...");
  assert.equal(textPreview("", 15), "");
});
