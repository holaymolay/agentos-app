import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./shared/types.js";

const envSchema = z.object({
  DATABASE_URL: z.string().url().nullable().optional(),
  AGENTOS_OWNER_PASSWORD: z.string().min(8).default("change-me-dev-password"),
  AGENTOS_COOKIE_SECRET: z.string().min(16).default("change-me-dev-cookie-secret"),
  AGENTOS_BRIDGE_TOKEN: z.string().min(16).nullable().optional(),
  AGENTOS_PUBLIC_BASE_URL: z.string().url().nullable().optional(),
  AGENTOS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  AGENTOS_LEASE_DURATION_MS: z.coerce.number().int().positive().default(8_000),
  AGENTOS_PROJECTION_LAG_THRESHOLD_MS: z.coerce.number().int().positive().default(5_000),
  AGENTOS_PROJECTION_NAME: z.string().min(1).default("mission-control"),
  AGENTOS_DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  AGENTOS_ASSISTANT_ID: z.string().min(1).default("assistant"),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse({
    DATABASE_URL: env.DATABASE_URL ?? null,
    AGENTOS_OWNER_PASSWORD: env.AGENTOS_OWNER_PASSWORD,
    AGENTOS_COOKIE_SECRET: env.AGENTOS_COOKIE_SECRET,
    AGENTOS_BRIDGE_TOKEN: env.AGENTOS_BRIDGE_TOKEN ?? null,
    AGENTOS_PUBLIC_BASE_URL: env.AGENTOS_PUBLIC_BASE_URL ?? null,
    AGENTOS_HEARTBEAT_INTERVAL_MS: env.AGENTOS_HEARTBEAT_INTERVAL_MS,
    AGENTOS_LEASE_DURATION_MS: env.AGENTOS_LEASE_DURATION_MS,
    AGENTOS_PROJECTION_LAG_THRESHOLD_MS: env.AGENTOS_PROJECTION_LAG_THRESHOLD_MS,
    AGENTOS_PROJECTION_NAME: env.AGENTOS_PROJECTION_NAME,
    AGENTOS_DATA_DIR: env.AGENTOS_DATA_DIR,
    AGENTOS_ASSISTANT_ID: env.AGENTOS_ASSISTANT_ID,
  });

  return {
    databaseUrl: parsed.DATABASE_URL ?? null,
    ownerPassword: parsed.AGENTOS_OWNER_PASSWORD,
    cookieSecret: parsed.AGENTOS_COOKIE_SECRET,
    bridgeToken: parsed.AGENTOS_BRIDGE_TOKEN ?? null,
    publicBaseUrl: parsed.AGENTOS_PUBLIC_BASE_URL ?? null,
    heartbeatIntervalMs: parsed.AGENTOS_HEARTBEAT_INTERVAL_MS,
    leaseDurationMs: parsed.AGENTOS_LEASE_DURATION_MS,
    projectionLagThresholdMs: parsed.AGENTOS_PROJECTION_LAG_THRESHOLD_MS,
    projectionName: parsed.AGENTOS_PROJECTION_NAME,
    dataDir: parsed.AGENTOS_DATA_DIR,
    artifactsDir: path.join(parsed.AGENTOS_DATA_DIR, "artifacts"),
    assistantId: parsed.AGENTOS_ASSISTANT_ID,
  };
}
