export const REQUIRED_VERCEL_ENV_VARS = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "AUDIT_MODEL",
  "AUDIT_REASONING_EFFORT",
  "CHIEF_EDITOR_MODEL",
  "CHIEF_EDITOR_REASONING_EFFORT",
  "OPENAI_EMBEDDING_MODEL",
  "ADMIN_JOB_TOKEN",
  "ENABLE_INNGEST_WORKER",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY"
] as const;

export const OPTIONAL_VERCEL_ENV_VARS = [
  "NEXT_PUBLIC_APP_NAME",
  "INNGEST_APP_ID",
  "INNGEST_SERVE_ORIGIN",
  "MAX_JOBS_PER_INNGEST_RUN",
  "MAX_SECONDS_PER_INNGEST_RUN",
  "OPENAI_AUDIT_MODEL",
  "OPENAI_REWRITE_MODEL",
  "OPENAI_EDITOR_MODEL",
  "OPENAI_INPUT_COST_PER_MILLION_TOKENS_USD",
  "OPENAI_OUTPUT_COST_PER_MILLION_TOKENS_USD",
  "DATABASE_URL_UNPOOLED",
  "SKIP_PRISMA_MIGRATE"
] as const;

export type EnvCheckStatus = "Present" | "Missing";

export type EnvVarCheck = {
  name: string;
  status: EnvCheckStatus;
};

export function getSystemEnvCheck() {
  return {
    required: getEnvVarChecks(REQUIRED_VERCEL_ENV_VARS),
    optional: getEnvVarChecks(OPTIONAL_VERCEL_ENV_VARS)
  };
}

export function getEnvVarChecks(names: readonly string[]): EnvVarCheck[] {
  return names.map((name) => ({
    name,
    status: isEnvVarPresent(name) ? "Present" : "Missing"
  }));
}

function isEnvVarPresent(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0;
}
