import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { RightsStatus } from "@prisma/client";
import { calculateProfileMetrics } from "../lib/analysis/textMetrics";
import { corpusBenchmarkReady, profileDataFromMetrics } from "../lib/corpus/bookDna";
import { extractTextFromCorpusUpload } from "../lib/corpus/extractText";
import {
  parseCorpusOnboardingFormData,
  validateBenchmarkRights
} from "../lib/corpus/onboarding";
import { parseManuscriptText } from "../lib/parsing/chapterDetector";
import { chunkParsedManuscript } from "../lib/parsing/chunker";

test("multi-file corpus onboarding parses metadata rows", () => {
  const formData = new FormData();
  formData.append("files", new File(["Chapter 1\n\nOne."], "one.txt", { type: "text/plain" }));
  formData.append("files", new File(["# Two\n\nText."], "two.md", { type: "text/markdown" }));
  formData.set(
    "books",
    JSON.stringify([
      {
        title: "One",
        author: "Author A",
        language: "en",
        genre: "novel",
        source: "Project Gutenberg",
        rightsStatus: "PUBLIC_DOMAIN",
        benchmarkAllowed: true
      },
      {
        title: "Two",
        author: "Author B",
        language: "sv",
        genre: "literary",
        source: "Litteraturbanken",
        rightsStatus: "OPEN_LICENSE",
        benchmarkAllowed: true
      }
    ])
  );

  const parsed = parseCorpusOnboardingFormData(formData);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, "One");
  assert.equal(parsed[1].file?.name, "two.md");
});

test("rights validation blocks benchmark use for unknown or metadata-only books", () => {
  assert.throws(
    () =>
      validateBenchmarkRights({
        rightsStatus: RightsStatus.UNKNOWN,
        benchmarkAllowed: true
      }),
    /Benchmarking cannot be allowed/
  );
  assert.throws(
    () =>
      validateBenchmarkRights({
        rightsStatus: RightsStatus.METADATA_ONLY,
        benchmarkAllowed: true
      }),
    /Benchmarking cannot be allowed/
  );
});

test("corpus text extraction supports txt, markdown, xml, and epub", async () => {
  const txt = await extractTextFromCorpusUpload(
    new File(["Chapter 1\n\nPlain text."], "plain.txt", { type: "text/plain" })
  );
  const md = await extractTextFromCorpusUpload(
    new File(["# Chapter 1\n\n**Bold** text."], "book.md", { type: "text/markdown" })
  );
  const xml = await extractTextFromCorpusUpload(
    new File(["<TEI><text><p>XML text.</p></text></TEI>"], "book.xml", {
      type: "application/xml"
    })
  );
  const zip = new AdmZip();
  zip.addFile(
    "OEBPS/chapter1.xhtml",
    Buffer.from("<html><body><h1>Chapter 1</h1><p>EPUB text.</p></body></html>")
  );
  const epubBuffer = zip.toBuffer();
  const epubBytes = epubBuffer.buffer.slice(
    epubBuffer.byteOffset,
    epubBuffer.byteOffset + epubBuffer.byteLength
  ) as ArrayBuffer;
  const epub = await extractTextFromCorpusUpload(
    new File([epubBytes], "book.epub", { type: "application/epub+zip" })
  );

  assert.match(txt.text, /Plain text/);
  assert.match(md.text, /Bold text/);
  assert.match(xml.text, /XML text/);
  assert.match(epub.text, /EPUB text/);
});

test("chapter detection, chunk creation, Book DNA, and readiness work together", () => {
  const text = [
    "Chapter 1",
    "",
    "She wondered whether the door would open. It opened!",
    "",
    "Chapter 2",
    "",
    "\"What now?\" he asked. They ran into the street."
  ].join("\n");
  const parsed = parseManuscriptText(text, "starter.txt");
  const chunks = chunkParsedManuscript(parsed, 20);
  const profile = calculateProfileMetrics(
    parsed.chapters.map((chapter) => ({
      title: chapter.title,
      text: chapter.scenes
        .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
        .join("\n\n"),
      wordCount: chapter.wordCount
    }))
  );
  const profileData = profileDataFromMetrics(profile);

  assert.equal(parsed.chapters.length, 2);
  assert.equal(chunks.length > 0, true);
  assert.equal(profileData.chapterCount, 2);
  assert.equal(profileData.questionRatio > 0, true);
  assert.equal(Array.isArray(profileData.repeatedTerms), true);
  assert.equal(
    corpusBenchmarkReady({
      rightsStatus: RightsStatus.PUBLIC_DOMAIN,
      allowedUses: { corpusBenchmarking: true },
      benchmarkAllowed: true,
      profileExists: true,
      chunkCount: chunks.length
    }),
    true
  );
});
