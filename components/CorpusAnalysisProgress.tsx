import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Loader2
} from "lucide-react";
import { PipelineActionButton } from "@/components/PipelineActionButton";
import type {
  CorpusAnalysisStepState,
  CorpusAnalysisSummary
} from "@/lib/corpus/corpusAnalysisJobs";
import { shouldShowCorpusAnalysisAction } from "@/lib/corpus/corpusAnalysisJobs";

export function CorpusAnalysisProgress({
  summary,
  compact = false
}: {
  summary: CorpusAnalysisSummary;
  compact?: boolean;
}) {
  const steps = [
    summary.steps.imported,
    summary.steps.cleaning,
    summary.steps.chapters,
    summary.steps.chunks,
    summary.steps.embeddings,
    summary.steps.bookDna
  ];

  return (
    <div className="space-y-3">
      <div
        className={[
          "grid gap-2",
          compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"
        ].join(" ")}
      >
        {steps.map((step) => (
          <ProgressStep key={step.label} step={step} />
        ))}
      </div>
      <div className="border border-line bg-paper p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <ProgressStep step={summary.steps.benchmark} bare />
          <div className="text-sm font-semibold">
            Benchmark ready: {summary.steps.benchmark.ready ? "Yes" : "No"}
          </div>
        </div>
        {summary.steps.benchmark.blockingReason ? (
          <p className="mt-2 text-sm text-slate-600">
            {summary.steps.benchmark.blockingReason}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CorpusAnalysisAction({
  bookId,
  summary,
  analysisStatus,
  variant = "primary"
}: {
  bookId: string;
  summary: CorpusAnalysisSummary;
  analysisStatus: string;
  variant?: "primary" | "secondary";
}) {
  if (!shouldShowCorpusAnalysisAction({ analysisStatus, summary })) {
    return null;
  }

  return (
    <PipelineActionButton
      endpoint={`/api/admin/corpus/${bookId}/run-analysis`}
      label={analysisStatus === "NOT_STARTED" ? "Start analysis" : "Run Book DNA pipeline"}
      runningLabel="Starting analysis..."
      variant={variant}
    />
  );
}

function ProgressStep({
  step,
  bare = false
}: {
  step: { label: string; status: CorpusAnalysisStepState; statusLabel: string; detail?: string | null };
  bare?: boolean;
}) {
  const Icon = iconForStatus(step.status);
  const color = colorForStatus(step.status);

  return (
    <div className={bare ? "flex items-center gap-2" : "border border-line bg-white p-3"}>
      <div className="flex items-center gap-2">
        <Icon size={16} className={color} aria-hidden="true" />
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {step.label}
          </div>
          <div className="mt-0.5 text-sm font-semibold">{step.statusLabel}</div>
        </div>
      </div>
      {!bare && step.detail ? (
        <p className="mt-2 line-clamp-2 text-xs text-slate-500">{step.detail}</p>
      ) : null}
    </div>
  );
}

function iconForStatus(status: CorpusAnalysisStepState) {
  switch (status) {
    case "done":
      return CheckCircle2;
    case "running":
      return Loader2;
    case "failed":
      return AlertTriangle;
    case "blocked":
    case "skipped":
      return Ban;
    case "queued":
    case "not_started":
      return CircleDashed;
  }
}

function colorForStatus(status: CorpusAnalysisStepState) {
  switch (status) {
    case "done":
      return "text-accent";
    case "running":
      return "text-ink";
    case "failed":
      return "text-danger";
    case "blocked":
    case "skipped":
      return "text-slate-500";
    case "queued":
    case "not_started":
      return "text-slate-400";
  }
}
