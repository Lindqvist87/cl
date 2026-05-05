const PREVIEW_BRANCH = "preview/codex/manuscript-compiler-foundation";
const MAIN_BRANCH = "main";

const DATABASE_ENV_VARS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"];

const PRESENCE_ENV_VARS = [
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

const getEnvValue = (name) => {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const isPresent = (name) => getEnvValue(name) !== undefined;

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const getSearchParam = (url, expectedName) => {
  const normalizedExpectedName = expectedName.toLowerCase();
  for (const [name, value] of url.searchParams.entries()) {
    if (name.toLowerCase() === normalizedExpectedName) {
      return value;
    }
  }

  return undefined;
};

const hasSearchParam = (url, expectedName) => {
  const normalizedExpectedName = expectedName.toLowerCase();
  for (const name of url.searchParams.keys()) {
    if (name.toLowerCase() === normalizedExpectedName) {
      return true;
    }
  }

  return false;
};

const likelyBranchForHost = (host) => {
  if (host.includes("ep-red-pine-aemfupms")) {
    return PREVIEW_BRANCH;
  }

  if (host.includes("ep-polished-silence-aeasmhkr")) {
    return MAIN_BRANCH;
  }

  return "unknown";
};

const emptyDatabaseDiagnostics = (present) => ({
  present,
  host: null,
  database: null,
  isPooled: false,
  hasSslModeRequire: false,
  hasChannelBinding: false,
  likelyBranch: "unknown"
});

const inspectDatabaseUrl = (name) => {
  const value = getEnvValue(name);
  if (!value) {
    return emptyDatabaseDiagnostics(false);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return emptyDatabaseDiagnostics(true);
  }

  const host = url.hostname.toLowerCase();
  const databasePath = url.pathname.replace(/^\/+/, "");
  const database = databasePath.length > 0 ? safeDecode(databasePath) : null;
  const sslMode = getSearchParam(url, "sslmode");

  return {
    present: true,
    host,
    database,
    isPooled: host.includes("-pooler"),
    hasSslModeRequire:
      typeof sslMode === "string" && sslMode.toLowerCase() === "require",
    hasChannelBinding: hasSearchParam(url, "channel_binding"),
    likelyBranch: likelyBranchForHost(host)
  };
};

const presenceDiagnostics = Object.fromEntries(
  PRESENCE_ENV_VARS.map((name) => [name, { present: isPresent(name) }])
);

const databaseDiagnostics = Object.fromEntries(
  DATABASE_ENV_VARS.map((name) => [name, inspectDatabaseUrl(name)])
);

const warnings = [];

const addWarning = (code, message) => {
  warnings.push({ code, message });
};

const databaseUrl = databaseDiagnostics.DATABASE_URL;
const databaseUrlUnpooled = databaseDiagnostics.DATABASE_URL_UNPOOLED;

if (databaseUrlUnpooled.present && databaseUrlUnpooled.isPooled) {
  addWarning(
    "DATABASE_URL_UNPOOLED_IS_POOLED",
    'DATABASE_URL_UNPOOLED contains "-pooler".'
  );
}

if (databaseUrl.present && databaseUrl.host && !databaseUrl.isPooled) {
  addWarning(
    "DATABASE_URL_NOT_POOLED",
    'DATABASE_URL does not contain "-pooler".'
  );
}

for (const [name, diagnostics] of Object.entries(databaseDiagnostics)) {
  if (diagnostics.present && diagnostics.host && !diagnostics.hasSslModeRequire) {
    addWarning(`${name}_MISSING_SSLMODE_REQUIRE`, `${name} missing sslmode=require.`);
  }
}

const vercelEnv = getEnvValue("VERCEL_ENV")?.toLowerCase();
for (const [name, diagnostics] of Object.entries(databaseDiagnostics)) {
  if (vercelEnv === "preview" && diagnostics.likelyBranch === MAIN_BRANCH) {
    addWarning(
      `${name}_PREVIEW_ENV_POINTS_TO_MAIN`,
      `VERCEL_ENV=preview but ${name} host points to main.`
    );
  }

  if (vercelEnv === "production" && diagnostics.likelyBranch === PREVIEW_BRANCH) {
    addWarning(
      `${name}_PRODUCTION_ENV_POINTS_TO_PREVIEW`,
      `VERCEL_ENV=production but ${name} host points to preview.`
    );
  }
}

const skipPrismaMigrate = getEnvValue("SKIP_PRISMA_MIGRATE");
const enableInngestWorker = getEnvValue("ENABLE_INNGEST_WORKER")?.toLowerCase();

if (vercelEnv === "preview" && skipPrismaMigrate === "1") {
  addWarning("SKIP_PRISMA_MIGRATE_IN_PREVIEW", "SKIP_PRISMA_MIGRATE=1 in preview.");
}

if (vercelEnv === "preview" && enableInngestWorker === "true") {
  addWarning(
    "ENABLE_INNGEST_WORKER_TRUE_IN_PREVIEW",
    "ENABLE_INNGEST_WORKER=true in preview."
  );
}

if (vercelEnv === "production" && enableInngestWorker === "false") {
  addWarning(
    "ENABLE_INNGEST_WORKER_FALSE_IN_PRODUCTION",
    "ENABLE_INNGEST_WORKER=false in production."
  );
}

const report = {
  databases: databaseDiagnostics,
  presence: presenceDiagnostics,
  warnings
};

console.log(JSON.stringify(report, null, 2));
