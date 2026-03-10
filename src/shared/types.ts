export type Lane = "chat" | "mission";
export type Plane = "speculative" | "authoritative";
export type MissionStatus =
  | "RECEIVED"
  | "READY"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "QUARANTINED";
export type StepStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED"
  | "DEAD_LETTERED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED";
export type ApprovalDecision = "approve" | "deny";
export type RiskTier = "low" | "medium" | "high";
export type StepKind = "prepare" | "tool_call" | "approval_gate" | "assert" | "artifact_emit" | "finish";
export type EventType =
  | "REQUEST_REMAINED_IN_CHAT_LANE"
  | "REQUEST_ESCALATED_TO_MISSION"
  | "MISSION_CREATED"
  | "MISSION_READY"
  | "MISSION_RUNNING"
  | "MISSION_WAITING_APPROVAL"
  | "MISSION_VERIFYING"
  | "MISSION_SUCCEEDED"
  | "MISSION_FAILED"
  | "MISSION_CANCELLED"
  | "MISSION_QUARANTINED"
  | "STEP_READY"
  | "STEP_CLAIMED"
  | "STEP_STARTED"
  | "STEP_LEASE_RENEWED"
  | "STEP_LEASE_EXPIRED"
  | "STEP_WAITING_APPROVAL"
  | "STEP_SUCCEEDED"
  | "STEP_SKIPPED"
  | "STEP_FAILED"
  | "STEP_REQUEUED"
  | "STEP_DEAD_LETTERED"
  | "ARTIFACT_RECORDED"
  | "ARTIFACT_PROMOTED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED";
export type RetryPolicyKind = "none" | "bounded_immediate" | "bounded_backoff";
export type LaneMode = "mission_bound" | "dual_mode";
export type ToolName = "collect_diagnostics" | "apply_remediation";

export interface RetryPolicy {
  kind: RetryPolicyKind;
  maxAttempts: number;
  backoffMs: number;
  retryableErrorClasses: string[];
}

export interface SkillStepDefinition {
  stepKey: string;
  kind: StepKind;
  plane: Plane;
  title: string;
  when: string;
  inputRef: string | null;
  timeoutSec: number;
  retryPolicy: RetryPolicy;
  onSuccess?: string | null;
  onFailure?: string | null;
  compensationRef?: string | null;
  toolName?: ToolName;
  toolScope?: Record<string, unknown>;
  requestTemplate?: Record<string, unknown>;
  actionSummary?: string;
  scopeJson?: Record<string, unknown>;
  riskTier?: RiskTier;
  evidencePolicy?: string;
  predicateRef?: string;
  artifactType?: string;
  sourceRef?: string;
}

export interface SkillVersion {
  skillVersionId: string;
  skillId: string;
  version: string;
  status: "active" | "draft" | "deprecated";
  laneMode: LaneMode;
  purpose: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  stepGraph: SkillStepDefinition[];
  permissionProfile: Record<string, unknown>;
  verificationRequirements: Record<string, unknown>;
}

export interface Mission {
  missionId: string;
  assistantId: string;
  requestedBy: string;
  interfaceChannel: string;
  status: MissionStatus;
  summary: string;
  skillVersionId: string;
  riskTier: RiskTier;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  escalationReason: string;
  originLane: Lane;
  context: Record<string, unknown>;
}

export interface MissionStep {
  stepId: string;
  missionId: string;
  stepKey: string;
  stepKind: StepKind;
  status: StepStatus;
  attempt: number;
  workerBinding: string | null;
  inputRef: Record<string, unknown> | null;
  outputRef: Record<string, unknown> | null;
  approvalRequestId: string | null;
  claimToken: string | null;
  claimedByWorkerId: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  plane: Plane;
  retryPolicy: RetryPolicy;
  timeoutSec: number;
}

export interface ApprovalRequest {
  approvalRequestId: string;
  missionId: string;
  stepId: string;
  actionSummary: string;
  riskTier: RiskTier;
  scopeJson: Record<string, unknown>;
  rationale: string;
  evidenceRefs: string[];
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface Artifact {
  artifactId: string;
  missionId: string;
  stepId: string;
  artifactType: string;
  uri: string;
  sha256: string;
  createdAt: string;
  promoted: boolean;
  metadata: Record<string, unknown>;
}

export interface KernelEvent {
  sequence: number;
  eventId: string;
  missionId: string | null;
  stepId: string | null;
  eventType: EventType;
  actorType: string;
  actorId: string;
  ts: string;
  payloadJson: Record<string, unknown>;
  idempotencyKey: string;
  plane: Plane;
}

export interface ConversationMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  lane: Lane;
  missionId: string | null;
  createdAt: string;
}

export interface UserPreference {
  preferenceKey: string;
  value: string;
  updatedAt: string;
}

export interface LaneDecision {
  lane: Lane;
  reason: string;
  missionRequired: boolean;
  matchedSkillVersionId: string | null;
}

export interface HealthcheckMissionInput {
  forceRemediation?: boolean;
  forceBadArtifact?: boolean;
  simulateDelayMs?: number;
}

export interface ToolExecutionRequest {
  mission: Mission;
  step: MissionStep;
  input: HealthcheckMissionInput;
  scope: ExecutionScope;
  artifactsDir: string;
}

export interface ToolExecutionResult {
  status: "SUCCEEDED" | "FAILED";
  resultSummary: string;
  output: Record<string, unknown>;
  errorClass: string | null;
  errorDetail: string | null;
}

export interface ArtifactEmission {
  artifactType: string;
  fileName: string;
  content: string;
  declaredSha256?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionScope {
  readOnly: boolean;
  allowFilesystemWrite: boolean;
  allowShell: boolean;
}

export interface ExecutionReceipt {
  missionId: string;
  stepId: string;
  stepKey: string;
  attempt: number;
  workerId: string;
  claimToken: string;
  status: "SUCCEEDED" | "FAILED";
  startedAt: string;
  finishedAt: string;
  idempotencyKey: string;
  artifacts: Artifact[];
  resultSummary: string;
  resultData: Record<string, unknown>;
  errorClass: string | null;
  errorDetail: string | null;
}

export interface MissionSummary {
  missionId: string;
  summary: string;
  status: MissionStatus;
  riskTier: RiskTier;
  skillVersionId: string;
  lastUpdatedAt: string;
  operatorActionNeeded: boolean;
}

export interface ApprovalQueueItem {
  approvalRequestId: string;
  missionId: string;
  stepId: string;
  requestedAction: string;
  rationale: string;
  riskTier: RiskTier;
  scope: Record<string, unknown>;
  evidencePreview: string[];
  requestedAt: string;
  status: ApprovalStatus;
}

export interface OverviewHealth {
  key: string;
  activeMissionCount: number;
  blockedApprovalCount: number;
  failedMissionCount: number;
  degradedDependencies: string[];
  projectionLagEvents: number;
  projectionLagMs: number;
  isStale: boolean;
  updatedAt: string;
}

export interface MissionDetail {
  mission: Mission;
  steps: MissionStep[];
  approvals: ApprovalRequest[];
  artifacts: Artifact[];
  events: KernelEvent[];
  failureSummary: string | null;
}

export interface ProjectionWatermark {
  projectionName: string;
  lastEventSequence: number;
  updatedAt: string;
}

export interface AppConfig {
  databaseUrl: string | null;
  ownerPassword: string;
  cookieSecret: string;
  bridgeToken: string | null;
  publicBaseUrl: string | null;
  heartbeatIntervalMs: number;
  leaseDurationMs: number;
  projectionLagThresholdMs: number;
  projectionName: string;
  dataDir: string;
  artifactsDir: string;
  assistantId: string;
}
