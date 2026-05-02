"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw, X } from "lucide-react";

export function AcceptRewriteButton({
  manuscriptId,
  chapterId,
  status,
  disabled
}: {
  manuscriptId: string;
  chapterId: string;
  status?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: "accept" | "reject" | "regenerate") {
    setPendingAction(action);
    setError(null);

    const endpoint =
      action === "accept"
        ? "accept-rewrite"
        : action === "reject"
          ? "reject-rewrite"
          : "rewrite";
    const response = await fetch(
      `/api/manuscripts/${manuscriptId}/chapters/${chapterId}/${endpoint}`,
      { method: "POST" }
    );
    const payload = (await response.json()) as { error?: string };

    setPendingAction(null);

    if (!response.ok) {
      setError(payload.error ?? "Could not update rewrite.");
      return;
    }

    router.refresh();
  }

  const isBusy = pendingAction !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || isBusy || status === "ACCEPTED"}
          onClick={() => runAction("accept")}
          className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white shadow-button hover:bg-accent-dark disabled:opacity-60"
        >
          <Check size={16} aria-hidden="true" />
          {pendingAction === "accept" ? "Saving..." : "Accept"}
        </button>
        <button
          type="button"
          disabled={disabled || isBusy || status === "REJECTED"}
          onClick={() => runAction("reject")}
          className="secondary-button min-h-9 px-3"
        >
          <X size={16} aria-hidden="true" />
          {pendingAction === "reject" ? "Rejecting..." : "Reject"}
        </button>
        <button
          type="button"
          disabled={disabled || isBusy}
          onClick={() => runAction("regenerate")}
          className="secondary-button min-h-9 px-3"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {pendingAction === "regenerate" ? "Regenerating..." : "Regenerate"}
        </button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
