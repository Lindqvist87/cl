import type { Prisma } from "@prisma/client";

export function jsonInput(value: unknown): Prisma.InputJsonValue {
  return sanitizeJson(value) as Prisma.InputJsonValue;
}

function sanitizeJson(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sanitizeJson(item)
    ])
  );
}
