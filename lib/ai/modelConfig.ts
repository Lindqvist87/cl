import { env } from "@/lib/env";

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export type ModelRole =
  | "audit"
  | "localEditor"
  | "auditEditor"
  | "sectionEditor"
  | "aggregator"
  | "chiefEditor";

export type ModelConfig = {
  localEditorModel: string;
  localEditorReasoningEffort: ReasoningEffort;
  auditModel: string;
  auditReasoningEffort: ReasoningEffort;
  sectionEditorModel: string;
  sectionEditorReasoningEffort: ReasoningEffort;
  chiefEditorModel: string;
  chiefEditorReasoningEffort: ReasoningEffort;
};

export type ModelRoleConfig = {
  model: string;
  reasoningEffort: ReasoningEffort;
};

export type ModelConfigEnv = Partial<
  Record<
    | "AUDIT_MODEL"
    | "AUDIT_REASONING_EFFORT"
    | "CHIEF_EDITOR_MODEL"
    | "CHIEF_EDITOR_REASONING_EFFORT"
    | "OPENAI_AUDIT_MODEL"
    | "OPENAI_REWRITE_MODEL"
    | "OPENAI_EDITOR_MODEL",
    string | undefined
  >
>;

const DEFAULT_LOCAL_EDITOR_MODEL = "gpt-5.4-mini";
const DEFAULT_AUDIT_MODEL = "gpt-5.4-mini";
const DEFAULT_CHIEF_EDITOR_MODEL = "gpt-5.4";
const DEFAULT_LOCAL_EDITOR_REASONING_EFFORT: ReasoningEffort = "medium";
const DEFAULT_AUDIT_REASONING_EFFORT: ReasoningEffort = "medium";
const DEFAULT_CHIEF_EDITOR_REASONING_EFFORT: ReasoningEffort = "high";

export function resolveModelConfig(source: ModelConfigEnv = env): ModelConfig {
  const localEditorModel = firstNonEmpty(
    DEFAULT_LOCAL_EDITOR_MODEL,
    source.OPENAI_EDITOR_MODEL
  );
  const auditModel = firstNonEmpty(
    DEFAULT_AUDIT_MODEL,
    source.AUDIT_MODEL,
    source.OPENAI_AUDIT_MODEL,
    source.OPENAI_EDITOR_MODEL
  );

  const auditReasoningEffort = parseReasoningEffort(
    source.AUDIT_REASONING_EFFORT,
    DEFAULT_AUDIT_REASONING_EFFORT
  );

  return {
    localEditorModel,
    localEditorReasoningEffort: DEFAULT_LOCAL_EDITOR_REASONING_EFFORT,
    auditModel,
    auditReasoningEffort,
    sectionEditorModel: auditModel,
    sectionEditorReasoningEffort: auditReasoningEffort,
    chiefEditorModel: firstNonEmpty(
      DEFAULT_CHIEF_EDITOR_MODEL,
      source.CHIEF_EDITOR_MODEL,
      source.OPENAI_REWRITE_MODEL,
      source.OPENAI_AUDIT_MODEL,
      source.OPENAI_EDITOR_MODEL
    ),
    chiefEditorReasoningEffort: parseReasoningEffort(
      source.CHIEF_EDITOR_REASONING_EFFORT,
      DEFAULT_CHIEF_EDITOR_REASONING_EFFORT
    )
  };
}

export function parseReasoningEffort(
  value: string | undefined,
  fallback: ReasoningEffort
): ReasoningEffort {
  const normalized = value?.trim().toLowerCase();

  return isReasoningEffort(normalized) ? normalized : fallback;
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" &&
    REASONING_EFFORTS.includes(value as ReasoningEffort)
  );
}

const resolvedModelConfig = resolveModelConfig();

export const localEditorModel = resolvedModelConfig.localEditorModel;
export const localEditorReasoningEffort =
  resolvedModelConfig.localEditorReasoningEffort;
export const auditModel = resolvedModelConfig.auditModel;
export const auditReasoningEffort = resolvedModelConfig.auditReasoningEffort;
export const sectionEditorModel = resolvedModelConfig.sectionEditorModel;
export const sectionEditorReasoningEffort =
  resolvedModelConfig.sectionEditorReasoningEffort;
export const chiefEditorModel = resolvedModelConfig.chiefEditorModel;
export const chiefEditorReasoningEffort =
  resolvedModelConfig.chiefEditorReasoningEffort;

export function modelConfigForRole(role: ModelRole): ModelRoleConfig {
  if (role === "localEditor") {
    return {
      model: localEditorModel,
      reasoningEffort: localEditorReasoningEffort
    };
  }

  if (role === "chiefEditor") {
    return {
      model: chiefEditorModel,
      reasoningEffort: chiefEditorReasoningEffort
    };
  }

  if (
    role === "audit" ||
    role === "auditEditor" ||
    role === "sectionEditor" ||
    role === "aggregator"
  ) {
    return {
      model: sectionEditorModel,
      reasoningEffort: sectionEditorReasoningEffort
    };
  }

  return {
    model: auditModel,
    reasoningEffort: auditReasoningEffort
  };
}

export function getModelRoleDiagnostics() {
  return {
    audit: modelConfigForRole("audit"),
    localEditor: modelConfigForRole("localEditor"),
    auditEditor: modelConfigForRole("auditEditor"),
    sectionEditor: modelConfigForRole("sectionEditor"),
    aggregator: modelConfigForRole("aggregator"),
    chiefEditor: modelConfigForRole("chiefEditor")
  };
}

function firstNonEmpty(fallback: string, ...values: Array<string | undefined>) {
  return (
    values
      .find((value) => typeof value === "string" && value.trim().length > 0)
      ?.trim() ?? fallback
  );
}
