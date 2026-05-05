import { env } from "@/lib/env";

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ModelRole =
  | "extraction"
  | "audit"
  | "sceneAnalysis"
  | "chapterCompiler"
  | "wholeBookCompiler"
  | "chiefEditor"
  | "rewrite";

export type ModelRoleConfig = {
  model: string;
  reasoningEffort: ReasoningEffort;
};

export type ModelRoleDiagnostic = ModelRoleConfig & {
  modelSource: string;
  reasoningEffortSource: string;
};

export type ModelConfig = {
  roles: Record<ModelRole, ModelRoleConfig>;
  diagnostics: Record<ModelRole, ModelRoleDiagnostic>;
  auditModel: string;
  auditReasoningEffort: ReasoningEffort;
  chiefEditorModel: string;
  chiefEditorReasoningEffort: ReasoningEffort;
};

export type ModelConfigEnv = Partial<
  Record<
    | "EXTRACTION_MODEL"
    | "EXTRACTION_REASONING_EFFORT"
    | "AUDIT_MODEL"
    | "AUDIT_REASONING_EFFORT"
    | "SCENE_ANALYSIS_MODEL"
    | "SCENE_ANALYSIS_REASONING_EFFORT"
    | "CHAPTER_COMPILER_MODEL"
    | "CHAPTER_COMPILER_REASONING_EFFORT"
    | "WHOLE_BOOK_COMPILER_MODEL"
    | "WHOLE_BOOK_COMPILER_REASONING_EFFORT"
    | "CHIEF_EDITOR_MODEL"
    | "CHIEF_EDITOR_REASONING_EFFORT"
    | "OPENAI_REWRITE_MODEL"
    | "REWRITE_REASONING_EFFORT"
    | "OPENAI_AUDIT_MODEL"
    | "OPENAI_EDITOR_MODEL",
    string | undefined
  >
>;

const ROLE_DEFAULTS: Record<ModelRole, ModelRoleConfig> = {
  extraction: {
    model: "gpt-5.4-nano",
    reasoningEffort: "low"
  },
  audit: {
    model: "gpt-5.4-mini",
    reasoningEffort: "medium"
  },
  sceneAnalysis: {
    model: "gpt-5.4-mini",
    reasoningEffort: "medium"
  },
  chapterCompiler: {
    model: "gpt-5.4",
    reasoningEffort: "high"
  },
  wholeBookCompiler: {
    model: "gpt-5.4",
    reasoningEffort: "xhigh"
  },
  chiefEditor: {
    model: "gpt-5.4",
    reasoningEffort: "xhigh"
  },
  rewrite: {
    model: "gpt-5.4",
    reasoningEffort: "high"
  }
};

const MODEL_ENV_KEYS: Record<ModelRole, Array<keyof ModelConfigEnv>> = {
  extraction: ["EXTRACTION_MODEL", "OPENAI_EDITOR_MODEL"],
  audit: ["AUDIT_MODEL", "OPENAI_AUDIT_MODEL", "OPENAI_EDITOR_MODEL"],
  sceneAnalysis: [
    "SCENE_ANALYSIS_MODEL",
    "AUDIT_MODEL",
    "OPENAI_AUDIT_MODEL",
    "OPENAI_EDITOR_MODEL"
  ],
  chapterCompiler: [
    "CHAPTER_COMPILER_MODEL",
    "CHIEF_EDITOR_MODEL",
    "OPENAI_REWRITE_MODEL",
    "OPENAI_AUDIT_MODEL",
    "OPENAI_EDITOR_MODEL"
  ],
  wholeBookCompiler: [
    "WHOLE_BOOK_COMPILER_MODEL",
    "CHIEF_EDITOR_MODEL",
    "OPENAI_REWRITE_MODEL",
    "OPENAI_AUDIT_MODEL",
    "OPENAI_EDITOR_MODEL"
  ],
  chiefEditor: [
    "CHIEF_EDITOR_MODEL",
    "OPENAI_REWRITE_MODEL",
    "OPENAI_AUDIT_MODEL",
    "OPENAI_EDITOR_MODEL"
  ],
  rewrite: [
    "OPENAI_REWRITE_MODEL",
    "CHIEF_EDITOR_MODEL",
    "OPENAI_AUDIT_MODEL",
    "OPENAI_EDITOR_MODEL"
  ]
};

const REASONING_ENV_KEYS: Record<ModelRole, Array<keyof ModelConfigEnv>> = {
  extraction: ["EXTRACTION_REASONING_EFFORT"],
  audit: ["AUDIT_REASONING_EFFORT"],
  sceneAnalysis: [
    "SCENE_ANALYSIS_REASONING_EFFORT",
    "AUDIT_REASONING_EFFORT"
  ],
  chapterCompiler: [
    "CHAPTER_COMPILER_REASONING_EFFORT",
    "CHIEF_EDITOR_REASONING_EFFORT"
  ],
  wholeBookCompiler: [
    "WHOLE_BOOK_COMPILER_REASONING_EFFORT",
    "CHIEF_EDITOR_REASONING_EFFORT"
  ],
  chiefEditor: ["CHIEF_EDITOR_REASONING_EFFORT"],
  rewrite: ["REWRITE_REASONING_EFFORT", "CHIEF_EDITOR_REASONING_EFFORT"]
};

export const MODEL_ROLES: ModelRole[] = [
  "extraction",
  "audit",
  "sceneAnalysis",
  "chapterCompiler",
  "wholeBookCompiler",
  "chiefEditor",
  "rewrite"
];

export function resolveModelConfig(source: ModelConfigEnv = env): ModelConfig {
  const diagnostics = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, resolveRoleDiagnostic(role, source)])
  ) as Record<ModelRole, ModelRoleDiagnostic>;
  const roles = Object.fromEntries(
    MODEL_ROLES.map((role) => [
      role,
      {
        model: diagnostics[role].model,
        reasoningEffort: diagnostics[role].reasoningEffort
      }
    ])
  ) as Record<ModelRole, ModelRoleConfig>;

  return {
    roles,
    diagnostics,
    auditModel: roles.audit.model,
    auditReasoningEffort: roles.audit.reasoningEffort,
    chiefEditorModel: roles.chiefEditor.model,
    chiefEditorReasoningEffort: roles.chiefEditor.reasoningEffort
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

export const auditModel = resolvedModelConfig.auditModel;
export const auditReasoningEffort = resolvedModelConfig.auditReasoningEffort;
export const chiefEditorModel = resolvedModelConfig.chiefEditorModel;
export const chiefEditorReasoningEffort =
  resolvedModelConfig.chiefEditorReasoningEffort;

export function modelConfigForRole(role: ModelRole): ModelRoleConfig {
  return resolvedModelConfig.roles[role];
}

export function getModelRoleDiagnostics() {
  return resolvedModelConfig.diagnostics;
}

function resolveRoleDiagnostic(
  role: ModelRole,
  source: ModelConfigEnv
): ModelRoleDiagnostic {
  const defaults = ROLE_DEFAULTS[role];
  const model = firstNonEmptyWithSource(
    defaults.model,
    MODEL_ENV_KEYS[role],
    source
  );
  const reasoningEffort = firstValidReasoningEffortWithSource(
    defaults.reasoningEffort,
    REASONING_ENV_KEYS[role],
    source
  );

  return {
    model: model.value,
    reasoningEffort: reasoningEffort.value,
    modelSource: model.source,
    reasoningEffortSource: reasoningEffort.source
  };
}

function firstNonEmptyWithSource(
  fallback: string,
  keys: Array<keyof ModelConfigEnv>,
  source: ModelConfigEnv
) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        value: value.trim(),
        source: key
      };
    }
  }

  return {
    value: fallback,
    source: "default"
  };
}

function firstValidReasoningEffortWithSource(
  fallback: ReasoningEffort,
  keys: Array<keyof ModelConfigEnv>,
  source: ModelConfigEnv
) {
  for (const key of keys) {
    const parsed = parseReasoningEffort(source[key], fallback);
    if (source[key] !== undefined && parsed === source[key]?.trim().toLowerCase()) {
      return {
        value: parsed,
        source: key
      };
    }
  }

  return {
    value: fallback,
    source: "default"
  };
}
