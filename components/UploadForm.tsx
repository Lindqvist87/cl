"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import copy from "@/content/app-copy.json";

const QUEUED_UPLOAD_MESSAGE =
  "Manuset är uppladdat och analysjobben är köade. Starta eller återuppta analysen via admin.";
const PIPELINE_WARNING_MESSAGE =
  "Manuset är uppladdat, men analysen startade inte automatiskt. Starta eller återuppta analysen via admin.";
export const ADMIN_JOBS_PATH = "/admin/jobs?filter=ready";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [uploadedManuscriptId, setUploadedManuscriptId] = useState<string | null>(
    null
  );
  const [showAdminJobsLink, setShowAdminJobsLink] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  function selectFile(fileName: string | null) {
    setSelectedFileName(fileName);
    setError(null);
    setWarning(null);
    setUploadedManuscriptId(null);
    setShowAdminJobsLink(false);
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
    setWarning(null);
    setUploadedManuscriptId(null);
    setShowAdminJobsLink(false);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const payload = (await response.json().catch(() => ({}))) as UploadResponse;

    setIsUploading(false);

    const feedback = uploadFeedbackFromResponse(response.ok, payload);

    if (feedback.kind === "error") {
      setError(feedback.message);
      return;
    }

    if (feedback.kind === "notice") {
      setWarning(feedback.message);
      setUploadedManuscriptId(feedback.manuscriptId);
      setShowAdminJobsLink(feedback.showAdminJobsLink);
      return;
    }

    router.push(`/manuscripts/${feedback.manuscriptId}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="paper-card relative overflow-hidden p-5 sm:p-7"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent"
      />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">
          Ladda upp ditt manus. Vi hjälper dig förstå vad som behöver göras.
        </p>
      </div>

      <label
        className={`mt-5 flex min-h-[250px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-5 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-paper sm:min-h-[286px] sm:py-10 ${
          isDragging
            ? "border-accent bg-white shadow-[0_0_0_4px_rgba(232,93,158,0.08),inset_0_1px_0_rgba(255,255,255,0.92)]"
            : "border-line bg-[linear-gradient(180deg,#FFFEFC_0%,#FAFAF7_100%)] hover:border-accent/35 hover:bg-white"
        }`}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-paper-alt text-muted shadow-[0_16px_34px_rgba(23,23,23,0.045)]">
          <FileText size={28} aria-hidden="true" />
        </span>
        <span className="mt-6 text-2xl font-semibold tracking-normal text-ink">
          Dra in din fil här
        </span>
        <span className="mt-3 text-sm text-muted">eller</span>
        <span className="secondary-button mt-4 min-h-11 border-line/90 bg-white/92 px-5 shadow-[0_10px_24px_rgba(23,23,23,0.04)] hover:border-accent/35 hover:bg-white hover:shadow-[0_14px_28px_rgba(23,23,23,0.055)]">
          <Upload size={16} aria-hidden="true" />
          {selectedFileName ? "Byt fil" : "Välj fil"}
        </span>
        <span className="mt-5 max-w-sm text-sm leading-6 text-muted">
          DOCX stöds först. EPUB och PDF kan läggas till senare.
        </span>
        {selectedFileName ? (
          <span className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink shadow-[0_10px_22px_rgba(23,23,23,0.045)]">
            <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden="true" />
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

      <div className="mt-5 rounded-lg border border-line/85 bg-[#FFFEFC]/76 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
        <div className="grid gap-3 lg:grid-cols-3">
          <EditorialField
            label="Författare"
            name="authorName"
            placeholder="Namn"
          />
          <EditorialField
            label="Genre"
            name="targetGenre"
            placeholder="Ex. roman"
          />
          <EditorialField
            label="Målgrupp"
            name="targetAudience"
            placeholder="Ex. vuxna läsare"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted">
          Du kan starta med bara filen och lägga till mer senare.
        </p>
        <button
          type="submit"
          disabled={isUploading}
          className="primary-button min-h-12 px-5 sm:min-w-52"
        >
          <Upload size={18} aria-hidden="true" />
          {isUploading ? copy.upload.busyLabel : copy.upload.idleLabel}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {warning ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-line bg-paper-alt px-3 py-2 text-sm text-ink"
        >
          {warning}
        </p>
      ) : null}
      {uploadedManuscriptId ? (
        <UploadStatusLinks
          manuscriptId={uploadedManuscriptId}
          showAdminJobsLink={showAdminJobsLink}
        />
      ) : null}
    </form>
  );
}

export type UploadResponse = {
  manuscriptId?: string;
  error?: string;
  phase?: string;
  pipelineStarted?: boolean;
  pipelineQueued?: boolean;
  pipelineWarning?: string;
  message?: string;
};

type UploadFeedback =
  | { kind: "redirect"; manuscriptId: string }
  | { kind: "error"; message: string }
  | {
      kind: "notice";
      message: string;
      manuscriptId: string;
      showAdminJobsLink: boolean;
    };

export function uploadFeedbackFromResponse(
  responseOk: boolean,
  payload: UploadResponse
): UploadFeedback {
  if (!responseOk || !payload.manuscriptId) {
    return {
      kind: "error",
      message: uploadResponseMessage(payload, copy.upload.failedError)
    };
  }

  if (payload.pipelineQueued === true) {
    return {
      kind: "notice",
      manuscriptId: payload.manuscriptId,
      showAdminJobsLink: true,
      message: payload.message || QUEUED_UPLOAD_MESSAGE
    };
  }

  if (payload.pipelineStarted === false) {
    return {
      kind: "notice",
      manuscriptId: payload.manuscriptId,
      showAdminJobsLink: false,
      message: uploadResponseMessage(payload, PIPELINE_WARNING_MESSAGE)
    };
  }

  return { kind: "redirect", manuscriptId: payload.manuscriptId };
}

export function UploadStatusLinks({
  manuscriptId,
  showAdminJobsLink
}: {
  manuscriptId: string;
  showAdminJobsLink: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link
        href={`/manuscripts/${manuscriptId}`}
        className="secondary-button w-fit"
      >
        Visa uppladdat manus
      </Link>
      {showAdminJobsLink ? (
        <Link href={ADMIN_JOBS_PATH} className="secondary-button w-fit">
          Öppna adminjobb
        </Link>
      ) : null}
    </div>
  );
}

function uploadResponseMessage(payload: UploadResponse, fallback: string) {
  const parts = [payload.error ?? payload.message ?? fallback];

  if (payload.phase) {
    parts.push(`phase=${payload.phase}`);
  }

  if (payload.pipelineWarning) {
    parts.push(payload.pipelineWarning);
  }

  return parts.filter(Boolean).join(" ");
}

function EditorialField({
  label,
  name,
  placeholder
}: {
  label: string;
  name: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted/90">
        {label}
      </span>
      <input
        name={name}
        placeholder={placeholder}
        className="focus-ring mt-1 min-h-11 w-full rounded-lg border border-line/90 bg-white/82 px-3.5 py-2.5 text-sm text-ink shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_8px_18px_rgba(23,23,23,0.025)] placeholder:text-slate-400 hover:border-accent/25 hover:bg-white"
      />
    </label>
  );
}
