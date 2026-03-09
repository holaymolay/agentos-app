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
import type { KernelPersistence, NewKernelEvent, PersistenceTx } from "./persistence.js";

interface InMemoryState {
  missions: Record<string, Mission>;
  missionSteps: Record<string, MissionStep>;
  approvals: Record<string, ApprovalRequest>;
  artifacts: Record<string, Artifact>;
  skillVersions: Record<string, SkillVersion>;
  conversationMessages: Record<string, ConversationMessage>;
  userPreferences: Record<string, UserPreference>;
  events: KernelEvent[];
  missionSummaries: Record<string, MissionSummary>;
  approvalQueue: Record<string, ApprovalQueueItem>;
  overviewHealth: OverviewHealth | null;
  watermarks: Record<string, ProjectionWatermark>;
  nextSequence: number;
}

function sortByIsoDesc<T>(items: T[], getIso: (item: T) => string): T[] {
  return items.toSorted((a, b) => getIso(b).localeCompare(getIso(a)));
}

export class InMemoryPersistence implements KernelPersistence {
  private transactionQueue: Promise<void> = Promise.resolve();

  private state: InMemoryState = {
    missions: {},
    missionSteps: {},
    approvals: {},
    artifacts: {},
    skillVersions: {},
    conversationMessages: {},
    userPreferences: {},
    events: [],
    missionSummaries: {},
    approvalQueue: {},
    overviewHealth: null,
    watermarks: {},
    nextSequence: 1,
  };

  async runInTransaction<T>(fn: (tx: PersistenceTx) => Promise<T>): Promise<T> {
    const previous = this.transactionQueue;
    let releaseQueue = () => {};
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previous;

    try {
      const working = structuredClone(this.state) as InMemoryState;
      const tx: PersistenceTx = {
        saveMission: async (mission) => {
          working.missions[mission.missionId] = mission;
        },
        saveMissionStep: async (step) => {
          working.missionSteps[step.stepId] = step;
        },
        saveApprovalRequest: async (approval) => {
          working.approvals[approval.approvalRequestId] = approval;
        },
        saveArtifact: async (artifact) => {
          working.artifacts[artifact.artifactId] = artifact;
        },
        saveSkillVersion: async (skillVersion) => {
          working.skillVersions[skillVersion.skillVersionId] = skillVersion;
        },
        saveConversationMessage: async (message) => {
          working.conversationMessages[message.messageId] = message;
        },
        saveUserPreference: async (preference) => {
          working.userPreferences[preference.preferenceKey] = preference;
        },
        appendEvent: async (event) => {
          const appended: KernelEvent = { ...event, sequence: working.nextSequence++ };
          working.events.push(appended);
          return appended;
        },
        hasEventIdempotencyKey: async (idempotencyKey) =>
          working.events.some((event) => event.idempotencyKey === idempotencyKey),
        getMission: async (missionId) => working.missions[missionId] ?? null,
        getMissionForUpdate: async (missionId) => working.missions[missionId] ?? null,
        listMissions: async () => sortByIsoDesc(Object.values(working.missions), (item) => item.updatedAt),
        getMissionStep: async (stepId) => working.missionSteps[stepId] ?? null,
        getMissionStepForUpdate: async (stepId) => working.missionSteps[stepId] ?? null,
        getMissionStepByKey: async (missionId, stepKey) =>
          Object.values(working.missionSteps).find((step) => step.missionId === missionId && step.stepKey === stepKey) ?? null,
        listMissionSteps: async (missionId) =>
          Object.values(working.missionSteps)
            .filter((step) => step.missionId === missionId)
            .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
        findReadyStepForUpdate: async (nowIso) =>
          Object.values(working.missionSteps)
            .filter((step) => step.status === "READY" && step.availableAt <= nowIso)
            .toSorted((a, b) => a.availableAt.localeCompare(b.availableAt))[0] ?? null,
        listExpiredRunningStepsForUpdate: async (nowIso) =>
          Object.values(working.missionSteps)
            .filter((step) => step.status === "RUNNING" && step.leaseExpiresAt !== null && step.leaseExpiresAt <= nowIso)
            .toSorted((a, b) => (a.leaseExpiresAt ?? "").localeCompare(b.leaseExpiresAt ?? "")),
        getApprovalRequest: async (approvalRequestId) => working.approvals[approvalRequestId] ?? null,
        getApprovalRequestForUpdate: async (approvalRequestId) => working.approvals[approvalRequestId] ?? null,
        listApprovalRequests: async (missionId) =>
          sortByIsoDesc(
            Object.values(working.approvals).filter((approval) => !missionId || approval.missionId === missionId),
            (item) => item.requestedAt,
          ),
        listPendingApprovalRequests: async () =>
          sortByIsoDesc(
            Object.values(working.approvals).filter((approval) => approval.status === "PENDING"),
            (item) => item.requestedAt,
          ),
        listArtifacts: async (missionId) =>
          sortByIsoDesc(
            Object.values(working.artifacts).filter((artifact) => artifact.missionId === missionId),
            (item) => item.createdAt,
          ),
        getArtifact: async (artifactId) => working.artifacts[artifactId] ?? null,
        listEvents: async (missionId) =>
          working.events.filter((event) => !missionId || event.missionId === missionId).toSorted((a, b) => a.sequence - b.sequence),
        listEventsSince: async (lastSequence) => working.events.filter((event) => event.sequence > lastSequence).toSorted((a, b) => a.sequence - b.sequence),
        getMaxEventSequence: async () => Math.max(0, ...working.events.map((event) => event.sequence)),
        getSkillVersion: async (skillVersionId) => working.skillVersions[skillVersionId] ?? null,
        getSkillVersionBySkillId: async (skillId) =>
          Object.values(working.skillVersions).find((skill) => skill.skillId === skillId && skill.status === "active") ?? null,
        getRecentConversationMessages: async (limit) => sortByIsoDesc(Object.values(working.conversationMessages), (item) => item.createdAt).slice(0, limit).toReversed(),
        listUserPreferences: async () => Object.values(working.userPreferences).toSorted((a, b) => a.preferenceKey.localeCompare(b.preferenceKey)),
        replaceMissionSummaries: async (items) => {
          working.missionSummaries = Object.fromEntries(items.map((item) => [item.missionId, item]));
        },
        replaceApprovalQueue: async (items) => {
          working.approvalQueue = Object.fromEntries(items.map((item) => [item.approvalRequestId, item]));
        },
        saveOverviewHealth: async (health) => {
          working.overviewHealth = health;
        },
        getMissionSummaries: async () => sortByIsoDesc(Object.values(working.missionSummaries), (item) => item.lastUpdatedAt),
        getApprovalQueue: async () => sortByIsoDesc(Object.values(working.approvalQueue), (item) => item.requestedAt),
        getOverviewHealth: async () => working.overviewHealth,
        getProjectionWatermark: async (projectionName) => working.watermarks[projectionName] ?? null,
        saveProjectionWatermark: async (watermark) => {
          working.watermarks[watermark.projectionName] = watermark;
        },
      };

      const result = await fn(tx);
      this.state = working;
      return result;
    } finally {
      releaseQueue();
    }
  }
}
