import { RightsStatus, SourceType } from "@prisma/client";

export type CorpusOnboardingMetadata = {
  title: string;
  author?: string;
  language?: string;
  genre?: string;
  source?: string;
  sourceUrl?: string;
  rightsStatus: RightsStatus;
  licenseType?: string;
  benchmarkAllowed: boolean;
  sourceType?: SourceType;
  publicationYear?: number;
};

export type CorpusOnboardingBookInput = CorpusOnboardingMetadata & {
  file?: File;
};

export function validateBenchmarkRights(input: {
  benchmarkAllowed: boolean;
  rightsStatus: RightsStatus | string;
}) {
  if (
    input.benchmarkAllowed &&
    (input.rightsStatus === RightsStatus.UNKNOWN ||
      input.rightsStatus === RightsStatus.METADATA_ONLY)
  ) {
    throw new Error(
      "Benchmarking cannot be allowed when rights status is UNKNOWN or METADATA_ONLY."
    );
  }
}

export function parseCorpusOnboardingFormData(
  formData: FormData
): CorpusOnboardingBookInput[] {
  const files = formData
    .getAll("files")
    .filter((file): file is File => file instanceof File && file.size > 0);
  const metadata = parseMetadataArray(formData);

  if (metadata.length > 0) {
    if (metadata.length !== files.length) {
      throw new Error("Each uploaded file needs one metadata confirmation row.");
    }

    return metadata.map((book, index) => ({
      ...book,
      file: files[index]
    }));
  }

  const singleFile = formData.get("file");
  const title = stringField(formData, "title");
  const rightsStatus = enumValue(stringField(formData, "rightsStatus"), RightsStatus);

  if (!title) {
    throw new Error("Title is required.");
  }

  if (!rightsStatus) {
    throw new Error("A rights status is required before import.");
  }

  const benchmarkAllowed = checkboxField(formData, "corpusBenchmarking");
  validateBenchmarkRights({ benchmarkAllowed, rightsStatus });

  return [
    {
      file: singleFile instanceof File && singleFile.size > 0 ? singleFile : undefined,
      title,
      author: stringField(formData, "author"),
      language: stringField(formData, "language"),
      genre: stringField(formData, "genre"),
      source: stringField(formData, "source"),
      sourceUrl: stringField(formData, "sourceUrl"),
      sourceType: enumValue(stringField(formData, "sourceType"), SourceType) ?? SourceType.MANUAL,
      publicationYear: numberField(formData, "publicationYear"),
      rightsStatus,
      licenseType: stringField(formData, "licenseType"),
      benchmarkAllowed
    }
  ];
}

function parseMetadataArray(formData: FormData) {
  const raw = formData.get("books");
  if (typeof raw !== "string" || !raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Corpus onboarding metadata must be an array.");
  }

  return parsed.map((value, index) => normalizeMetadata(value, index));
}

function normalizeMetadata(value: unknown, index: number): CorpusOnboardingMetadata {
  const record = toRecord(value);
  const title = stringValue(record.title);
  const rightsStatus = enumValue(stringValue(record.rightsStatus), RightsStatus);

  if (!title) {
    throw new Error(`Book ${index + 1} needs a title.`);
  }

  if (!rightsStatus) {
    throw new Error(`Book ${index + 1} needs a rights status.`);
  }

  const benchmarkAllowed = booleanValue(record.benchmarkAllowed);
  validateBenchmarkRights({ benchmarkAllowed, rightsStatus });

  return {
    title,
    author: stringValue(record.author),
    language: stringValue(record.language),
    genre: stringValue(record.genre),
    source: stringValue(record.source),
    sourceUrl: stringValue(record.sourceUrl),
    sourceType: enumValue(stringValue(record.sourceType), SourceType) ?? SourceType.MANUAL,
    publicationYear: numberValue(record.publicationYear),
    rightsStatus,
    licenseType: stringValue(record.licenseType),
    benchmarkAllowed
  };
}

function stringField(formData: FormData, name: string) {
  return stringValue(formData.get(name));
}

function numberField(formData: FormData, name: string) {
  return numberValue(formData.get(name));
}

function checkboxField(formData: FormData, name: string) {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function enumValue<T extends Record<string, string>>(
  value: string | undefined,
  enumObject: T
) {
  const values = Object.values(enumObject) as string[];
  return value && values.includes(value) ? (value as T[keyof T]) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  const stringified = typeof value === "number" ? String(value) : stringValue(value);
  if (!stringified) return undefined;
  const parsed = Number(stringified);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === "on" || value === 1;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
