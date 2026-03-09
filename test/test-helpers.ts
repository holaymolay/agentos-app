import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPostgresPool, runMigrations } from "../src/db/postgres.js";
import { createInMemoryRuntime, createPostgresRuntime, type AgentOsRuntime } from "../src/bootstrap.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/web/create-server.js";

let preparedDatabaseUrl: string | null = null;
let preparePromise: Promise<void> | null = null;

export async function createTestRuntime(): Promise<AgentOsRuntime> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-test-"));
  return createInMemoryRuntime({
    dataDir,
    artifactsDir: path.join(dataDir, "artifacts"),
    ownerPassword: "dev-test-password",
    cookieSecret: "dev-test-cookie-secret-123456",
    projectionLagThresholdMs: 1,
  });
}

async function resetPostgresDatabase(databaseUrl: string): Promise<void> {
  const pool = createPostgresPool(databaseUrl);
  try {
    await pool.query(`
      TRUNCATE TABLE
        projection_watermarks,
        overview_health_view,
        approval_queue_view,
        mission_summary_view,
        user_preferences,
        conversation_messages,
        skill_versions,
        events,
        artifacts,
        approval_requests,
        mission_steps,
        missions
      RESTART IDENTITY
    `);
  } finally {
    await pool.end();
  }
}

async function ensurePostgresPrepared(databaseUrl: string): Promise<void> {
  if (preparedDatabaseUrl === databaseUrl && preparePromise) {
    await preparePromise;
    return;
  }
  preparedDatabaseUrl = databaseUrl;
  preparePromise = runMigrations(databaseUrl);
  await preparePromise;
}

export async function createPostgresTestRuntime(): Promise<AgentOsRuntime> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Postgres-backed tests");
  }
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-pg-test-"));
  const base = loadConfig({
    ...process.env,
    DATABASE_URL: databaseUrl,
    AGENTOS_DATA_DIR: dataDir,
    AGENTOS_OWNER_PASSWORD: "dev-test-password",
    AGENTOS_COOKIE_SECRET: "dev-test-cookie-secret-123456",
    AGENTOS_PROJECTION_LAG_THRESHOLD_MS: "1",
  });
  await ensurePostgresPrepared(databaseUrl);
  await resetPostgresDatabase(databaseUrl);

  const runtimePool = createPostgresPool(databaseUrl);
  return createPostgresRuntime(
    {
      ...base,
      dataDir,
      artifactsDir: path.join(dataDir, "artifacts"),
      projectionLagThresholdMs: 1,
    },
    runtimePool,
  );
}

export async function createTestServer(runtime: AgentOsRuntime) {
  return createServer(runtime);
}

export async function createHealthcheckMission(runtime: AgentOsRuntime, missionInput?: Record<string, unknown>): Promise<string> {
  const result = await runtime.assistantService.submitUserTurn({
    content: "Run a healthcheck on the runtime.",
    requestedBy: "owner",
    interfaceChannel: "web",
    missionInput,
  });
  if (!result.missionId) {
    throw new Error("Expected mission id");
  }
  return result.missionId;
}

export async function processWorkerUntilIdle(runtime: AgentOsRuntime, maxIterations: number = 10): Promise<void> {
  for (let index = 0; index < maxIterations; index += 1) {
    const claimed = await runtime.worker.processNextStep();
    if (!claimed) {
      return;
    }
  }
  throw new Error("Worker did not go idle within expected iterations");
}

export async function processUntilApproval(runtime: AgentOsRuntime, missionId: string): Promise<string> {
  for (let index = 0; index < 10; index += 1) {
    await runtime.worker.processNextStep();
    const approvals = await runtime.kernel.listApprovalQueue();
    if (approvals.length > 0) {
      return approvals[0]!.approvalRequestId;
    }
    const detail = await runtime.kernel.getMissionDetail(missionId);
    if (detail?.mission.status === "SUCCEEDED") {
      throw new Error("Mission completed before approval was reached");
    }
  }
  throw new Error("Approval gate was not reached");
}
