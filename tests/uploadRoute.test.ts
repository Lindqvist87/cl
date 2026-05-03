import test from "node:test";
import assert from "node:assert/strict";
import { ManuscriptFormat } from "@prisma/client";
import {
  createUploadPostHandler,
  type UploadRouteDependencies
} from "../lib/server/uploadImport";

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

test("upload route succeeds when pipeline start throws", async (t) => {
  t.mock.method(console, "error", () => undefined);

  const handler = createUploadPostHandler({
    ...baseDependencies(),
    startManuscriptPipeline: async () => {
      throw new Error("Inngest event send failed.");
    }
  });

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.deepEqual(body, {
    manuscriptId: "manuscript-1",
    title: "Test Manuscript",
    status: "IMPORT_QUEUED",
    pipelineStarted: false,
    pipelineWarning: "Inngest event send failed.",
    message:
      "Manuscript uploaded, but background pipeline did not start automatically. Use admin retry/resume."
  });
});

test("upload route succeeds when pipeline start is not accepted", async (t) => {
  t.mock.method(console, "error", () => undefined);

  const handler = createUploadPostHandler({
    ...baseDependencies(),
    startManuscriptPipeline: async (input) => ({
      executionMode: "INNGEST",
      accepted: false,
      manuscriptId: input.manuscriptId,
      runId: "run-1",
      jobCount: 18,
      eventSent: false,
      eventError: "Inngest rejected the event.",
      warnings: ["Event key is missing."]
    })
  });

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.manuscriptId, "manuscript-1");
  assert.equal(body.status, "IMPORT_QUEUED");
  assert.equal(body.pipelineStarted, false);
  assert.equal(
    body.pipelineWarning,
    "Inngest rejected the event. Event key is missing."
  );
});

test("upload route succeeds when pipeline start is accepted", async () => {
  const handler = createUploadPostHandler(baseDependencies());

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.manuscriptId, "manuscript-1");
  assert.equal(body.title, "Test Manuscript");
  assert.equal(body.status, "IMPORT_QUEUED");
  assert.equal(body.executionMode, "INNGEST");
  assert.equal(body.pipelineStarted, true);
  assert.equal(body.message, "Import started");
});

function baseDependencies(): UploadRouteDependencies {
  return {
    extractTextFromUpload: async () => ({
      text: "Test Manuscript\n\nChapter One\n\nA small opening.",
      format: ManuscriptFormat.TXT,
      mimeType: "text/plain"
    }),
    createUploadedManuscriptShell: async () => ({
      id: "manuscript-1",
      title: "Test Manuscript",
      wordCount: 7,
      status: "IMPORT_QUEUED"
    }),
    startManuscriptPipeline: async (input) => ({
      executionMode: "INNGEST",
      accepted: true,
      manuscriptId: input.manuscriptId,
      runId: "run-1",
      jobCount: 18,
      eventSent: true,
      eventIds: ["event-1"],
      warnings: []
    })
  };
}

function uploadRequest() {
  const formData = new FormData();
  formData.set(
    "file",
    new File(["Test Manuscript"], "test.txt", { type: "text/plain" })
  );

  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: formData
  });
}
