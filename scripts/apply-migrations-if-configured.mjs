import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;

if (process.env.SKIP_PRISMA_MIGRATE === "1") {
  console.log("Skipping Prisma migrations because SKIP_PRISMA_MIGRATE=1.");
  process.exit(0);
}

if (!databaseUrl) {
  console.log("Skipping Prisma migrations because DATABASE_URL is not set.");
  process.exit(0);
}

console.log("Applying Prisma migrations before build.");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env
});

process.exit(result.status ?? 1);
