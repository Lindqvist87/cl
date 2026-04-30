"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Eye, X } from "lucide-react";
import type {
  EditorialDecisionScope,
  EditorialDecisionStatus
} from "@/lib/editorial/decisions";

type EditorialDecisionControlsProps = {
  manuscriptId: string;
  chapterId?: string | null;
  findingId?: string | null;
  rewritePlanId?: string | null;
  title: string;
  rationale?: string | null;
  scope: EditorialDecisionScope;
  currentStatus?: EditorialDecisionStatus | null;
  metadata?: unknown;
};

const statusOptions: Array<{
  status: EditorialDecisionStatus;
  label: string;
  Icon: typeof Check;
}> = [
  { status: "ACCEPTED", label: "Accept", Icon: Check },
  { status: "REJECTED", label: "Reject", Icon: X },
  { status: "DEFERRED", label: "Defer", Icon: Clock },
  { status: "NEEDS_REVIEW", label: "Needs review", Icon: Eye }
];

export function EditorialDecisionControls({
  manuscriptId,
  chapterId,
  findingId,
  rewritePlanId,
  title,
  rationale,
  scope,
  currentStatus,
  metadata
}: EditorialDecisionControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] =
    useState<EditorialDecisionStatus | null>(currentStatus ?? null);
  const [error, setError] = useState<string | null>(null);

  function updateDecision(status: EditorialDecisionStatus) {
    setError(null);
    setOptimisticStatus(status);
    startTransition(async () => {
      const response = await fetch(`/api/manuscripts/${manuscriptId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId,
          findingId,
          rewritePlanId,
          title,
          rationale,
          scope,
          status,
          metadata
        })
      });

      if (!response.ok) {
        setOptimisticStatus(currentStatus ?? null);
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(result?.error ?? "Decision update failed.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {statusOptions.map(({ status, label, Icon }) => {
          const active = optimisticStatus === status;

          return (
            <button
              key={status}
              type="button"
              disabled={isPending}
              aria-pressed={active}
              onClick={() => updateDecision(status)}
              className={`focus-ring inline-flex min-h-9 items-center gap-2 border px-3 py-2 text-sm font-semibold ${
                active
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-white text-ink hover:bg-paper"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
