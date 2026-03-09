import fs from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type {
  ApprovalQueueItem,
  ApprovalRequest,
  Artifact,
  ConversationMessage,
  KernelEvent,
  Mission,
  MissionStep,
  MissionSummary,
  OverviewHealth,
  ProjectionWatermark,
  SkillVersion,
  UserPreference,
} from "../shared/types.js";
import type { KernelPersistence, NewKernelEvent, PersistenceTx } from "../domain/persistence.js";

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function mapDataRow<T>(row: { data: T }): T {
  return row.data;
}

async function withPgClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function readMigrationSql(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "src/db/migrations/001_initial.sql"),
    path.resolve(process.cwd(), "dist/src/db/migrations/001_initial.sql"),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error("Could not locate 001_initial.sql in src/ or dist/ migration paths");
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const sql = await readMigrationSql();
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

export class PostgresPersistence implements KernelPersistence {
  constructor(private readonly pool: Pool) {}

  async runInTransaction<T>(fn: (tx: PersistenceTx) => Promise<T>): Promise<T> {
    return withPgClient(this.pool, async (client) => {
      await client.query("BEGIN");
      try {
        const tx: PersistenceTx = {
          saveMission: async (mission) => {
            await client.query(
              `INSERT INTO missions (mission_id, status, skill_version_id, risk_tier, created_at, updated_at, terminal_at, data)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
               ON CONFLICT (mission_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 skill_version_id = EXCLUDED.skill_version_id,
                 risk_tier = EXCLUDED.risk_tier,
                 updated_at = EXCLUDED.updated_at,
                 terminal_at = EXCLUDED.terminal_at,
                 data = EXCLUDED.data`,
              [mission.missionId, mission.status, mission.skillVersionId, mission.riskTier, mission.createdAt, mission.updatedAt, mission.terminalAt, JSON.stringify(mission)],
            );
          },
          saveMissionStep: async (step) => {
            await client.query(
              `INSERT INTO mission_steps (step_id, mission_id, step_key, status, available_at, lease_expires_at, updated_at, data)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
               ON CONFLICT (step_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 available_at = EXCLUDED.available_at,
                 lease_expires_at = EXCLUDED.lease_expires_at,
                 updated_at = EXCLUDED.updated_at,
                 data = EXCLUDED.data`,
              [step.stepId, step.missionId, step.stepKey, step.status, step.availableAt, step.leaseExpiresAt, step.updatedAt, JSON.stringify(step)],
            );
          },
          saveApprovalRequest: async (approval) => {
            await client.query(
              `INSERT INTO approval_requests (approval_request_id, mission_id, step_id, status, requested_at, resolved_at, data)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
               ON CONFLICT (approval_request_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 resolved_at = EXCLUDED.resolved_at,
                 data = EXCLUDED.data`,
              [approval.approvalRequestId, approval.missionId, approval.stepId, approval.status, approval.requestedAt, approval.resolvedAt, JSON.stringify(approval)],
            );
          },
          saveArtifact: async (artifact) => {
            await client.query(
              `INSERT INTO artifacts (artifact_id, mission_id, step_id, promoted, created_at, data)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               ON CONFLICT (artifact_id) DO UPDATE SET
                 promoted = EXCLUDED.promoted,
                 data = EXCLUDED.data`,
              [artifact.artifactId, artifact.missionId, artifact.stepId, artifact.promoted, artifact.createdAt, JSON.stringify(artifact)],
            );
          },
          saveSkillVersion: async (skillVersion) => {
            await client.query(
              `INSERT INTO skill_versions (skill_version_id, skill_id, version, status, lane_mode, data)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               ON CONFLICT (skill_version_id) DO UPDATE SET
                 status = EXCLUDED.status,
                 lane_mode = EXCLUDED.lane_mode,
                 data = EXCLUDED.data`,
              [skillVersion.skillVersionId, skillVersion.skillId, skillVersion.version, skillVersion.status, skillVersion.laneMode, JSON.stringify(skillVersion)],
            );
          },
          saveConversationMessage: async (message) => {
            await client.query(
              `INSERT INTO conversation_messages (message_id, created_at, data)
               VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (message_id) DO UPDATE SET data = EXCLUDED.data`,
              [message.messageId, message.createdAt, JSON.stringify(message)],
            );
          },
          saveUserPreference: async (preference) => {
            await client.query(
              `INSERT INTO user_preferences (preference_key, updated_at, data)
               VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (preference_key) DO UPDATE SET updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
              [preference.preferenceKey, preference.updatedAt, JSON.stringify(preference)],
            );
          },
          appendEvent: async (event) => {
            const result = await client.query(
              `INSERT INTO events (event_id, mission_id, step_id, event_type, actor_type, actor_id, plane, idempotency_key, ts, payload_json)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
               RETURNING sequence`,
              [event.eventId, event.missionId, event.stepId, event.eventType, event.actorType, event.actorId, event.plane, event.idempotencyKey, event.ts, JSON.stringify(event.payloadJson)],
            );
            return { ...event, sequence: Number(result.rows[0]?.sequence ?? 0) };
          },
          hasEventIdempotencyKey: async (idempotencyKey) => {
            const result = await client.query(`SELECT 1 FROM events WHERE idempotency_key = $1 LIMIT 1`, [idempotencyKey]);
            return (result.rowCount ?? 0) > 0;
          },
          getMission: async (missionId) => {
            const result = await client.query(`SELECT data FROM missions WHERE mission_id = $1`, [missionId]);
            return result.rows[0] ? mapDataRow<Mission>(result.rows[0]) : null;
          },
          getMissionForUpdate: async (missionId) => {
            const result = await client.query(`SELECT data FROM missions WHERE mission_id = $1 FOR UPDATE`, [missionId]);
            return result.rows[0] ? mapDataRow<Mission>(result.rows[0]) : null;
          },
          listMissions: async () => {
            const result = await client.query(`SELECT data FROM missions ORDER BY updated_at DESC`);
            return result.rows.map((row) => mapDataRow<Mission>(row));
          },
          getMissionStep: async (stepId) => {
            const result = await client.query(`SELECT data FROM mission_steps WHERE step_id = $1`, [stepId]);
            return result.rows[0] ? mapDataRow<MissionStep>(result.rows[0]) : null;
          },
          getMissionStepForUpdate: async (stepId) => {
            const result = await client.query(`SELECT data FROM mission_steps WHERE step_id = $1 FOR UPDATE`, [stepId]);
            return result.rows[0] ? mapDataRow<MissionStep>(result.rows[0]) : null;
          },
          getMissionStepByKey: async (missionId, stepKey) => {
            const result = await client.query(`SELECT data FROM mission_steps WHERE mission_id = $1 AND step_key = $2 LIMIT 1`, [missionId, stepKey]);
            return result.rows[0] ? mapDataRow<MissionStep>(result.rows[0]) : null;
          },
          listMissionSteps: async (missionId) => {
            const result = await client.query(`SELECT data FROM mission_steps WHERE mission_id = $1 ORDER BY updated_at ASC`, [missionId]);
            return result.rows.map((row) => mapDataRow<MissionStep>(row));
          },
          findReadyStepForUpdate: async (nowIso) => {
            const result = await client.query(
              `SELECT data
               FROM mission_steps
               WHERE status = 'READY' AND available_at <= $1
               ORDER BY available_at ASC
               FOR UPDATE SKIP LOCKED
               LIMIT 1`,
              [nowIso],
            );
            return result.rows[0] ? mapDataRow<MissionStep>(result.rows[0]) : null;
          },
          listExpiredRunningStepsForUpdate: async (nowIso) => {
            const result = await client.query(
              `SELECT data
               FROM mission_steps
               WHERE status = 'RUNNING'
                 AND lease_expires_at IS NOT NULL
                 AND lease_expires_at <= $1
               ORDER BY lease_expires_at ASC
               FOR UPDATE SKIP LOCKED`,
              [nowIso],
            );
            return result.rows.map((row) => mapDataRow<MissionStep>(row));
          },
          getApprovalRequest: async (approvalRequestId) => {
            const result = await client.query(`SELECT data FROM approval_requests WHERE approval_request_id = $1`, [approvalRequestId]);
            return result.rows[0] ? mapDataRow<ApprovalRequest>(result.rows[0]) : null;
          },
          getApprovalRequestForUpdate: async (approvalRequestId) => {
            const result = await client.query(`SELECT data FROM approval_requests WHERE approval_request_id = $1 FOR UPDATE`, [approvalRequestId]);
            return result.rows[0] ? mapDataRow<ApprovalRequest>(result.rows[0]) : null;
          },
          listApprovalRequests: async (missionId) => {
            const result = missionId
              ? await client.query(`SELECT data FROM approval_requests WHERE mission_id = $1 ORDER BY requested_at DESC`, [missionId])
              : await client.query(`SELECT data FROM approval_requests ORDER BY requested_at DESC`);
            return result.rows.map((row) => mapDataRow<ApprovalRequest>(row));
          },
          listPendingApprovalRequests: async () => {
            const result = await client.query(`SELECT data FROM approval_requests WHERE status = 'PENDING' ORDER BY requested_at DESC`);
            return result.rows.map((row) => mapDataRow<ApprovalRequest>(row));
          },
          listArtifacts: async (missionId) => {
            const result = await client.query(`SELECT data FROM artifacts WHERE mission_id = $1 ORDER BY created_at DESC`, [missionId]);
            return result.rows.map((row) => mapDataRow<Artifact>(row));
          },
          getArtifact: async (artifactId) => {
            const result = await client.query(`SELECT data FROM artifacts WHERE artifact_id = $1`, [artifactId]);
            return result.rows[0] ? mapDataRow<Artifact>(result.rows[0]) : null;
          },
          listEvents: async (missionId) => {
            const result = missionId
              ? await client.query(`SELECT sequence, event_id, mission_id, step_id, event_type, actor_type, actor_id, plane, idempotency_key, ts, payload_json FROM events WHERE mission_id = $1 ORDER BY sequence ASC`, [missionId])
              : await client.query(`SELECT sequence, event_id, mission_id, step_id, event_type, actor_type, actor_id, plane, idempotency_key, ts, payload_json FROM events ORDER BY sequence ASC`);
            return result.rows.map((row) => ({
              sequence: Number(row.sequence),
              eventId: row.event_id,
              missionId: row.mission_id,
              stepId: row.step_id,
              eventType: row.event_type,
              actorType: row.actor_type,
              actorId: row.actor_id,
              plane: row.plane,
              idempotencyKey: row.idempotency_key,
              ts: toIso(row.ts),
              payloadJson: row.payload_json,
            } satisfies KernelEvent));
          },
          listEventsSince: async (lastSequence) => {
            const result = await client.query(
              `SELECT sequence, event_id, mission_id, step_id, event_type, actor_type, actor_id, plane, idempotency_key, ts, payload_json FROM events WHERE sequence > $1 ORDER BY sequence ASC`,
              [lastSequence],
            );
            return result.rows.map((row) => ({
              sequence: Number(row.sequence),
              eventId: row.event_id,
              missionId: row.mission_id,
              stepId: row.step_id,
              eventType: row.event_type,
              actorType: row.actor_type,
              actorId: row.actor_id,
              plane: row.plane,
              idempotencyKey: row.idempotency_key,
              ts: toIso(row.ts),
              payloadJson: row.payload_json,
            } satisfies KernelEvent));
          },
          getMaxEventSequence: async () => {
            const result = await client.query(`SELECT COALESCE(MAX(sequence), 0) AS max FROM events`);
            return Number(result.rows[0]?.max ?? 0);
          },
          getSkillVersion: async (skillVersionId) => {
            const result = await client.query(`SELECT data FROM skill_versions WHERE skill_version_id = $1`, [skillVersionId]);
            return result.rows[0] ? mapDataRow<SkillVersion>(result.rows[0]) : null;
          },
          getSkillVersionBySkillId: async (skillId) => {
            const result = await client.query(`SELECT data FROM skill_versions WHERE skill_id = $1 AND status = 'active' ORDER BY version DESC LIMIT 1`, [skillId]);
            return result.rows[0] ? mapDataRow<SkillVersion>(result.rows[0]) : null;
          },
          getRecentConversationMessages: async (limit) => {
            const result = await client.query(`SELECT data FROM conversation_messages ORDER BY created_at DESC LIMIT $1`, [limit]);
            return result.rows.map((row) => mapDataRow<ConversationMessage>(row)).toReversed();
          },
          listUserPreferences: async () => {
            const result = await client.query(`SELECT data FROM user_preferences ORDER BY preference_key ASC`);
            return result.rows.map((row) => mapDataRow<UserPreference>(row));
          },
          replaceMissionSummaries: async (items) => {
            await client.query(`DELETE FROM mission_summary_view`);
            for (const item of items) {
              await client.query(
                `INSERT INTO mission_summary_view (mission_id, status, operator_action_needed, updated_at, data)
                 VALUES ($1, $2, $3, $4, $5::jsonb)`,
                [item.missionId, item.status, item.operatorActionNeeded, item.lastUpdatedAt, JSON.stringify(item)],
              );
            }
          },
          replaceApprovalQueue: async (items) => {
            await client.query(`DELETE FROM approval_queue_view`);
            for (const item of items) {
              await client.query(
                `INSERT INTO approval_queue_view (approval_request_id, status, requested_at, data)
                 VALUES ($1, $2, $3, $4::jsonb)`,
                [item.approvalRequestId, item.status, item.requestedAt, JSON.stringify(item)],
              );
            }
          },
          saveOverviewHealth: async (health) => {
            await client.query(
              `INSERT INTO overview_health_view (view_key, updated_at, data)
               VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (view_key) DO UPDATE SET updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
              [health.key, health.updatedAt, JSON.stringify(health)],
            );
          },
          getMissionSummaries: async () => {
            const result = await client.query(`SELECT data FROM mission_summary_view ORDER BY updated_at DESC`);
            return result.rows.map((row) => mapDataRow<MissionSummary>(row));
          },
          getApprovalQueue: async () => {
            const result = await client.query(`SELECT data FROM approval_queue_view ORDER BY requested_at DESC`);
            return result.rows.map((row) => mapDataRow<ApprovalQueueItem>(row));
          },
          getOverviewHealth: async () => {
            const result = await client.query(`SELECT data FROM overview_health_view WHERE view_key = 'overview' LIMIT 1`);
            return result.rows[0] ? mapDataRow<OverviewHealth>(result.rows[0]) : null;
          },
          getProjectionWatermark: async (projectionName) => {
            const result = await client.query(`SELECT projection_name, last_event_sequence, updated_at FROM projection_watermarks WHERE projection_name = $1`, [projectionName]);
            if (!result.rows[0]) {
              return null;
            }
            return {
              projectionName: result.rows[0].projection_name,
              lastEventSequence: Number(result.rows[0].last_event_sequence),
              updatedAt: toIso(result.rows[0].updated_at),
            } satisfies ProjectionWatermark;
          },
          saveProjectionWatermark: async (watermark) => {
            await client.query(
              `INSERT INTO projection_watermarks (projection_name, last_event_sequence, updated_at)
               VALUES ($1, $2, $3)
               ON CONFLICT (projection_name) DO UPDATE SET last_event_sequence = EXCLUDED.last_event_sequence, updated_at = EXCLUDED.updated_at`,
              [watermark.projectionName, watermark.lastEventSequence, watermark.updatedAt],
            );
          },
        };

        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }
}

export function createPostgresPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}
