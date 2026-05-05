import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildImportInspectorData } from "../lib/editorial/importInspector";
import {
  importManifestToParsedManuscript
} from "../lib/import/v2/adapter";
import {
  buildImportInvalidationPlan
} from "../lib/import/v2/invalidation";
import {
  importManifestToNormalizedText
} from "../lib/import/v2/manifest";
import {
  parseDocxToImportManifest
} from "../lib/import/v2/docx";
import { buildTextImportManifest } from "../lib/import/v2/text";
import { MANUSCRIPT_IR_VERSION } from "../lib/import/v2/types";
import { chunkParsedManuscript } from "../lib/parsing/chunker";
import { extractTextFromUpload } from "../lib/parsing/extractText";
import { runPipelineStep } from "../lib/pipeline/manuscriptPipeline";
import { prisma } from "../lib/prisma";

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "import-v2");

test("text import v2 creates a versioned manifest and adapts to ParsedManuscript", () => {
  const manifest = buildTextImportManifest({
    rawText: fixture("swedish-manuscript.txt"),
    sourceFileName: "swedish-manuscript.txt"
  });
  const parsed = importManifestToParsedManuscript(manifest);

  assert.equal(manifest.version, MANUSCRIPT_IR_VERSION);
  assert.equal(typeof manifest.fileHash, "string");
  assert.equal(typeof manifest.structureHash, "string");
  assert.equal(manifest.blocks.some((block) => block.sourceAnchor.path), true);
  assert.equal(parsed.title, "Skuggor vid kajen");
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["Kapitel ett", "Kapitel tva"]
  );
  assert.equal(parsed.metadata.importV2 && typeof parsed.metadata.importV2, "object");
});

test("text import v2 supports lowercase roman headings and prolog/epilog", () => {
  const roman = importManifestToParsedManuscript(
    buildTextImportManifest({
      rawText: fixture("roman-lowercase-headings.txt"),
      sourceFileName: "roman.txt"
    })
  );
  const frontBack = importManifestToParsedManuscript(
    buildTextImportManifest({
      rawText: fixture("prolog-epilog.txt"),
      sourceFileName: "front-back.txt"
    })
  );

  assert.deepEqual(
    roman.chapters.map((chapter) => chapter.heading),
    ["i", "ii", "iii"]
  );
  assert.deepEqual(
    frontBack.chapters.map((chapter) => chapter.title),
    ["Prolog", "Kapitel 1", "Epilog"]
  );
});

test("all-caps prose is not split without nearby chapter evidence", () => {
  const parsed = importManifestToParsedManuscript(
    buildTextImportManifest({
      rawText: fixture("all-caps-negative.txt"),
      sourceFileName: "all-caps-negative.txt"
    })
  );

  assert.equal(parsed.title, "Kortprosa");
  assert.equal(parsed.chapters.length, 1);
  assert.deepEqual(
    parsed.chapters[0].scenes[0].paragraphs.map((paragraph) => paragraph.text),
    [
      "DETTA AR INTE EN RUBRIK",
      "Texten fortsatter direkt och raden ovan ar en del av uttrycket.",
      "OCH INTE DEN HAR HELLER",
      "Sista stycket haller ihop texten."
    ]
  );
});

test("shell flow projects parse to chunks and import inspector", () => {
  const parsed = importManifestToParsedManuscript(
    buildTextImportManifest({
      rawText: fixture("shell-flow.txt"),
      sourceFileName: "shell-flow.txt"
    })
  );
  const chunks = chunkParsedManuscript(parsed, 4);
  const inspection = buildImportInspectorData({
    manuscript: {
      wordCount: parsed.wordCount,
      chapterCount: parsed.chapters.length,
      chunkCount: chunks.length,
      metadata: parsed.metadata
    },
    sections: parsed.chapters.map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      order: chapter.order,
      title: chapter.title,
      heading: chapter.heading,
      text: chapter.scenes
        .flatMap((scene) => scene.paragraphs.map((paragraph) => paragraph.text))
        .join("\n\n"),
      wordCount: chapter.wordCount,
      chunks: chunks
        .filter((chunk) => chunk.chapterOrder === chapter.order)
        .map((chunk) => ({
          id: `chunk-${chunk.chunkIndex}`,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          wordCount: chunk.wordCount,
          tokenEstimate: chunk.tokenEstimate
        }))
    }))
  });

  assert.equal(parsed.chapters.length, 2);
  assert.equal(chunks.length, 3);
  assert.equal(inspection.stats.detectedSections, 2);
  assert.equal(
    chunks.every((chunk) => Array.isArray(chunk.metadata.importBlockIds)),
    true
  );
});

test("structured docx import reads styles, lists, page breaks, comments and tracked changes", async () => {
  const manifest = await parseDocxToImportManifest({
    buffer: await docxFixtureBuffer(),
    sourceFileName: "structured.docx"
  });
  const parsed = importManifestToParsedManuscript(manifest);
  const codes = manifest.blocks.flatMap((block) =>
    block.warnings.map((item) => item.code)
  );

  assert.equal(manifest.metadata?.structuredDocx, true);
  assert.equal(manifest.blocks.some((block) => block.type === "title"), true);
  assert.equal(manifest.blocks.some((block) => block.type === "list_item"), true);
  assert.equal(manifest.blocks.some((block) => block.type === "page_break"), true);
  assert.equal(codes.includes("docx_comment"), true);
  assert.equal(codes.includes("docx_track_changes"), true);
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["Kapitel 1"]
  );
});

test("broken docx fixture fails structured parsing and surfaces extraction phase", async () => {
  const broken = readFileSync(path.join(fixtureRoot, "broken.docx"));

  await assert.rejects(
    () =>
      parseDocxToImportManifest({
        buffer: broken,
        sourceFileName: "broken.docx"
      }),
    /ADM-ZIP|Invalid|missing|END header/i
  );

  await assert.rejects(
    () =>
      extractTextFromUpload(
        new File([broken], "broken.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        })
      ),
    /Could not find|Can't find end of central directory|END header|not a zip/i
  );
});

test("import invalidation detects parser/source/structure changes", () => {
  const manifest = buildTextImportManifest({
    rawText: fixture("swedish-manuscript.txt"),
    sourceFileName: "swedish-manuscript.txt"
  });
  const first = buildImportInvalidationPlan({ manifest });
  const second = buildImportInvalidationPlan({
    manifest,
    previousSignature: first.nextSignature
  });
  const changed = buildImportInvalidationPlan({
    manifest: {
      ...manifest,
      parserVersion: `${manifest.parserVersion}-changed`
    },
    previousSignature: first.nextSignature
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(changed.changed, true);
});

test("deep analysis pauses until import structure is verified enough", async () => {
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const manifest = buildTextImportManifest({
    rawText: "Rad utan rubrik och med fallback.",
    sourceFileName: "fallback.txt"
  });
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

  try {
    await withPatchedPrisma(
      [
        [
          prisma.manuscript,
          {
            findUnique: async () => ({
              metadata: {
                importManifestV2: manifest,
                structureReview: { recommended: true, warningCount: 1 }
              }
            })
          }
        ]
      ],
      async () => {
        const result = (await runPipelineStep(
          "summarizeChunks",
          "manuscript-import-review",
          "run-1"
        )) as Record<string, unknown>;

        assert.equal(result.complete, false);
        assert.equal(result.blockedReason, "import_structure_review_required");
      }
    );
  } finally {
    restoreEnv("DATABASE_URL", oldDatabaseUrl);
  }
});

function fixture(name: string) {
  return readFileSync(path.join(fixtureRoot, name), "utf8");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function docxFixtureBuffer() {
  const zip = new JSZip();

  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
</w:styles>`
  );
  zip.file(
    "word/comments.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0"><w:p><w:r><w:t>Review this line.</w:t></w:r></w:p></w:comment>
</w:comments>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Docx Titel</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Kapitel 1</w:t></w:r></w:p>
    <w:p><w:r><w:t>Forsta stycket.</w:t><w:commentReference w:id="0"/></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Listpunkt ett.</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:ins w:id="1"><w:r><w:t>Infogat stycke.</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>Borttaget.</w:delText></w:r></w:del></w:p>
  </w:body>
</w:document>`
  );

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function withPatchedPrisma<T>(
  patches: Array<[object, Record<string, unknown>]>,
  callback: () => Promise<T>
) {
  const originals: Array<{
    target: object;
    key: string;
    descriptor: PropertyDescriptor | undefined;
  }> = [];

  for (const [target, patch] of patches) {
    for (const [key, value] of Object.entries(patch)) {
      originals.push({
        target,
        key,
        descriptor: Object.getOwnPropertyDescriptor(target, key)
      });
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value
      });
    }
  }

  try {
    return await callback();
  } finally {
    for (const original of originals.reverse()) {
      if (original.descriptor) {
        Object.defineProperty(original.target, original.key, original.descriptor);
      } else {
        delete (original.target as Record<string, unknown>)[original.key];
      }
    }
  }
}
