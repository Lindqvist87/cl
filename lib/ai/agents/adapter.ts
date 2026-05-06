export type AgentsSdkReadiness = {
  enabled: boolean;
  packageName: "@openai/agents";
  reason: string;
  requiredZodMajor: 4;
  currentIntegration: "requestEditorJson";
};

export function agentsSdkReadiness(): AgentsSdkReadiness {
  return {
    enabled: false,
    packageName: "@openai/agents",
    reason:
      "Agents SDK integration is isolated until the OpenAI SDK and Zod v4 upgrade is verified in this app.",
    requiredZodMajor: 4,
    currentIntegration: "requestEditorJson"
  };
}

