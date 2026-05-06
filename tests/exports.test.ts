import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRewrittenJson,
  buildRewrittenMarkdown
} from "../lib/export/rewriteExports";
import AdmZip from "adm-zip";
import { manuscriptDocumentToDocxBuffer } from "../lib/export/manuscriptDocumentDocx";

const manuscript = {
  id: "m1",
  title: "Export Book",
  chapters: [
    { id: "c1", order: 1, title: "Chapter 1", text: "original one" },
    { id: "c2", order: 2, title: "Chapter 2", text: "original two" }
  ],
  rewrites: [
    {
      id: "draft-newer",
      chapterId: "c1",
      status: "DRAFT",
      version: 3,
      rewrittenText: "draft text",
      content: "",
      createdAt: new Date("2026-01-03T00:00:00Z")
    },
    {
      id: "accepted",
      chapterId: "c1",
      status: "ACCEPTED",
      version: 2,
      rewrittenText: "accepted text",
      content: "",
      changeLog: [{ change: "tightened" }],
      continuityNotes: { fact: "canon" },
      createdAt: new Date("2026-01-02T00:00:00Z")
    },
    {
      id: "rejected",
      chapterId: "c2",
      status: "REJECTED",
      version: 1,
      rewrittenText: "rejected text",
      content: "",
      createdAt: new Date("2026-01-01T00:00:00Z")
    }
  ]
};

test("buildRewrittenMarkdown exports accepted canon and skips rejected drafts", () => {
  const markdown = buildRewrittenMarkdown(manuscript);

  assert.match(markdown, /accepted text/);
  assert.match(markdown, /original two/);
  assert.doesNotMatch(markdown, /draft text/);
  assert.doesNotMatch(markdown, /rejected text/);
});

test("buildRewrittenJson preserves structured rewrite metadata", () => {
  const exported = buildRewrittenJson(manuscript);
  const firstChapter = exported.chapters[0];

  assert.equal(firstChapter.status, "ACCEPTED");
  assert.equal(firstChapter.text, "accepted text");
  assert.deepEqual(firstChapter.changeLog, [{ change: "tightened" }]);
  assert.deepEqual(firstChapter.continuityNotes, { fact: "canon" });
});

test("manuscriptDocumentToDocxBuffer exports the edited document text", async () => {
  const buffer = await manuscriptDocumentToDocxBuffer({
    title: "Edited Book",
    text: "[[Sida 1]]\n\nFirst paragraph.\nLine two.\n\n[[Sida 2]]\n\nSecond paragraph."
  });
  const archive = new AdmZip(buffer);
  const documentXml = archive.readAsText("word/document.xml");

  assert.match(documentXml, /Edited Book/);
  assert.match(documentXml, /First paragraph/);
  assert.match(documentXml, /Line two/);
  assert.match(documentXml, /Second paragraph/);
  assert.match(documentXml, /w:type="page"/);
  assert.doesNotMatch(documentXml, /\[\[Sida/);
});
