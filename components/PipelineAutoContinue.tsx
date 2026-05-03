"use client";

import { useEffect, useRef } from "react";
import { PIPELINE_DIAGNOSTICS_REFRESH_EVENT } from "@/components/pipelineEvents";

type PipelineAutoContinueDiagnostics = {
  state?: string | null;
  nextEligibleJob?: unknown;
  staleRunningJobs?: unknown[] | null;
  pipelineStatus?: {
    complete?: boolean | null;
    currentJobStatus?: string | null;
  } | null;
};

export function PipelineAutoContinue({
  manuscriptId,
  analysisStatus
}: {
  manuscriptId: string;
  analysisStatus?: string | null;
}) {
  const inFlightRef = useRef(false);
  const attemptsByJobRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (analysisStatus?.toUpperCase() !== "RUNNING") {
      return;
    }

    let cancelled = false;

    async function recoverIfPossible() {
      if (inFlightRef.current) {
        return;
      }

      const diagnostics = await fetchDiagnostics(manuscriptId);
      if (!diagnostics || cancelled || !isRecoverable(diagnostics)) {
        return;
      }

      const recoverableJobId =
        jobIdFromUnknown(diagnostics.nextEligibleJob) ??
        firstJobIdFromUnknownList(diagnostics.staleRunningJobs);
      if (!recoverableJobId) {
        return;
      }

      const attempts = attemptsByJobRef.current.get(recoverableJobId) ?? 0;
      if (attempts >= 2) {
        return;
      }

      attemptsByJobRef.current.set(recoverableJobId, attempts + 1);
      inFlightRef.current = true;
      dispatchProgressRefresh(manuscriptId, true, "running");

      try {
        const response = await fetch(
          `/api/manuscripts/${manuscriptId}/resume-pipeline`,
          { method: "POST" }
        );
        const result = await response.json().catch(() => ({}));

        dispatchProgressRefresh(manuscriptId, false, "running", result);
      } catch {
        dispatchProgressRefresh(manuscriptId, false, "failed");
      } finally {
        inFlightRef.current = false;
      }
    }

    void recoverIfPossible();
    const interval = window.setInterval(() => {
      void recoverIfPossible();
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [analysisStatus, manuscriptId]);

  return null;
}

async function fetchDiagnostics(manuscriptId: string) {
  try {
    const response = await fetch(
      `/api/admin/manuscripts/${manuscriptId}/diagnostics`,
      { cache: "no-store" }
    );

    return (await response.json().catch(() => ({}))) as
      | PipelineAutoContinueDiagnostics
      | null;
  } catch {
    return null;
  }
}

function isRecoverable(diagnostics: PipelineAutoContinueDiagnostics) {
  if (
    diagnostics.state === "done" ||
    diagnostics.state === "blocked_by_error" ||
    diagnostics.pipelineStatus?.complete ||
    diagnostics.pipelineStatus?.currentJobStatus === "FAILED"
  ) {
    return false;
  }

  return Boolean(
    diagnostics.nextEligibleJob || (diagnostics.staleRunningJobs?.length ?? 0) > 0
  );
}

function dispatchProgressRefresh(
  manuscriptId: string,
  autoRunnerActive: boolean,
  phase: "running" | "failed",
  result?: unknown
) {
  window.dispatchEvent(
    new CustomEvent(PIPELINE_DIAGNOSTICS_REFRESH_EVENT, {
      detail: {
        manuscriptId,
        autoRunnerActive,
        phase,
        result
      }
    })
  );
}

function jobIdFromUnknown(value: unknown) {
  const record = recordFromUnknown(value);

  return typeof record.id === "string" && record.id ? record.id : null;
}

function firstJobIdFromUnknownList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    const id = jobIdFromUnknown(item);
    if (id) {
      return id;
    }
  }

  return null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
