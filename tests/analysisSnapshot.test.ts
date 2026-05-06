import test from "node:test";
import assert from "node:assert/strict";
import { ManuscriptFormat } from "@prisma/client";
import { hashText } from "../lib/compiler/hash";
import { createLockedAnalysisSnapshot } from "../lib/pipeline/analysisSnapshot";

test("createLockedAnalysisSnapshot locks saved document text and editor revision", async () => {
  const upserts: Array<Record<string, any>> = [];
  const db = {
    manuscript: {
      findUnique: async () => ({
        id: "manuscript-1",
        originalText: "[[Sida 1]]\n\nFirst page.\n\n[[Sida 2]]\n\nSecond page.",
        sourceFileName: "book.docx",
        sourceMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sourceFormat: ManuscriptFormat.DOCX,
        wordCount: 4,
        metadata: { documentEditor: { revision: 7 } }
      })
    },
    analysisSnapshot: {
      upsert: async (value: unknown) => {
        const args = value as Record<string, any>;
        upserts.push(args);
        return { id: "snapshot-1", ...args.create };
      }
    }
  };

  const snapshot = await createLockedAnalysisSnapshot("manuscript-1", db);

  assert.equal(snapshot.id, "snapshot-1");
  assert.equal(snapshot.documentRevision, 7);
  assert.equal(snapshot.textHash, hashText("First page.\n\nSecond page."));
  assert.equal(snapshot.wordCount, 4);
  assert.equal(upserts[0].where.manuscriptId_textHash_documentRevision.documentRevision, 7);
  assert.equal(upserts[0].create.sourceText.includes("[[Sida 1]]"), true);
});
