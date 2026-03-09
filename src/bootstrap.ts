import fs from "node:fs/promises";
import type { Pool } from "pg";
import { loadConfig } from "./config.js";
import { InMemoryPersistence } from "./domain/in-memory-persistence.js";
import { AgentOsKernel } from "./domain/kernel.js";
import { createPostgresPool, runMigrations, PostgresPersistence } from "./db/postgres.js";
import { AssistantService } from "./services/assistant-service.js";
import { AuthService } from "./services/auth-service.js";
import { LocalExecutionAdapter } from "./worker/local-execution-adapter.js";
import { AgentWorker } from "./worker/agent-worker.js";
import type { AppConfig } from "./shared/types.js";

export interface AgentOsRuntime {
  config: AppConfig;
  kernel: AgentOsKernel;
  assistantService: AssistantService;
  authService: AuthService;
  worker: AgentWorker;
  shutdown(): Promise<void>;
}

export async function createInMemoryRuntime(overrides: Partial<AppConfig> = {}): Promise<AgentOsRuntime> {
  const config = { ...loadConfig({}), ...overrides };
  await fs.mkdir(config.artifactsDir, { recursive: true });
  const persistence = new InMemoryPersistence();
  const kernel = new AgentOsKernel(persistence, config);
  await kernel.seedDefaults();
  return {
    config,
    kernel,
    assistantService: new AssistantService(kernel),
    authService: new AuthService(config.ownerPassword),
    worker: new AgentWorker(kernel, new LocalExecutionAdapter(), config),
    shutdown: async () => {},
  };
}

export async function createPostgresRuntime(config: AppConfig, pool?: Pool): Promise<AgentOsRuntime> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for Postgres runtime startup");
  }
  await fs.mkdir(config.artifactsDir, { recursive: true });
  await runMigrations(config.databaseUrl);
  const runtimePool = pool ?? createPostgresPool(config.databaseUrl);
  const persistence = new PostgresPersistence(runtimePool);
  const kernel = new AgentOsKernel(persistence, config);
  await kernel.seedDefaults();
  return {
    config,
    kernel,
    assistantService: new AssistantService(kernel),
    authService: new AuthService(config.ownerPassword),
    worker: new AgentWorker(kernel, new LocalExecutionAdapter(), config),
    shutdown: async () => {
      await runtimePool.end();
    },
  };
}

export async function createRuntimeFromEnv(): Promise<AgentOsRuntime> {
  const config = loadConfig();
  return createPostgresRuntime(config);
}
