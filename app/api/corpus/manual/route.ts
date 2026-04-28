import { NextResponse } from "next/server";
import { RightsStatus, SourceType } from "@prisma/client";
import { importManualCorpusBook } from "@/lib/corpus/manualCorpusImport";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const title = stringField(formData, "title");
  const rightsStatus = enumField(formData, "rightsStatus", RightsStatus);

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  if (!rightsStatus) {
    return NextResponse.json(
      { error: "A rights status is required before import." },
      { status: 400 }
    );
  }

  try {
    const book = await importManualCorpusBook({
      file: file instanceof File && file.size > 0 ? file : undefined,
      title,
      author: stringField(formData, "author"),
      language: stringField(formData, "language"),
      publicationYear: numberField(formData, "publicationYear"),
      genre: stringField(formData, "genre"),
      sourceUrl: stringField(formData, "sourceUrl"),
      sourceType: enumField(formData, "sourceType", SourceType) ?? SourceType.MANUAL,
      rightsStatus,
      licenseType: stringField(formData, "licenseType"),
      allowedUses: {
        corpusBenchmarking: formData.get("corpusBenchmarking") === "on",
        privateReference: rightsStatus === RightsStatus.PRIVATE_REFERENCE
      }
    });

    return NextResponse.json({ bookId: book.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corpus import failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(formData: FormData, name: string) {
  const value = stringField(formData, name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function enumField<T extends Record<string, string>>(
  formData: FormData,
  name: string,
  enumObject: T
) {
  const value = stringField(formData, name);
  const values = Object.values(enumObject) as string[];
  return value && values.includes(value)
    ? (value as T[keyof T])
    : undefined;
}
