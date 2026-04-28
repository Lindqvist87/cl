import test from "node:test";
import assert from "node:assert/strict";
import { parseManuscriptText } from "../lib/parsing/chapterDetector";

test("parseManuscriptText detects chapters and preserves paragraph order", () => {
  const parsed = parseManuscriptText(
    [
      "Chapter 1",
      "",
      "The first paragraph opens the story.",
      "",
      "The second paragraph adds pressure.",
      "",
      "Chapter 2",
      "",
      "The next chapter changes the situation."
    ].join("\n"),
    "test-book.txt"
  );

  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.chapters[0].title, "Chapter 1");
  assert.equal(parsed.chapters[1].title, "Chapter 2");
  assert.equal(parsed.paragraphCount, 3);
  assert.equal(parsed.chapters[0].scenes[0].paragraphs[0].globalOrder, 0);
  assert.equal(parsed.chapters[1].scenes[0].paragraphs[0].globalOrder, 2);
});
