import { env } from "@/lib/env";
import type { ModelRole, ReasoningEffort } from "@/lib/ai/modelConfig";

export type EditorServiceTier = "auto" | "default" | "flex";

export type EditorRequestBudget = {
  maxOutputTokens?: number;
  serviceTier?: EditorServiceTier;
  metadata: {
    role?: ModelRole;
    reasoningEffort?: ReasoningEffort;
    costControl: "interactive" | "background" | "final";
    batchEligible: boolean;
    flexEligible: boolean;
  };
};

const BACKGROUND_ROLES = new Set<ModelRole>([
  "extraction",
  "sceneAnalysis",
  "chapterCompiler",
  "wholeBookCompiler"
]);
const FINAL_ROLES = new Set<ModelRole>(["chiefEditor", "rewrite"]);

export function requestBudgetForRole(input: {
  role?: ModelRole;
  reasoningEffort?: ReasoningEffort;
  serviceTier?: EditorServiceTier;
  maxOutputTokens?: number;
}): EditorRequestBudget {
  const costControl = input.role
    ? FINAL_ROLES.has(input.role)
      ? "final"
      : BACKGROUND_ROLES.has(input.role)
        ? "background"
        : "interactive"
    : "interactive";
  const flexEligible = costControl === "background";
  const serviceTier =
    input.serviceTier ??
    (flexEligible && env.OPENAI_BACKGROUND_SERVICE_TIER === "flex"
      ? "flex"
      : undefined);

  return {
    maxOutputTokens: input.maxOutputTokens,
    serviceTier,
    metadata: {
      role: input.role,
      reasoningEffort: input.reasoningEffort,
      costControl,
      batchEligible: flexEligible,
      flexEligible
    }
  };
}

