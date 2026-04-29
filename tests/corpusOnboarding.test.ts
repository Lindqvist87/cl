import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { RightsStatus } from "@prisma/client";
import { calculateProfileMetrics } from "../lib/analysis/textMetrics";
import { corpusBenchmarkReady, profileDataFromMetrics } from "../lib/corpus/bookDna";
import { extractTextFromEpub } from "../lib/corpus/epub";
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
  const epubFile = await tinyEpubFixture();
  const epub = await extractTextFromCorpusUpload(
    epubFile
  );

  assert.match(txt.text, /Plain text/);
  assert.match(md.text, /Bold text/);
  assert.match(xml.text, /XML text/);
  assert.equal(epub.format, "EPUB");
  assert.equal(epub.extractionReport?.rootfilePath, "OPS/package.opf");
  assert.match(epub.text, /First paragraph/);
});

test("epub extraction follows container, opf manifest, and spine order", async () => {
  const epub = await extractTextFromEpub(await tinyEpubFixture());

  assert.equal(epub.sourceFormat, "EPUB");
  assert.equal(epub.extractionReport.rootfilePath, "OPS/package.opf");
  assert.equal(epub.extractionReport.spineItemCount, 3);
  assert.equal(epub.extractionReport.extractedDocumentCount, 3);
  assert.equal(epub.chapters[0].title, "Spine First");
  assert.equal(epub.chapters[1].title, "Spine Second");
  assert.ok(epub.cleanedText.indexOf("Spine First") < epub.cleanedText.indexOf("Spine Second"));
  assert.match(epub.cleanedText, /^# Spine First/m);
  assert.match(epub.cleanedText, /A smaller heading/);
  assert.match(epub.cleanedText, /First paragraph\.\n\nA smaller heading\n\nSecond paragraph\./);
});

test("epub extraction removes boilerplate and preserves verse line breaks", async () => {
  const epub = await extractTextFromEpub(await tinyEpubFixture());

  assert.doesNotMatch(epub.cleanedText, /console\.log/);
  assert.doesNotMatch(epub.cleanedText, /Hidden navigation boilerplate/);
  assert.doesNotMatch(epub.cleanedText, /Landmark entry/);
  assert.doesNotMatch(epub.cleanedText, /Page 1/);
  assert.match(epub.cleanedText, /I sing\na short line\nand another/);
  assert.match(epub.cleanedText, /Grass whispers\nUnder rain/);
  assert.equal(epub.extractionReport.navRemoved, true);
  assert.equal(epub.extractionReport.poetryFormattingPreserved, true);
});

test("epub extraction returns detected metadata and can feed corpus chapters and chunks", async () => {
  const epub = await extractTextFromEpub(await tinyEpubFixture());
  const parsed = parseManuscriptText(epub.cleanedText, "tiny.epub");
  const chunks = chunkParsedManuscript(parsed, 12);
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

  assert.equal(epub.detectedTitle, "Tiny EPUB Fixture");
  assert.equal(epub.detectedAuthor, "Fixture Author");
  assert.equal(epub.detectedLanguage, "en");
  assert.equal(epub.extractionReport.detectedPublisher, "Fixture Press");
  assert.equal(parsed.chapters.length, 3);
  assert.equal(profileData.chapterCount, 3);
  assert.equal(chunks.length > 1, true);
  assert.equal(
    chunks.every((chunk) => chunk.text.length < epub.cleanedText.length),
    true
  );
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

test("epub extraction merges duplicated title-card spine sections", async () => {
  const epub = await extractTextFromEpub(await titleCardEpubFixture());

  assert.equal(epub.extractionReport.extractedDocumentCount, 2);
  assert.equal(epub.extractionReport.titleCardMergedCount, 1);
  assert.equal(epub.chapters.length, 1);
  assert.equal(epub.chapters[0].title, "DET KLAPPANDE HJÄRTAT.");
  assert.doesNotMatch(epub.cleanedText, /^# Section/m);
  assert.match(epub.cleanedText, /Själva kapitlets första stycke/);
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

async function tinyEpubFixture() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    "OPS/package.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Tiny EPUB Fixture</dc:title>
    <dc:creator>Fixture Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Fixture Press</dc:publisher>
    <dc:date>2026-01-01</dc:date>
    <dc:identifier id="book-id">fixture-id</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="second" href="chapter-second.xhtml" media-type="application/xhtml+xml"/>
    <item id="first" href="chapters/chapter-first.xhtml" media-type="application/xhtml+xml"/>
    <item id="poem" href="poem.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="first"/>
    <itemref idref="second"/>
    <itemref idref="poem"/>
  </spine>
</package>`
  );
  zip.file(
    "OPS/nav.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapters/chapter-first.xhtml">First</a></li></ol></nav></body></html>`
  );
  zip.file(
    "OPS/chapters/chapter-first.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>.x{display:none}</style><script>console.log("remove");</script></head><body>
      <h1>Spine First</h1>
      <nav>Hidden navigation boilerplate</nav>
      <section epub:type="page-list"><p>Page 1</p></section>
      <section epub:type="landmarks"><p>Landmark entry</p></section>
      <p>First paragraph.</p>
      <h2>A smaller heading</h2>
      <p>Second paragraph.</p>
    </body></html>`
  );
  zip.file(
    "OPS/chapter-second.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>Spine Second</h1>
      <p>Second spine document text.</p>
    </body></html>`
  );
  zip.file(
    "OPS/poem.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>Poem Section</h1>
      <p class="verse">I sing<br/>a short line<br/>and another</p>
      <div class="stanza"><div>Grass whispers</div><div>Under rain</div></div>
    </body></html>`
  );

  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    mimeType: "application/epub+zip"
  });
  return new File([bytes], "tiny-fixture.epub", {
    type: "application/epub+zip"
  });
}

async function titleCardEpubFixture() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Title Card Fixture</dc:title>
    <dc:creator>Fixture Author</dc:creator>
    <dc:language>sv</dc:language>
  </metadata>
  <manifest>
    <item id="title-card" href="title-card.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="title-card"/>
    <itemref idref="chapter"/>
  </spine>
</package>`
  );
  zip.file(
    "title-card.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>I.</p><p>Det klappande hjärtat.</p></body></html>`
  );
  zip.file(
    "chapter.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>DET KLAPPANDE HJÄRTAT.</p><p>Själva kapitlets första stycke.</p></body></html>`
  );

  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    mimeType: "application/epub+zip"
  });
  return new File([bytes], "title-card-fixture.epub", {
    type: "application/epub+zip"
  });
}
