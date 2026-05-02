"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import copy from "@/content/app-copy.json";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];

    if (!file) {
      setError(copy.upload.emptyFileError);
      return;
    }

    const formData = new FormData(event.currentTarget);
    formData.set("file", file);
    setIsUploading(true);
    setError(null);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const payload = (await response.json()) as {
      manuscriptId?: string;
      error?: string;
    };

    setIsUploading(false);

    if (!response.ok || !payload.manuscriptId) {
      setError(payload.error ?? copy.upload.failedError);
      return;
    }

    router.push(`/manuscripts/${payload.manuscriptId}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="active-card p-6 sm:p-7"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Upload size={20} aria-hidden="true" />
        </div>
        <div>
          <h2 className="section-title">Upload manuscript</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Add a full manuscript and optional context so the analysis can start from the right editorial lens.
          </p>
        </div>
      </div>

      <label className="mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-accent/35 bg-paper-alt px-5 py-8 text-center hover:border-accent hover:bg-white focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-paper">
        <FileText size={28} className="text-accent" aria-hidden="true" />
        <span className="mt-3 text-sm font-semibold text-ink">
          {selectedFileName ?? "Choose a .txt or .docx manuscript"}
        </span>
        <span className="mt-1 text-xs text-muted">
          The file stays local until you upload it.
        </span>
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={(event) =>
            setSelectedFileName(event.currentTarget.files?.[0]?.name ?? null)
          }
        />
      </label>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Author
          </span>
          <input
            name="authorName"
            placeholder="Author name"
            className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper-alt px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Genre
          </span>
          <input
            name="targetGenre"
            placeholder="Target genre"
            className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper-alt px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Audience
          </span>
          <input
            name="targetAudience"
            placeholder="Target audience"
            className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper-alt px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted">
          Supports plain text and Word documents.
        </p>
        <button
          type="submit"
          disabled={isUploading}
          className="primary-button sm:min-w-44"
        >
          <Upload size={18} aria-hidden="true" />
          {isUploading ? copy.upload.busyLabel : copy.upload.idleLabel}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
