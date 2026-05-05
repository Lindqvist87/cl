import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LivePipelineProgress } from "../components/LivePipelineProgress";
import type { PipelineStatusDisplay } from "../lib/pipeline/display";
import { PIPELINE_JOB_STATUS } from "../lib/pipeline/jobRules";
import {
  MANUAL_QUEUED_ANALYSIS_COPY,
  analysisStatusLabel,
  isManualQueuedAnalysisMode,
  manuscriptManualRunEndpoint,
  operatorToolsVisibilityFromEnv,
  shouldAutoRunQueuedAnalysisAfterUpload
} from "../lib/pipeline/operatorMode";

test("preview production environment shows the safe operator runner", () => {
  const visibility = operatorToolsVisibilityFromEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    ENABLE_INNGEST_WORKER: "true"
  });

  assert.equal(visibility.showDeveloperAdminTools, false);
  assert.equal(visibility.showOperatorTools, true);
  assert.equal(visibility.showSafeManualRunner, true);
});

test("disabled Inngest with queued work enters manual queued mode", () => {
  const pipelineStatus = queuedPipelineStatus();

  assert.equal(
    isManualQueuedAnalysisMode({
      analysisStatus: "RUNNING",
      inngestEnabled: false,
      pipelineStatus
    }),
    true
  );
  assert.equal(
    analysisStatusLabel({
      analysisStatus: "RUNNING",
      manualQueuedMode: true
    }),
    "Analys köad"
  );
  assert.equal(
    MANUAL_QUEUED_ANALYSIS_COPY,
    "Analysjobben är köade men körs inte automatiskt i preview. Kör nästa batch manuellt för att fortsätta."
  );
});

test("production node env alone does not hide the safe runner in preview", () => {
  const visibility = operatorToolsVisibilityFromEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "preview"
  });

  assert.equal(visibility.showDeveloperAdminTools, false);
  assert.equal(visibility.showOperatorTools, true);
});

test("manual manuscript runner targets the server-side run-jobs endpoint", () => {
  assert.equal(
    manuscriptManualRunEndpoint("manuscript-1"),
    "/api/admin/manuscripts/manuscript-1/run-jobs"
  );
});

test("upload autorun starts for explicit queued upload redirects", () => {
  assert.equal(
    shouldAutoRunQueuedAnalysisAfterUpload({
      requested: true,
      analysisReady: false,
      showOperatorTools: true,
      pipelineStatus: queuedPipelineStatus()
    }),
    true
  );
  assert.equal(
    shouldAutoRunQueuedAnalysisAfterUpload({
      requested: true,
      analysisReady: false,
      showOperatorTools: false,
      pipelineStatus: queuedPipelineStatus()
    }),
    true
  );
  assert.equal(
    shouldAutoRunQueuedAnalysisAfterUpload({
      requested: true,
      analysisReady: true,
      showOperatorTools: true,
      pipelineStatus: queuedPipelineStatus()
    }),
    false
  );
  assert.equal(
    shouldAutoRunQueuedAnalysisAfterUpload({
      requested: true,
      analysisReady: false,
      showOperatorTools: true,
      pipelineStatus: {
        ...queuedPipelineStatus(),
        currentJobStatus: PIPELINE_JOB_STATUS.RETRYING,
        jobCounts: {
          queued: 0,
          running: 0,
          blocked: 14,
          failed: 0,
          completed: 3
        }
      }
    }),
    true
  );
  assert.equal(
    shouldAutoRunQueuedAnalysisAfterUpload({
      requested: true,
      analysisReady: false,
      showOperatorTools: true,
      pipelineStatus: {
        ...queuedPipelineStatus(),
        jobCounts: {
          ...queuedPipelineStatus().jobCounts,
          queued: 0,
          running: 1
        }
      }
    }),
    false
  );
  assert.equal(
    shouldAutoRunQueuedAnalysisAfterUpload({
      requested: true,
      analysisReady: false,
      showOperatorTools: true,
      pipelineStatus: {
        ...queuedPipelineStatus(),
        jobCounts: {
          ...queuedPipelineStatus().jobCounts,
          failed: 1
        }
      }
    }),
    false
  );
});

test("operator visibility model never includes secret values", () => {
  const visibility = operatorToolsVisibilityFromEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    ENABLE_INNGEST_WORKER: "false",
    SHOW_OPERATOR_TOOLS: "true",
    ADMIN_JOB_TOKEN: "super-secret-token",
    INNGEST_EVENT_KEY: "inngest-secret"
  } as Record<string, string>);

  const serialized = JSON.stringify(visibility);

  assert.doesNotMatch(serialized, /super-secret-token/);
  assert.doesNotMatch(serialized, /inngest-secret/);
});

test("manual queued progress copy does not imply active background work", () => {
  const markup = renderToStaticMarkup(
    createElement(LivePipelineProgress, {
      manuscriptId: "manuscript-1",
      initialStatus: queuedPipelineStatus(),
      analysisStatus: "RUNNING",
      manualQueuedMode: true
    })
  );

  assert.match(markup, /Analys köad/);
  assert.match(markup, /Väntar på körning/);
  assert.doesNotMatch(markup, /Analysen pågår/);
});

test("manual queued retrying progress is not shown as a terminal failure", () => {
  const markup = renderToStaticMarkup(
    createElement(LivePipelineProgress, {
      manuscriptId: "manuscript-1",
      initialStatus: {
        ...queuedPipelineStatus(),
        currentStep: "createEmbeddingsForChunks",
        completedSteps: 3,
        percent: 17,
        currentJobStatus: PIPELINE_JOB_STATUS.RETRYING,
        lastError: "Embedding API timed out.",
        jobCounts: {
          queued: 0,
          running: 0,
          blocked: 14,
          failed: 0,
          completed: 3
        }
      },
      analysisStatus: "RUNNING",
      manualQueuedMode: true
    })
  );

  assert.match(markup, /Analys k/);
  assert.doesNotMatch(markup, /Analysen kunde inte slutf/);
});

function queuedPipelineStatus(): PipelineStatusDisplay {
  return {
    currentStep: "summarizeChunks",
    nextStep: "summarizeChapters",
    completedSteps: 0,
    totalSteps: 18,
    percent: 0,
    currentJobStatus: PIPELINE_JOB_STATUS.QUEUED,
    analyzedCount: null,
    remainingCount: null,
    complete: false,
    lastUpdatedAt: null,
    lastError: null,
    nextBlockedStep: null,
    jobCounts: {
      queued: 1,
      running: 0,
      blocked: 0,
      failed: 0,
      completed: 0
    },
    stepProgressLabel: null,
    remainingLabel: null,
    stepProgress: null,
    lockStatus: null,
    coreAnalysisComplete: false,
    optionalRewriteDraftsPending: false
  };
}
