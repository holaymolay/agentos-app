import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const trackedEnvKeys = [
  "DATABASE_URL",
  "AGENTOS_OWNER_PASSWORD",
  "AGENTOS_COOKIE_SECRET",
  "AGENTOS_BRIDGE_TOKEN",
  "AGENTOS_PUBLIC_BASE_URL",
  "AGENTOS_OPENCLAW_ADMIN_URL",
  "AGENTOS_OPENCLAW_ADMIN_TOKEN",
  "AGENTOS_OPENCLAW_DASHBOARD_URL",
  "AGENTOS_HEARTBEAT_INTERVAL_MS",
  "AGENTOS_LEASE_DURATION_MS",
  "AGENTOS_PROJECTION_LAG_THRESHOLD_MS",
  "AGENTOS_PROJECTION_NAME",
  "AGENTOS_DATA_DIR",
  "AGENTOS_ASSISTANT_ID",
] as const;

const originalCwd = process.cwd();
const originalEnv = new Map(trackedEnvKeys.map((key) => [key, process.env[key]]));

function resetTrackedEnv(): void {
  for (const key of trackedEnvKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

afterEach(() => {
  process.chdir(originalCwd);
  resetTrackedEnv();
});

describe("loadConfig", () => {
  it("loads missing values from a local .env file", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-config-"));
    await fs.writeFile(
      path.join(tempDir, ".env"),
      [
        "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentos",
        "AGENTOS_OWNER_PASSWORD=dotenv-password",
        "AGENTOS_COOKIE_SECRET=dotenv-cookie-secret-123456",
        "AGENTOS_OPENCLAW_ADMIN_URL=http://host.docker.internal:19401",
        "AGENTOS_OPENCLAW_ADMIN_TOKEN=dotenv-openclaw-admin-token",
        "AGENTOS_OPENCLAW_DASHBOARD_URL=https://roger.example.com",
        "AGENTOS_DATA_DIR=./dotenv-data",
      ].join("\n"),
    );

    resetTrackedEnv();
    delete process.env.DATABASE_URL;
    delete process.env.AGENTOS_OWNER_PASSWORD;
    delete process.env.AGENTOS_COOKIE_SECRET;
    delete process.env.AGENTOS_OPENCLAW_ADMIN_URL;
    delete process.env.AGENTOS_OPENCLAW_ADMIN_TOKEN;
    delete process.env.AGENTOS_OPENCLAW_DASHBOARD_URL;
    delete process.env.AGENTOS_DATA_DIR;
    process.chdir(tempDir);

    const config = loadConfig();

    expect(config.databaseUrl).toBe("postgres://postgres:postgres@127.0.0.1:5432/agentos");
    expect(config.ownerPassword).toBe("dotenv-password");
    expect(config.cookieSecret).toBe("dotenv-cookie-secret-123456");
    expect(config.openClawAdminUrl).toBe("http://host.docker.internal:19401");
    expect(config.openClawAdminToken).toBe("dotenv-openclaw-admin-token");
    expect(config.openClawDashboardUrl).toBe("https://roger.example.com");
    expect(config.dataDir).toBe("./dotenv-data");
    expect(config.artifactsDir).toBe(path.join("./dotenv-data", "artifacts"));
  });

  it("does not let .env override values already present in the process environment", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-config-"));
    await fs.writeFile(
      path.join(tempDir, ".env"),
      [
        "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/from-dotenv",
        "AGENTOS_OWNER_PASSWORD=dotenv-password",
        "AGENTOS_COOKIE_SECRET=dotenv-cookie-secret-123456",
      ].join("\n"),
    );

    resetTrackedEnv();
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/from-env";
    process.env.AGENTOS_OWNER_PASSWORD = "env-password";
    process.env.AGENTOS_COOKIE_SECRET = "env-cookie-secret-123456";
    process.chdir(tempDir);

    const config = loadConfig();

    expect(config.databaseUrl).toBe("postgres://postgres:postgres@127.0.0.1:5432/from-env");
    expect(config.ownerPassword).toBe("env-password");
    expect(config.cookieSecret).toBe("env-cookie-secret-123456");
  });
});
