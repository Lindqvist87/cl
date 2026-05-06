import test from "node:test";
import assert from "node:assert/strict";
import { ManuscriptFormat } from "@prisma/client";
import {
  createUploadPostHandler,
  type UploadRouteDependencies
} from "../lib/server/uploadImport";
import {
  uploadFeedbackFromResponse,
  uploadRedirectHref
} from "../components/UploadForm";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("upload route returns validation phase when file is missing", async (t) => {
  t.mock.method(console, "error", () => undefined);

  const handler = createUploadPostHandler(baseDependencies());
  const response = await handler(
    new Request("http://localhost/api/upload", {
      method: "POST",
      body: new FormData()
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Missing manuscript file.",
    phase: "validation"
  });
});

test("upload route rejects non-docx files before extraction", async (t) => {
  t.mock.method(console, "error", () => undefined);

  let extracted = false;
  const handler = createUploadPostHandler({
    ...baseDependencies(),
    extractTextFromUpload: async () => {
      extracted = true;
      return {
        text: "Should not be extracted.",
        format: ManuscriptFormat.DOCX,
        mimeType: DOCX_MIME_TYPE
      };
    }
  });

  const response = await handler(uploadRequest("test.txt", "text/plain"));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.phase, "validation");
  assert.match(body.error, /Upload a \.docx manuscript/);
  assert.equal(extracted, false);
});

test("upload route rejects oversized multipart requests before extraction", async (t) => {
  t.mock.method(console, "error", () => undefined);

  let extracted = false;
  const handler = createUploadPostHandler({
    ...baseDependencies(),
    extractTextFromUpload: async () => {
      extracted = true;
      return {
        text: "Should not be extracted.",
        format: ManuscriptFormat.DOCX,
        mimeType: DOCX_MIME_TYPE
      };
    }
  });
  const response = await handler(
    new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { "content-length": String(27 * 1024 * 1024) },
      body: new FormData()
    })
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.phase, "validation");
  assert.match(body.error, /too large/);
  assert.equal(extracted, false);
});

test("upload route returns extraction phase on extraction failure", async (t) => {
  t.mock.method(console, "error", () => undefined);

  const handler = createUploadPostHandler({
    ...baseDependencies(),
    extractTextFromUpload: async () => {
      throw new Error("Unsupported test fixture.");
    }
  });

  const response = await handler(uploadRequest());

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Unsupported test fixture.",
    phase: "extraction"
  });
});

test("upload route rejects empty extracted manuscript text", async (t) => {
  t.mock.method(console, "error", () => undefined);

  const handler = createUploadPostHandler({
    ...baseDependencies(),
    extractTextFromUpload: async () => ({
      text: "",
      format: ManuscriptFormat.DOCX,
      mimeType: DOCX_MIME_TYPE
    })
  });

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.phase, "extraction");
  assert.match(body.error, /No readable manuscript text/);
});

test("upload route returns storage phase on shell creation failure", async (t) => {
  t.mock.method(console, "error", () => undefined);

  const handler = createUploadPostHandler({
    ...baseDependencies(),
    createUploadedManuscriptShell: async () => {
      throw new Error("Database write failed.");
    }
  });

  const response = await handler(uploadRequest());

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Database write failed.",
    phase: "storage"
  });
});

test("upload route stores doc-only shell without starting analysis", async () => {
  const handler = createUploadPostHandler(baseDependencies());

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    manuscriptId: "manuscript-1",
    title: "Test Manuscript",
    wordCount: 7,
    status: "UPLOADED",
    executionMode: "DOC_ONLY",
    pipelineStarted: false,
    pipelineQueued: false,
    message: "Dokumentet är uppladdat."
  });
});

test("frontend redirects successful doc-only uploads to the document page", () => {
  const feedback = uploadFeedbackFromResponse(true, {
    manuscriptId: "manuscript-1"
  });

  if (feedback.kind !== "redirect") {
    assert.fail(`Expected redirect feedback, received ${feedback.kind}`);
  }

  assert.equal(feedback.manuscriptId, "manuscript-1");
  assert.equal(uploadRedirectHref(feedback), "/manuscripts/manuscript-1");
});

test("frontend classifies upload failures as red errors", () => {
  const missingId = uploadFeedbackFromResponse(true, {
    message: "Upload response was incomplete."
  });
  const storageFailure = uploadFeedbackFromResponse(false, {
    error: "Unable to store uploaded manuscript.",
    phase: "storage"
  });

  if (missingId.kind !== "error") {
    assert.fail(`Expected error feedback, received ${missingId.kind}`);
  }

  if (storageFailure.kind !== "error") {
    assert.fail(`Expected error feedback, received ${storageFailure.kind}`);
  }

  assert.match(missingId.message, /Upload response was incomplete/);
  assert.match(storageFailure.message, /Unable to store uploaded manuscript/);
  assert.match(storageFailure.message, /phase=storage/);
});

function baseDependencies(): UploadRouteDependencies {
  return {
    extractTextFromUpload: async () => ({
      text: "Test Manuscript\n\nChapter One\n\nA small opening.",
      format: ManuscriptFormat.DOCX,
      mimeType: DOCX_MIME_TYPE
    }),
    createUploadedManuscriptShell: async () => ({
      id: "manuscript-1",
      title: "Test Manuscript",
      wordCount: 7,
      status: "UPLOADED"
    })
  };
}

function uploadRequest(fileName = "test.docx", mimeType = DOCX_MIME_TYPE) {
  const formData = new FormData();
  formData.set("file", new File(["Test Manuscript"], fileName, { type: mimeType }));

  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: formData
  });
}
