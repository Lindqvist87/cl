"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import copy from "@/content/app-copy.json";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];

    if (!file) {
      setError(copy.upload.emptyFileError);
      return;
    }

    const formData = new FormData();
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
      className="active-card p-5"
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <input
          name="authorName"
          placeholder="Author name"
          className="focus-ring min-h-10 border border-line bg-paper-alt px-3 py-2 text-sm"
        />
        <input
          name="targetGenre"
          placeholder="Target genre"
          className="focus-ring min-h-10 border border-line bg-paper-alt px-3 py-2 text-sm"
        />
        <input
          name="targetAudience"
          placeholder="Target audience"
          className="focus-ring min-h-10 border border-line bg-paper-alt px-3 py-2 text-sm"
        />
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="focus-ring min-h-10 flex-1 border border-line bg-paper-alt px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isUploading}
          className="primary-button"
        >
          <Upload size={18} aria-hidden="true" />
          {isUploading ? copy.upload.busyLabel : copy.upload.idleLabel}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
