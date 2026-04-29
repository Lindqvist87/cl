import test from "node:test";
import assert from "node:assert/strict";
import { chunkParsedManuscript } from "../lib/parsing/chunker";
import type { ParsedManuscript } from "../lib/types";

test("chunkParsedManuscript chunks by paragraph boundaries", () => {
  const parsed: ParsedManuscript = {
    title: "Chunk Test",
    normalizedText: "",
    wordCount: 12,
    paragraphCount: 3,
    metadata: {},
    chapters: [
      {
        order: 1,
        title: "Chapter 1",
        wordCount: 12,
        scenes: [
          {
            order: 1,
            title: "Scene 1",
            wordCount: 12,
            paragraphs: [
              {
                text: "one two three four",
                wordCount: 4,
                globalOrder: 0,
                chapterOrder: 0,
                sceneOrder: 0
              },
              {
                text: "five six seven eight",
                wordCount: 4,
                globalOrder: 1,
                chapterOrder: 1,
                sceneOrder: 1
              },
              {
                text: "nine ten eleven twelve",
                wordCount: 4,
                globalOrder: 2,
                chapterOrder: 2,
                sceneOrder: 2
              }
            ]
          }
        ]
      }
    ]
  };

  const chunks = chunkParsedManuscript(parsed, 8);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].startParagraph, 0);
  assert.equal(chunks[0].endParagraph, 1);
  assert.equal(chunks[1].startParagraph, 2);
  assert.equal(chunks[1].endParagraph, 2);
  assert.equal(chunks[1].chapterOrder, 1);
});

test("chunkParsedManuscript splits a single oversized paragraph", () => {
  const longParagraph = Array.from({ length: 25 }, (_, index) => `word${index}`).join(" ");
  const parsed: ParsedManuscript = {
    title: "Long Paragraph",
    normalizedText: "",
    wordCount: 25,
    paragraphCount: 1,
    metadata: {},
    chapters: [
      {
        order: 1,
        title: "Chapter 1",
        wordCount: 25,
        scenes: [
          {
            order: 1,
            title: "Scene 1",
            wordCount: 25,
            paragraphs: [
              {
                text: longParagraph,
                wordCount: 25,
                globalOrder: 0,
                chapterOrder: 0,
                sceneOrder: 0
              }
            ]
          }
        ]
      }
    ]
  };

  const chunks = chunkParsedManuscript(parsed, 10);

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((chunk) => chunk.wordCount),
    [10, 10, 5]
  );
  assert.equal(chunks.every((chunk) => chunk.metadata.splitLongParagraph), true);
});
