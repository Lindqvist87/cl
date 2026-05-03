import { createHash } from "node:crypto";

export function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value: unknown) {
  return hashText(JSON.stringify(stableJsonValue(value)));
}

function stableJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)])
  );
}
