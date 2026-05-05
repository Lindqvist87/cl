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

test("upload route rejects oversized multipart requests before extraction", async (t) => {
  t.mock.method(console, "error", () => undefined);

  let extracted = false;
  const handler = createUploadPostHandler({
    ...baseDependencies(),
    extractTextFromUpload: async () => {
      extracted = true;
      return {
        text: "Should not be extracted.",
        format: ManuscriptFormat.TXT,
        mimeType: "text/plain"
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
      format: ManuscriptFormat.TXT,
      mimeType: "text/plain"
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
    pipelineQueued: false,
    pipelineWarning: "Inngest event send failed.",
    message:
      "Manuset är uppladdat, men analysen startade inte automatiskt. Starta eller återuppta analysen via admin."
  });
});

test("upload route reports queued mode without claiming the pipeline started", async () => {
  let runInlineWhenInngestDisabled: boolean | undefined;
  const handler = createUploadPostHandler({
    ...baseDependencies(),
    startManuscriptPipeline: async (input) => {
      runInlineWhenInngestDisabled = input.runInlineWhenInngestDisabled;
      return {
        executionMode: "QUEUED",
        accepted: true,
        manuscriptId: input.manuscriptId,
        runId: "run-1",
        jobCount: 18,
        warnings: [
          "Inngest is not configured; jobs were queued but not run in the upload request."
        ]
      };
    }
  });

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(runInlineWhenInngestDisabled, false);
  assert.equal(body.manuscriptId, "manuscript-1");
  assert.equal(body.executionMode, "QUEUED");
  assert.equal(body.pipelineStarted, false);
  assert.equal(body.pipelineQueued, true);
  assert.equal(
    body.message,
    "Manuset är uppladdat och analysjobben är köade. Starta eller återuppta analysen via admin."
  );
  assert.equal(body.pipeline.accepted, true);
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
  assert.equal(body.executionMode, "INNGEST");
  assert.equal(body.pipelineStarted, false);
  assert.equal(body.pipelineQueued, true);
  assert.equal(
    body.pipelineWarning,
    "Inngest rejected the event. Event key is missing."
  );
});

test("upload route keeps shell success when Inngest branch environment is missing", async (t) => {
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
      eventError: "Inngest branch environment returned 404.",
      warnings: ["Preview branch environment was not created."]
    })
  });

  const response = await handler(uploadRequest());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.manuscriptId, "manuscript-1");
  assert.equal(body.pipelineStarted, false);
  assert.equal(body.pipelineQueued, true);
  assert.match(body.pipelineWarning, /404/);
  assert.match(body.pipelineWarning, /Preview branch environment/);
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
  assert.equal(body.pipelineQueued, false);
  assert.equal(body.message, "Import started");
});

test("frontend redirects queued uploads into automatic analysis run", () => {
  const feedback = uploadFeedbackFromResponse(true, {
    manuscriptId: "manuscript-1",
    pipelineStarted: false,
    pipelineQueued: true,
    message:
      "Manuset är uppladdat och analysjobben är köade. Starta eller återuppta analysen via admin."
  });

  if (feedback.kind !== "redirect") {
    assert.fail(`Expected redirect feedback, received ${feedback.kind}`);
  }

  assert.equal(feedback.manuscriptId, "manuscript-1");
  assert.equal(feedback.autoRunAnalysis, true);
  assert.equal(
    uploadRedirectHref(feedback),
    "/manuscripts/manuscript-1?autorun=1"
  );
});

test("frontend redirects queued pipeline warning uploads into automatic analysis run", () => {
  const feedback = uploadFeedbackFromResponse(true, {
    manuscriptId: "manuscript-1",
    pipelineStarted: false,
    pipelineQueued: true,
    pipelineWarning: "Inngest branch environment returned 404."
  });

  if (feedback.kind !== "redirect") {
    assert.fail(`Expected redirect feedback, received ${feedback.kind}`);
  }

  assert.equal(feedback.manuscriptId, "manuscript-1");
  assert.equal(feedback.autoRunAnalysis, true);
  assert.equal(
    uploadRedirectHref(feedback),
    "/manuscripts/manuscript-1?autorun=1"
  );
});

test("frontend only classifies actual upload failures as red errors", () => {
  const queued = uploadFeedbackFromResponse(true, {
    manuscriptId: "manuscript-1",
    pipelineQueued: true,
    pipelineStarted: false
  });
  const warning = uploadFeedbackFromResponse(true, {
    manuscriptId: "manuscript-1",
    pipelineStarted: false,
    pipelineWarning: "Inngest branch environment returned 404."
  });
  const storageFailure = uploadFeedbackFromResponse(false, {
    error: "Unable to store uploaded manuscript.",
    phase: "storage"
  });

  assert.notEqual(queued.kind, "error");
  assert.notEqual(warning.kind, "error");
  if (storageFailure.kind !== "error") {
    assert.fail(`Expected error feedback, received ${storageFailure.kind}`);
  }

  assert.match(storageFailure.message, /Unable to store uploaded manuscript/);
  assert.match(storageFailure.message, /phase=storage/);
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
