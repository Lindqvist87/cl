"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import copy from "@/content/app-copy.json";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  function selectFile(fileName: string | null) {
    setSelectedFileName(fileName);
    setError(null);
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    selectFile(event.currentTarget.files?.[0]?.name ?? null);
  }

  function onDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();

    if (!isUploading) {
      setIsDragging(true);
    }
  }

  function onDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDragging(false);
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (!file || !inputRef.current) {
      return;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    inputRef.current.files = dataTransfer.files;
    selectFile(file.name);
  }

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
    <form onSubmit={onSubmit} className="paper-card p-5 sm:p-7">
      <label
        className={[
          "flex min-h-[230px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-8 text-center transition sm:min-h-[270px]",
          "focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-paper",
          isDragging
            ? "border-accent bg-white shadow-active"
            : "border-accent/35 bg-paper-alt shadow-active hover:border-accent/70 hover:bg-white"
        ].join(" ")}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/15 bg-white text-accent shadow-panel">
          <FileText size={26} aria-hidden="true" />
        </span>
        <span className="mt-5 text-2xl font-semibold tracking-normal text-ink">
          Dra in din fil här
        </span>
        <span className="mt-2 text-sm text-muted">eller</span>
        <span className="secondary-button mt-3 min-h-11 px-5">Välj fil</span>
        <span className="mt-5 max-w-sm text-sm leading-6 text-muted">
          DOCX stöds först. EPUB och PDF kan läggas till senare.
        </span>
        {selectedFileName ? (
          <span className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-accent/20 bg-white px-4 py-2 text-sm font-semibold text-ink">
            <CheckCircle2
              size={16}
              className="shrink-0 text-accent"
              aria-hidden="true"
            />
            <span className="truncate">{selectedFileName}</span>
          </span>
        ) : null}
        <input
          ref={inputRef}
          name="file"
          type="file"
          accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={onFileChange}
        />
      </label>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Författare
          </span>
          <input
            name="authorName"
            placeholder="Namn"
            className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper-alt px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Genre
          </span>
          <input
            name="targetGenre"
            placeholder="Ex. roman"
            className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper-alt px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Målgrupp
          </span>
          <input
            name="targetAudience"
            placeholder="Ex. vuxna läsare"
            className="focus-ring mt-1 min-h-10 w-full border border-line bg-paper-alt px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="submit"
          disabled={isUploading}
          className="primary-button min-h-12 sm:min-w-52"
        >
          <Upload size={18} aria-hidden="true" />
          {isUploading ? copy.upload.busyLabel : copy.upload.idleLabel}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
