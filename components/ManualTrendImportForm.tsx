"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

export function ManualTrendImportForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current) return;

    setIsSubmitting(true);
    setError(null);

    const response = await fetch("/api/trends/manual", {
      method: "POST",
      body: new FormData(formRef.current)
    });
    const payload = (await response.json()) as { error?: string };

    setIsSubmitting(false);

    if (!response.ok) {
      setError(payload.error ?? "Trend import failed.");
      return;
    }

    formRef.current.reset();
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="active-card p-5">
      <div className="mb-5">
        <p className="page-kicker">Market intake</p>
        <h2 className="mt-2 text-xl font-semibold tracking-normal text-ink">
          Add market signal
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Capture public metadata, list movement, review language, and category notes.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <input name="source" required placeholder="Source" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="listName" placeholder="List name" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="title" placeholder="Title" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="author" placeholder="Author" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="genre" placeholder="Genre" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="category" placeholder="Category" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="rank" type="number" placeholder="Rank" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="signalDate" type="date" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm" />
        <input name="externalUrl" placeholder="External URL" className="focus-ring min-h-10 border border-line bg-paper-alt px-3 text-sm md:col-span-2" />
        <textarea name="description" placeholder="Description" className="focus-ring min-h-24 border border-line bg-paper-alt px-3 py-2 text-sm md:col-span-2" />
        <textarea name="blurb" placeholder="Blurb or public metadata" className="focus-ring min-h-24 border border-line bg-paper-alt px-3 py-2 text-sm md:col-span-2" />
        <textarea name="reviewSnippet" placeholder="Review snippet" className="focus-ring min-h-24 border border-line bg-paper-alt px-3 py-2 text-sm md:col-span-2" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={isSubmitting} className="primary-button">
          <Plus size={18} aria-hidden="true" />
          {isSubmitting ? "Adding..." : "Add market signal"}
        </button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </form>
  );
}
