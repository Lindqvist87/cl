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

test("parseManuscriptText detects sequential numeric chapter headings", () => {
  const parsed = parseManuscriptText(
    [
      "1",
      "",
      "Första kapitlet öppnar i ett stilla rum.",
      "",
      "2",
      "",
      "Andra kapitlet flyttar trycket framåt.",
      "",
      "3",
      "",
      "Tredje kapitlet håller kvar frågan."
    ].join("\n"),
    "numeric-book.txt"
  );

  assert.equal(parsed.chapters.length, 3);
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.heading),
    ["1", "2", "3"]
  );
});

test("parseManuscriptText detects real Swedish chapter headings", () => {
  const parsed = parseManuscriptText(
    [
      "Kapitel ett",
      "",
      "Berättelsen börjar med ett tydligt avstamp.",
      "",
      "Kapitel två",
      "",
      "Nästa kapitel skärper valet.",
      "",
      "Tredje kapitlet",
      "",
      "Det tredje kapitlet vänder situationen."
    ].join("\n"),
    "svensk-bok.txt"
  );

  assert.equal(parsed.chapters.length, 3);
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["Kapitel ett", "Kapitel två", "Tredje kapitlet"]
  );
});

test("parseManuscriptText keeps short Swedish prose lines inside the chapter", () => {
  const parsed = parseManuscriptText(
    [
      "Kapitel 1",
      "",
      "Jag tror på kärleken",
      "",
      "Borde inte",
      "",
      "Jag vill tro",
      "",
      "Något i mig släpper inte taget",
      "",
      "Liv",
      "",
      "Vi"
    ].join("\n"),
    "kort-prosa.txt"
  );

  assert.equal(parsed.chapters.length, 1);
  assert.deepEqual(
    parsed.chapters[0].scenes[0].paragraphs.map((paragraph) => paragraph.text),
    [
      "Jag tror på kärleken",
      "Borde inte",
      "Jag vill tro",
      "Något i mig släpper inte taget",
      "Liv",
      "Vi"
    ]
  );
});

test("parseManuscriptText accepts explicitly marked short prose headings", () => {
  const parsed = parseManuscriptText(
    [
      "# Jag tror på kärleken",
      "",
      "En kort öppning.",
      "",
      "# Borde inte",
      "",
      "En kort fortsättning."
    ].join("\n"),
    "markerad-prosa.txt"
  );

  assert.equal(parsed.chapters.length, 2);
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["Jag tror på kärleken", "Borde inte"]
  );
});

test("parseManuscriptText emits suspicious structure metadata", () => {
  const parsed = parseManuscriptText(
    [
      "Kapitel 1",
      "",
      "Kort text.",
      "",
      "Kapitel 2",
      "",
      "Kort text.",
      "",
      "JAG VILL TRO",
      "",
      "Kort text."
    ].join("\n"),
    "misstankt-struktur.txt"
  );
  const warnings = parsed.metadata.structureWarnings as Array<{
    code: string;
    chapterOrder?: number;
  }>;
  const review = parsed.metadata.structureReview as {
    recommended: boolean;
    warningCount: number;
  };

  assert.equal(review.recommended, true);
  assert.equal(review.warningCount, warnings.length);
  assert.ok(
    warnings.some(
      (warning) =>
        warning.code === "chapter_word_count_under_80" &&
        warning.chapterOrder === 1
    )
  );
  assert.ok(
    warnings.some((warning) => warning.code === "many_chapters_under_150")
  );
  assert.ok(
    warnings.some(
      (warning) =>
        warning.code === "numeric_to_prose_fragment_headings" &&
        warning.chapterOrder === 3
    )
  );
});
