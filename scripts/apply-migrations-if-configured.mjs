import { spawnSync } from "node:child_process";

const getNonEmptyEnv = (name) => {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const databaseUrl = getNonEmptyEnv("DATABASE_URL");
const databaseUrlUnpooled = getNonEmptyEnv("DATABASE_URL_UNPOOLED");
const useUnpooledDatabaseUrl = Boolean(databaseUrlUnpooled);
const vercelEnv = getNonEmptyEnv("VERCEL_ENV");
const isVercelBuild = process.env.VERCEL === "1" || Boolean(vercelEnv);

if (process.env.SKIP_PRISMA_MIGRATE === "1") {
  console.log("Skipping Prisma migrations because SKIP_PRISMA_MIGRATE=1.");
  process.exit(0);
}

if (process.env.SKIP_PRISMA_MIGRATE) {
  console.log(
    "Ignoring SKIP_PRISMA_MIGRATE because only SKIP_PRISMA_MIGRATE=1 skips migrations."
  );
}

const migrationDatabaseUrl = databaseUrlUnpooled || databaseUrl;

if (!migrationDatabaseUrl) {
  const missingUrlMessage =
    "DATABASE_URL and DATABASE_URL_UNPOOLED are not set.";

  if (isVercelBuild) {
    console.error(
      [
        `Prisma migrations cannot run during the Vercel ${vercelEnv ?? "build"} build because ${missingUrlMessage}`,
        "Set the Neon preview/production DATABASE_URL, or set DATABASE_URL_UNPOOLED for build-time migrations.",
        "Use SKIP_PRISMA_MIGRATE=1 only when migrations are applied outside this build."
      ].join("\n")
    );
    process.exit(1);
  }

  console.log(
    `Skipping Prisma migrations because ${missingUrlMessage}`
  );
  process.exit(0);
}

if (useUnpooledDatabaseUrl) {
  console.log("Using DATABASE_URL_UNPOOLED for migrations");
} else {
  console.log("Using DATABASE_URL for migrations");
}

console.log("Applying Prisma migrations before build.");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const originalDatabaseUrl = process.env.DATABASE_URL;
const secretsToRedact = [databaseUrl, databaseUrlUnpooled].filter(Boolean);
const redactSecrets = (value = "") =>
  secretsToRedact.reduce(
    (redacted, secret) => redacted.split(secret).join("[redacted]"),
    value
  );

if (useUnpooledDatabaseUrl) {
  process.env.DATABASE_URL = databaseUrlUnpooled;
}

let result;
try {
  result = spawnSync(npx, ["prisma", "migrate", "deploy"], {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32"
  });
} finally {
  if (useUnpooledDatabaseUrl) {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
}

if (result.stdout) {
  process.stdout.write(redactSecrets(result.stdout));
}

if (result.stderr) {
  process.stderr.write(redactSecrets(result.stderr));
}

if (result.error) {
  process.stderr.write(`${redactSecrets(result.error.message)}\n`);
}

const migrationOutput = [result.stdout, result.stderr, result.error?.message]
  .filter(Boolean)
  .join("\n");

if ((result.status ?? 1) !== 0 && migrationOutput.includes("P1001")) {
  console.error(
    [
      "Prisma migrations failed with P1001: unable to reach the database server.",
      "Check that the Neon database is active.",
      "Check the Vercel DATABASE_URL/DATABASE_URL_UNPOOLED environment variables.",
      "Check that the connection string includes sslmode=require."
    ].join("\n")
  );
}

process.exit(result.status ?? 1);
