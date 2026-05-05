import {
  importManifestToParsedManuscript
} from "@/lib/import/v2/adapter";
import { buildTextImportManifest } from "@/lib/import/v2/text";
import type { ParsedManuscript } from "@/lib/types";

export function parseManuscriptText(
  rawText: string,
  sourceFileName: string
): ParsedManuscript {
  return importManifestToParsedManuscript(
    buildTextImportManifest({ rawText, sourceFileName })
  );
}
