import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const scriptPath = path.join(repoRoot, "scripts", "safe-env-diagnostics.mjs");

const DIAGNOSTIC_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "ENABLE_INNGEST_WORKER",
  "SHOW_OPERATOR_TOOLS",
  "SKIP_PRISMA_MIGRATE",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_APP_ID",
  "INNGEST_ENV",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "EXTRACTION_MODEL",
  "EXTRACTION_REASONING_EFFORT",
  "AUDIT_MODEL",
  "AUDIT_REASONING_EFFORT",
  "SCENE_ANALYSIS_MODEL",
  "SCENE_ANALYSIS_REASONING_EFFORT",
  "CHAPTER_COMPILER_MODEL",
  "CHAPTER_COMPILER_REASONING_EFFORT",
  "WHOLE_BOOK_COMPILER_MODEL",
  "WHOLE_BOOK_COMPILER_REASONING_EFFORT",
  "CHIEF_EDITOR_MODEL",
  "CHIEF_EDITOR_REASONING_EFFORT",
  "OPENAI_REWRITE_MODEL",
  "REWRITE_REASONING_EFFORT",
  "OPENAI_AUDIT_MODEL",
  "OPENAI_EDITOR_MODEL"
];

test("safe env diagnostics reports database metadata without secrets", () => {
  const result = runDiagnostics({
    DATABASE_URL:
      "postgresql://synthetic_user:synthetic_password@ep-polished-silence-aeasmhkr-pooler.us-east-2.aws.neon.tech/manuscript_main?sslmode=require&channel_binding=require",
    DATABASE_URL_UNPOOLED:
      "postgresql://other_user:other_password@ep-red-pine-aemfupms.us-east-2.aws.neon.tech/manuscript_preview?sslmode=disable",
    OPENAI_API_KEY: "sk-synthetic-secret",
    AUDIT_MODEL: "synthetic-model-name",
    AUDIT_REASONING_EFFORT: "high",
    VERCEL_ENV: "preview",
    SKIP_PRISMA_MIGRATE: "1",
    ENABLE_INNGEST_WORKER: "true"
  });

  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout) as SafeEnvDiagnosticsReport;

  assert.deepEqual(report.databases.DATABASE_URL, {
    present: true,
    host: "ep-polished-silence-aeasmhkr-pooler.us-east-2.aws.neon.tech",
    database: "manuscript_main",
    isPooled: true,
    hasSslModeRequire: true,
    hasChannelBinding: true,
    likelyBranch: "main"
  });
  assert.deepEqual(report.databases.DATABASE_URL_UNPOOLED, {
    present: true,
    host: "ep-red-pine-aemfupms.us-east-2.aws.neon.tech",
    database: "manuscript_preview",
    isPooled: false,
    hasSslModeRequire: false,
    hasChannelBinding: false,
    likelyBranch: "preview/codex/manuscript-compiler-foundation"
  });
  assert.equal(report.presence.OPENAI_API_KEY.present, true);
  assert.equal(report.presence.AUDIT_MODEL.present, true);
  assert.equal(report.presence.OPENAI_EMBEDDING_MODEL.present, false);

  const serializedReport = JSON.stringify(report);
  for (const forbiddenValue of [
    "synthetic_user",
    "synthetic_password",
    "other_user",
    "other_password",
    "postgresql://",
    "sk-synthetic-secret",
    "synthetic-model-name"
  ]) {
    assert.equal(
      serializedReport.includes(forbiddenValue),
      false,
      `${forbiddenValue} should not appear in diagnostics output`
    );
  }

  const warningCodes = report.warnings.map((warning) => warning.code);
  assert.equal(
    warningCodes.includes("DATABASE_URL_PREVIEW_ENV_POINTS_TO_MAIN"),
    true
  );
  assert.equal(
    warningCodes.includes("DATABASE_URL_UNPOOLED_MISSING_SSLMODE_REQUIRE"),
    true
  );
  assert.equal(warningCodes.includes("SKIP_PRISMA_MIGRATE_IN_PREVIEW"), true);
  assert.equal(
    warningCodes.includes("ENABLE_INNGEST_WORKER_TRUE_IN_PREVIEW"),
    true
  );
});

test("safe env diagnostics emits null database metadata when urls are missing", () => {
  const result = runDiagnostics({});

  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout) as SafeEnvDiagnosticsReport;

  assert.deepEqual(report.databases.DATABASE_URL, {
    present: false,
    host: null,
    database: null,
    isPooled: false,
    hasSslModeRequire: false,
    hasChannelBinding: false,
    likelyBranch: "unknown"
  });
  assert.deepEqual(report.databases.DATABASE_URL_UNPOOLED, {
    present: false,
    host: null,
    database: null,
    isPooled: false,
    hasSslModeRequire: false,
    hasChannelBinding: false,
    likelyBranch: "unknown"
  });
  assert.equal(report.presence.VERCEL_ENV.present, false);
  assert.deepEqual(report.warnings, []);
});

function runDiagnostics(envOverrides: Record<string, string>) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: cleanDiagnosticsEnv(envOverrides),
    encoding: "utf8"
  });
}

function cleanDiagnosticsEnv(envOverrides: Record<string, string>) {
  const env = { ...process.env, ...envOverrides };

  for (const key of DIAGNOSTIC_ENV_KEYS) {
    if (!(key in envOverrides)) {
      delete env[key];
    }
  }

  return env;
}

type SafeEnvDiagnosticsReport = {
  databases: Record<
    "DATABASE_URL" | "DATABASE_URL_UNPOOLED",
    {
      present: boolean;
      host: string | null;
      database: string | null;
      isPooled: boolean;
      hasSslModeRequire: boolean;
      hasChannelBinding: boolean;
      likelyBranch: string;
    }
  >;
  presence: Record<string, { present: boolean }>;
  warnings: Array<{ code: string; message: string }>;
};
