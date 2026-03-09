import type {
  ApprovalQueueItem,
  ApprovalRequest,
  Artifact,
  ConversationMessage,
  KernelEvent,
  Mission,
  MissionDetail,
  MissionStep,
  MissionSummary,
  OverviewHealth,
  ProjectionWatermark,
  SkillVersion,
  UserPreference,
} from "../shared/types.js";

export type NewKernelEvent = Omit<KernelEvent, "sequence">;

export interface PersistenceTx {
  saveMission(mission: Mission): Promise<void>;
  saveMissionStep(step: MissionStep): Promise<void>;
  saveApprovalRequest(approval: ApprovalRequest): Promise<void>;
  saveArtifact(artifact: Artifact): Promise<void>;
  saveSkillVersion(skillVersion: SkillVersion): Promise<void>;
  saveConversationMessage(message: ConversationMessage): Promise<void>;
  saveUserPreference(preference: UserPreference): Promise<void>;
  appendEvent(event: NewKernelEvent): Promise<KernelEvent>;
  hasEventIdempotencyKey(idempotencyKey: string): Promise<boolean>;

  getMission(missionId: string): Promise<Mission | null>;
  getMissionForUpdate(missionId: string): Promise<Mission | null>;
  listMissions(): Promise<Mission[]>;
  getMissionStep(stepId: string): Promise<MissionStep | null>;
  getMissionStepForUpdate(stepId: string): Promise<MissionStep | null>;
  getMissionStepByKey(missionId: string, stepKey: string): Promise<MissionStep | null>;
  listMissionSteps(missionId: string): Promise<MissionStep[]>;
  findReadyStepForUpdate(nowIso: string): Promise<MissionStep | null>;
  listExpiredRunningStepsForUpdate(nowIso: string): Promise<MissionStep[]>;
  getApprovalRequest(approvalRequestId: string): Promise<ApprovalRequest | null>;
  getApprovalRequestForUpdate(approvalRequestId: string): Promise<ApprovalRequest | null>;
  listApprovalRequests(missionId?: string): Promise<ApprovalRequest[]>;
  listPendingApprovalRequests(): Promise<ApprovalRequest[]>;
  listArtifacts(missionId: string): Promise<Artifact[]>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  listEvents(missionId?: string): Promise<KernelEvent[]>;
  listEventsSince(lastSequence: number): Promise<KernelEvent[]>;
  getMaxEventSequence(): Promise<number>;
  getSkillVersion(skillVersionId: string): Promise<SkillVersion | null>;
  getSkillVersionBySkillId(skillId: string): Promise<SkillVersion | null>;
  getRecentConversationMessages(limit: number): Promise<ConversationMessage[]>;
  listUserPreferences(): Promise<UserPreference[]>;

  replaceMissionSummaries(items: MissionSummary[]): Promise<void>;
  replaceApprovalQueue(items: ApprovalQueueItem[]): Promise<void>;
  saveOverviewHealth(health: OverviewHealth): Promise<void>;
  getMissionSummaries(): Promise<MissionSummary[]>;
  getApprovalQueue(): Promise<ApprovalQueueItem[]>;
  getOverviewHealth(): Promise<OverviewHealth | null>;
  getProjectionWatermark(projectionName: string): Promise<ProjectionWatermark | null>;
  saveProjectionWatermark(watermark: ProjectionWatermark): Promise<void>;
}

export interface KernelPersistence {
  runInTransaction<T>(fn: (tx: PersistenceTx) => Promise<T>): Promise<T>;
}

export interface KernelReadApi {
  getMissionDetail(missionId: string): Promise<MissionDetail | null>;
  listMissionSummaries(): Promise<MissionSummary[]>;
  listApprovalQueue(): Promise<ApprovalQueueItem[]>;
  getOverviewHealth(): Promise<OverviewHealth | null>;
  getRecentConversationMessages(limit: number): Promise<ConversationMessage[]>;
  listUserPreferences(): Promise<UserPreference[]>;
}
