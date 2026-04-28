import type { ManuscriptMemory } from "@/lib/types";

export function createEmptyMemory(): ManuscriptMemory {
  return {
    characters: [],
    plotThreads: [],
    settingNotes: [],
    styleNotes: [],
    risks: [],
    passSummaries: {}
  };
}

export function mergeMemory(
  memory: ManuscriptMemory,
  output: unknown
): ManuscriptMemory {
  const updates = extractUpdates(output);

  return {
    ...memory,
    premise: firstString(updates.premise, memory.premise),
    genre: firstString(updates.genre, memory.genre),
    targetAudience: firstString(updates.targetAudience, memory.targetAudience),
    corePromise: firstString(updates.corePromise, memory.corePromise),
    characters: mergeCharacters(memory.characters, updates.characters),
    plotThreads: mergeStringList(memory.plotThreads, updates.plotThreads),
    settingNotes: mergeStringList(memory.settingNotes, updates.settingNotes),
    styleNotes: mergeStringList(memory.styleNotes, updates.styleNotes),
    risks: mergeStringList(memory.risks, updates.risks),
    passSummaries: memory.passSummaries
  };
}

function extractUpdates(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object") {
    return {};
  }

  const record = output as Record<string, unknown>;
  const updates = record.memoryUpdates;
  return updates && typeof updates === "object"
    ? (updates as Record<string, unknown>)
    : {};
}

function firstString(value: unknown, fallback?: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function mergeStringList(existing: string[], incoming: unknown) {
  if (!Array.isArray(incoming)) {
    return existing;
  }

  const merged = [...existing];

  for (const item of incoming) {
    if (typeof item === "string" && item.trim() && !merged.includes(item.trim())) {
      merged.push(item.trim());
    }
  }

  return merged.slice(0, 80);
}

function mergeCharacters(
  existing: ManuscriptMemory["characters"],
  incoming: unknown
) {
  if (!Array.isArray(incoming)) {
    return existing;
  }

  const byName = new Map(existing.map((character) => [character.name, character]));

  for (const item of incoming) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) {
      continue;
    }

    const previous = byName.get(name);
    byName.set(name, {
      name,
      role:
        typeof record.role === "string" && record.role.trim()
          ? record.role.trim()
          : previous?.role,
      arcNotes:
        typeof record.arcNotes === "string" && record.arcNotes.trim()
          ? record.arcNotes.trim()
          : previous?.arcNotes
    });
  }

  return Array.from(byName.values()).slice(0, 80);
}
