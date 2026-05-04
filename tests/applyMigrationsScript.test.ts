import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const scriptPath = path.join(
  repoRoot,
  "scripts",
  "apply-migrations-if-configured.mjs"
);
const pathEnvKey =
  Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
  "PATH";

test("migration helper uses DATABASE_URL_UNPOOLED for migrate deploy", () => {
  const fakeNpx = createFakeNpx();

  try {
    const result = runMigrationScript({
      DATABASE_URL: "postgresql://pooled.example/db",
      DATABASE_URL_UNPOOLED: "postgresql://unpooled.example/db",
      FAKE_NPX_CAPTURE: fakeNpx.capturePath,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      [pathEnvKey]: fakeNpx.pathValue
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Using DATABASE_URL_UNPOOLED for migrations/);
    assert.match(result.stdout, /Applying Prisma migrations before build/);

    const capture = readCapture(fakeNpx.capturePath);
    assert.deepEqual(capture.argv, ["prisma", "migrate", "deploy"]);
    assert.equal(capture.databaseUrl, "postgresql://unpooled.example/db");
  } finally {
    fakeNpx.cleanup();
  }
});

test("migration helper fails Vercel builds when database URLs are missing", () => {
  const result = runMigrationScript({
    VERCEL: "1",
    VERCEL_ENV: "preview"
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Prisma migrations cannot run during the Vercel preview build/
  );
  assert.match(
    result.stderr,
    /DATABASE_URL and DATABASE_URL_UNPOOLED are not set/
  );
});

test("migration helper skips only when SKIP_PRISMA_MIGRATE is exactly 1", () => {
  const fakeNpx = createFakeNpx();

  try {
    const result = runMigrationScript({
      DATABASE_URL: "postgresql://pooled.example/db",
      FAKE_NPX_CAPTURE: fakeNpx.capturePath,
      SKIP_PRISMA_MIGRATE: "true",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      [pathEnvKey]: fakeNpx.pathValue
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /only SKIP_PRISMA_MIGRATE=1 skips migrations/
    );
    assert.deepEqual(readCapture(fakeNpx.capturePath).argv, [
      "prisma",
      "migrate",
      "deploy"
    ]);
  } finally {
    fakeNpx.cleanup();
  }
});

test("migration helper allows explicit Vercel migration skip", () => {
  const result = runMigrationScript({
    SKIP_PRISMA_MIGRATE: "1",
    VERCEL: "1",
    VERCEL_ENV: "preview"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Skipping Prisma migrations because SKIP_PRISMA_MIGRATE=1/
  );
});

function runMigrationScript(envOverrides: Record<string, string>) {
  const env = cleanMigrationEnv(envOverrides);

  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env,
    encoding: "utf8"
  });
}

function cleanMigrationEnv(envOverrides: Record<string, string>) {
  const env = { ...process.env, ...envOverrides };

  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "SKIP_PRISMA_MIGRATE",
    "VERCEL",
    "VERCEL_ENV",
    "FAKE_NPX_CAPTURE",
    "FAKE_NPX_EXIT_CODE"
  ]) {
    if (!(key in envOverrides)) {
      delete env[key];
    }
  }

  return env;
}

function createFakeNpx() {
  const directory = mkdtempSync(path.join(tmpdir(), "fake-npx-"));
  const capturePath = path.join(directory, "capture.json");
  const fakeNpxPath = path.join(directory, "fake-npx.mjs");
  writeFileSync(
    fakeNpxPath,
    [
      'import { writeFileSync } from "node:fs";',
      "writeFileSync(",
      "  process.env.FAKE_NPX_CAPTURE,",
      "  JSON.stringify({",
      "    argv: process.argv.slice(2),",
      "    databaseUrl: process.env.DATABASE_URL,",
      "    databaseUrlUnpooled: process.env.DATABASE_URL_UNPOOLED",
      "  })",
      ");",
      'process.stdout.write("fake migrate ok\\n");',
      'process.exit(Number(process.env.FAKE_NPX_EXIT_CODE ?? "0"));'
    ].join("\n")
  );

  if (process.platform === "win32") {
    writeFileSync(
      path.join(directory, "npx.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-npx.mjs" %*\r\n`
    );
  } else {
    const npxPath = path.join(directory, "npx");
    writeFileSync(
      npxPath,
      `#!/bin/sh\n"${process.execPath}" "$(dirname "$0")/fake-npx.mjs" "$@"\n`
    );
    chmodSync(npxPath, 0o755);
  }

  return {
    capturePath,
    pathValue: `${directory}${path.delimiter}${process.env[pathEnvKey] ?? ""}`,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

function readCapture(capturePath: string) {
  return JSON.parse(readFileSync(capturePath, "utf8")) as {
    argv: string[];
    databaseUrl?: string;
    databaseUrlUnpooled?: string;
  };
}
