import test from "node:test";
import assert from "node:assert/strict";
import { buildBoundedChapterContext } from "../lib/analysis/chapterContext";

test("buildBoundedChapterContext keeps chapter audit prompts bounded", () => {
  const text = Array.from({ length: 100 }, (_, index) => `word${index}`).join(" ");
  const context = buildBoundedChapterContext(text, 20);

  assert.equal(context.strategy, "opening-ending-excerpt");
  assert.equal(context.sourceWordCount, 100);
  assert.equal(context.omittedWordCount, 80);
  assert.equal(context.contextWordCount <= 32, true);
  assert.match(context.text, /words omitted/);
});

test("buildBoundedChapterContext leaves short chapters intact", () => {
  const context = buildBoundedChapterContext("short chapter text", 20);

  assert.equal(context.strategy, "full");
  assert.equal(context.text, "short chapter text");
  assert.equal(context.omittedWordCount, 0);
});
