import fs from "node:fs/promises";
import path from "node:path";
import { createId, createToken } from "./ids.js";
import type {
  ApprovalDecision,
  ApprovalQueueItem,
  ApprovalRequest,
  Artifact,
  ConversationMessage,
  EventType,
  ExecutionReceipt,
  HealthcheckMissionInput,
  KernelEvent,
  Mission,
  MissionDetail,
  MissionStatus,
  MissionStep,
  MissionSummary,
  OverviewHealth,
  Plane,
  ProjectionWatermark,
  RiskTier,
  SkillVersion,
  UserPreference,
} from "../shared/types.js";
import { addMs, diffMs, isoNow } from "../shared/time.js";
import { healthcheckSkillVersion, normalizeHealthcheckInput } from "../skills/healthcheck.js";
import type { AppConfig } from "../shared/types.js";
import type { KernelPersistence, KernelReadApi, PersistenceTx } from "./persistence.js";
import { sha256 } from "../shared/crypto.js";

export interface ClaimedExecution {
  mission: Mission;
  step: MissionStep;
  skillVersion: SkillVersion;
  input: HealthcheckMissionInput;
}

export interface MissionCreationResult {
  mission: Mission;
  summary: MissionSummary;
}

function cloneContext(mission: Mission): Record<string, unknown> {
  return structuredClone(mission.context) as Record<string, unknown>;
}

function stepOutput<T>(mission: Mission, stepKey: string): T | null {
  const stepOutputs = mission.context.stepOutputs as Record<string, unknown> | undefined;
  if (!stepOutputs) {
    return null;
  }
  return (stepOutputs[stepKey] as T | undefined) ?? null;
}

function setStepOutput(mission: Mission, stepKey: string, value: unknown): Mission {
  const context = cloneContext(mission);
  const stepOutputs = (context.stepOutputs as Record<string, unknown> | undefined) ?? {};
  stepOutputs[stepKey] = value;
  context.stepOutputs = stepOutputs;
  return { ...mission, context };
}

function setMissionContextValue(mission: Mission, key: string, value: unknown): Mission {
  const context = cloneContext(mission);
  context[key] = value;
  return { ...mission, context };
}

function createEvent(eventType: EventType, missionId: string | null, stepId: string | null, actorType: string, actorId: string, plane: Plane, payloadJson: Record<string, unknown>, idempotencyKey: string, nowIso: string): Omit<KernelEvent, "sequence"> {
  return {
    eventId: createId("event"),
    missionId,
    stepId,
    eventType,
    actorType,
    actorId,
    ts: nowIso,
    payloadJson,
    idempotencyKey,
    plane,
  };
}

function missionSummaryFromMission(mission: Mission, approvals: ApprovalRequest[]): MissionSummary {
  return {
    missionId: mission.missionId,
    summary: mission.summary,
    status: mission.status,
    riskTier: mission.riskTier,
    skillVersionId: mission.skillVersionId,
    lastUpdatedAt: mission.updatedAt,
    operatorActionNeeded: approvals.some((approval) => approval.status === "PENDING"),
  };
}

function approvalQueueItemFromApproval(approval: ApprovalRequest): ApprovalQueueItem {
  return {
    approvalRequestId: approval.approvalRequestId,
    missionId: approval.missionId,
    stepId: approval.stepId,
    requestedAction: approval.actionSummary,
    rationale: approval.rationale,
    riskTier: approval.riskTier,
    scope: approval.scopeJson,
    evidencePreview: approval.evidenceRefs,
    requestedAt: approval.requestedAt,
    status: approval.status,
  };
}

function getRequiredArtifactTypes(mission: Mission): string[] {
  const required = ["diagnostics_report"];
  if (mission.context.remediationApplied === true) {
    required.push("remediation_report");
  }
  return required;
}

export class AgentOsKernel implements KernelReadApi {
  constructor(private readonly persistence: KernelPersistence, private readonly config: AppConfig) {}

  async seedDefaults(): Promise<void> {
    await this.persistence.runInTransaction(async (tx) => {
      const existingSkill = await tx.getSkillVersion(healthcheckSkillVersion.skillVersionId);
      if (!existingSkill) {
        await tx.saveSkillVersion(healthcheckSkillVersion);
      }
    });
  }

  async saveConversationMessage(message: ConversationMessage): Promise<void> {
    await this.persistence.runInTransaction(async (tx) => {
      await tx.saveConversationMessage(message);
    });
  }

  async saveUserPreference(preference: UserPreference): Promise<void> {
    await this.persistence.runInTransaction(async (tx) => {
      await tx.saveUserPreference(preference);
    });
  }

  async getRecentConversationMessages(limit: number): Promise<ConversationMessage[]> {
    return this.persistence.runInTransaction((tx) => tx.getRecentConversationMessages(limit));
  }

  async listUserPreferences(): Promise<UserPreference[]> {
    return this.persistence.runInTransaction((tx) => tx.listUserPreferences());
  }

  async createMissionFromTurn(params: {
    content: string;
    requestedBy: string;
    interfaceChannel: string;
    input?: HealthcheckMissionInput;
    nowIso?: string;
  }): Promise<MissionCreationResult> {
    const nowIso = params.nowIso ?? isoNow();
    await this.seedDefaults();

    return this.persistence.runInTransaction(async (tx) => {
      const skillVersion = await tx.getSkillVersion(healthcheckSkillVersion.skillVersionId);
      if (!skillVersion) {
        throw new Error("skill.healthcheck@1.0.0 is not registered");
      }

      const missionId = createId("mission");
      const normalizedInput = normalizeHealthcheckInput(params.input);
      const mission: Mission = {
        missionId,
        assistantId: this.config.assistantId,
        requestedBy: params.requestedBy,
        interfaceChannel: params.interfaceChannel,
        status: "READY",
        summary: `Healthcheck mission for: ${params.content.trim()}`,
        skillVersionId: skillVersion.skillVersionId,
        riskTier: "medium",
        createdAt: nowIso,
        updatedAt: nowIso,
        terminalAt: null,
        escalationReason: "Governed healthcheck requested",
        originLane: "chat",
        context: {
          input: normalizedInput,
          requestContent: params.content,
          stepOutputs: {},
          remediationApplied: false,
          remediationApproved: false,
          remediationDenied: false,
        },
      };

      const steps: MissionStep[] = skillVersion.stepGraph.map((definition, index) => ({
        stepId: createId(`step_${definition.stepKey}`),
        missionId,
        stepKey: definition.stepKey,
        stepKind: definition.kind,
        status: index === 0 ? "READY" : "PENDING",
        attempt: 0,
        workerBinding: null,
        inputRef: null,
        outputRef: null,
        approvalRequestId: null,
        claimToken: null,
        claimedByWorkerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        availableAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
        plane: definition.plane,
        retryPolicy: definition.retryPolicy,
        timeoutSec: definition.timeoutSec,
      }));

      await tx.saveMission(mission);
      for (const step of steps) {
        await tx.saveMissionStep(step);
      }
      await tx.appendEvent(
        createEvent(
          "REQUEST_ESCALATED_TO_MISSION",
          missionId,
          null,
          "assistant",
          this.config.assistantId,
          "authoritative",
          { content: params.content },
          `mission-escalated:${missionId}`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "MISSION_CREATED",
          missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { missionId, skillVersionId: skillVersion.skillVersionId },
          `mission-created:${missionId}`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "STEP_READY",
          missionId,
          steps[0]?.stepId ?? null,
          "kernel",
          "kernel",
          "authoritative",
          { stepKey: steps[0]?.stepKey ?? null },
          `step-ready:${steps[0]?.stepId}`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "MISSION_READY",
          missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { missionId },
          `mission-ready:${missionId}`,
          nowIso,
        ),
      );

      return {
        mission,
        summary: missionSummaryFromMission(mission, []),
      };
    });
  }

  async claimReadyStep(workerId: string, nowIso: string = isoNow()): Promise<ClaimedExecution | null> {
    return this.persistence.runInTransaction(async (tx) => {
      const step = await tx.findReadyStepForUpdate(nowIso);
      if (!step) {
        return null;
      }
      const mission = await tx.getMissionForUpdate(step.missionId);
      if (!mission) {
        throw new Error(`Mission ${step.missionId} not found for ready step ${step.stepId}`);
      }
      const skillVersion = await tx.getSkillVersion(mission.skillVersionId);
      if (!skillVersion) {
        throw new Error(`Skill version ${mission.skillVersionId} not found`);
      }

      const claimedStep: MissionStep = {
        ...step,
        status: "RUNNING",
        attempt: step.attempt + 1,
        claimToken: createToken(),
        claimedByWorkerId: workerId,
        claimedAt: nowIso,
        leaseExpiresAt: addMs(nowIso, this.config.leaseDurationMs),
        lastHeartbeatAt: nowIso,
        updatedAt: nowIso,
      };
      const updatedMission: Mission = mission.status === "RUNNING" ? mission : { ...mission, status: "RUNNING", updatedAt: nowIso };
      await tx.saveMission(updatedMission);
      await tx.saveMissionStep(claimedStep);
      await tx.appendEvent(
        createEvent(
          "STEP_CLAIMED",
          mission.missionId,
          step.stepId,
          "worker",
          workerId,
          "authoritative",
          { claimToken: claimedStep.claimToken, attempt: claimedStep.attempt },
          `step-claimed:${step.stepId}:${claimedStep.attempt}`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "STEP_STARTED",
          mission.missionId,
          step.stepId,
          "worker",
          workerId,
          "authoritative",
          { stepKey: step.stepKey, attempt: claimedStep.attempt },
          `step-started:${step.stepId}:${claimedStep.attempt}`,
          nowIso,
        ),
      );
      if (mission.status !== "RUNNING") {
        await tx.appendEvent(
          createEvent(
            "MISSION_RUNNING",
            mission.missionId,
            null,
            "kernel",
            "kernel",
            "authoritative",
            { missionId: mission.missionId },
            `mission-running:${mission.missionId}:${claimedStep.attempt}`,
            nowIso,
          ),
        );
      }

      return {
        mission: updatedMission,
        step: claimedStep,
        skillVersion,
        input: normalizeHealthcheckInput(mission.context.input as HealthcheckMissionInput | undefined),
      };
    });
  }

  async renewStepLease(stepId: string, claimToken: string, workerId: string, nowIso: string = isoNow()): Promise<boolean> {
    return this.persistence.runInTransaction(async (tx) => {
      const step = await tx.getMissionStepForUpdate(stepId);
      if (!step || step.status !== "RUNNING") {
        return false;
      }
      if (step.claimToken !== claimToken || step.claimedByWorkerId !== workerId) {
        return false;
      }
      const updated: MissionStep = {
        ...step,
        lastHeartbeatAt: nowIso,
        leaseExpiresAt: addMs(nowIso, this.config.leaseDurationMs),
        updatedAt: nowIso,
      };
      await tx.saveMissionStep(updated);
      await tx.appendEvent(
        createEvent(
          "STEP_LEASE_RENEWED",
          step.missionId,
          step.stepId,
          "worker",
          workerId,
          "authoritative",
          { claimToken },
          `step-lease-renewed:${step.stepId}:${nowIso}`,
          nowIso,
        ),
      );
      return true;
    });
  }

  async expireLeases(nowIso: string = isoNow()): Promise<number> {
    return this.persistence.runInTransaction(async (tx) => {
      let expiredCount = 0;
      const expiredSteps = await tx.listExpiredRunningStepsForUpdate(nowIso);

      for (const step of expiredSteps) {
        const mission = await tx.getMissionForUpdate(step.missionId);
        if (!mission || step.status !== "RUNNING" || !step.leaseExpiresAt || step.leaseExpiresAt > nowIso) {
          continue;
        }
        expiredCount += 1;
        const cleared: MissionStep = {
          ...step,
          claimToken: null,
          claimedByWorkerId: null,
          claimedAt: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: step.lastHeartbeatAt,
          updatedAt: nowIso,
        };
        await tx.appendEvent(
          createEvent(
            "STEP_LEASE_EXPIRED",
            mission.missionId,
            step.stepId,
            "kernel",
            "reaper",
            "authoritative",
            { previousClaimToken: step.claimToken },
            `step-lease-expired:${step.stepId}:${step.attempt}`,
            nowIso,
          ),
        );

        const canRetry = step.retryPolicy.kind !== "none" && step.attempt < step.retryPolicy.maxAttempts;
        if (canRetry) {
          const requeued: MissionStep = {
            ...cleared,
            status: "READY",
            availableAt: addMs(nowIso, step.retryPolicy.backoffMs),
          };
          const readiedMission: Mission = {
            ...mission,
            status: "READY",
            updatedAt: nowIso,
          };
          await tx.saveMission(readiedMission);
          await tx.saveMissionStep(requeued);
          await tx.appendEvent(
            createEvent(
              "STEP_REQUEUED",
              mission.missionId,
              step.stepId,
              "kernel",
              "reaper",
              "authoritative",
              { availableAt: requeued.availableAt },
              `step-requeued:${step.stepId}:${step.attempt}`,
              nowIso,
            ),
          );
          await tx.appendEvent(
            createEvent(
              "MISSION_READY",
              mission.missionId,
              null,
              "kernel",
              "reaper",
              "authoritative",
              { reason: "lease_expired_requeue" },
              `mission-ready:${mission.missionId}:lease-expired:${step.stepId}`,
              nowIso,
            ),
          );
        } else {
          const deadLettered: MissionStep = {
            ...cleared,
            status: "DEAD_LETTERED",
          };
          const failedMission: Mission = {
            ...mission,
            status: "FAILED",
            updatedAt: nowIso,
            terminalAt: nowIso,
          };
          await tx.saveMissionStep(deadLettered);
          await tx.saveMission(failedMission);
          await tx.appendEvent(
            createEvent(
              "STEP_DEAD_LETTERED",
              mission.missionId,
              step.stepId,
              "kernel",
              "reaper",
              "authoritative",
              { attempt: step.attempt },
              `step-dead-lettered:${step.stepId}:${step.attempt}`,
              nowIso,
            ),
          );
          await tx.appendEvent(
            createEvent(
              "MISSION_FAILED",
              mission.missionId,
              null,
              "kernel",
              "reaper",
              "authoritative",
              { reason: "lease_expired" },
              `mission-failed:${mission.missionId}:lease-expired:${step.stepId}`,
              nowIso,
            ),
          );
        }
      }

      return expiredCount;
    });
  }

  async submitStepReceipt(receipt: ExecutionReceipt): Promise<{ accepted: boolean; duplicate: boolean }> {
    return this.persistence.runInTransaction(async (tx) => {
      const isDuplicate = await tx.hasEventIdempotencyKey(receipt.idempotencyKey);
      if (isDuplicate) {
        return { accepted: true, duplicate: true };
      }

      const step = await tx.getMissionStepForUpdate(receipt.stepId);
      if (!step) {
        throw new Error(`Step ${receipt.stepId} not found`);
      }
      const mission = await tx.getMissionForUpdate(step.missionId);
      if (!mission) {
        throw new Error(`Mission ${step.missionId} not found`);
      }
      if (step.status !== "RUNNING" || step.claimToken !== receipt.claimToken || step.claimedByWorkerId !== receipt.workerId) {
        return (await tx.hasEventIdempotencyKey(receipt.idempotencyKey))
          ? { accepted: true, duplicate: true }
          : { accepted: false, duplicate: false };
      }

      if (receipt.status === "FAILED") {
        await this.handleFailedReceipt(tx, mission, step, receipt);
        return { accepted: true, duplicate: false };
      }

      let updatedMission = setStepOutput(mission, step.stepKey, receipt.resultData);
      updatedMission = { ...updatedMission, updatedAt: receipt.finishedAt };
      const succeededStep: MissionStep = {
        ...step,
        status: "SUCCEEDED",
        outputRef: receipt.resultData,
        claimToken: null,
        claimedByWorkerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: step.lastHeartbeatAt,
        updatedAt: receipt.finishedAt,
      };

      await tx.saveMission(updatedMission);
      await tx.saveMissionStep(succeededStep);
      await tx.appendEvent(
        createEvent(
          "STEP_SUCCEEDED",
          mission.missionId,
          step.stepId,
          "worker",
          receipt.workerId,
          "authoritative",
          { resultSummary: receipt.resultSummary },
          receipt.idempotencyKey,
          receipt.finishedAt,
        ),
      );

      for (const artifact of receipt.artifacts) {
        await tx.saveArtifact(artifact);
        await tx.appendEvent(
          createEvent(
            "ARTIFACT_RECORDED",
            artifact.missionId,
            artifact.stepId,
            "worker",
            receipt.workerId,
            "authoritative",
            { artifactId: artifact.artifactId, artifactType: artifact.artifactType },
            `artifact-recorded:${artifact.artifactId}`,
            receipt.finishedAt,
          ),
        );
      }

      switch (step.stepKey) {
        case "collect_diagnostics":
          await this.readyStepByKey(tx, updatedMission, "emit_diagnostics_report", receipt.finishedAt);
          break;
        case "emit_diagnostics_report":
          await this.readyStepByKey(tx, updatedMission, "needs_remediation", receipt.finishedAt);
          break;
        case "needs_remediation": {
          const needsRemediation = receipt.resultData.needsRemediation === true;
          updatedMission = setMissionContextValue(updatedMission, "needsRemediation", needsRemediation);
          await tx.saveMission(updatedMission);
          if (needsRemediation) {
            await this.enterApprovalWait(tx, updatedMission, receipt.finishedAt);
          } else {
            await this.readyStepByKey(tx, updatedMission, "finish", receipt.finishedAt);
          }
          break;
        }
        case "apply_remediation": {
          updatedMission = setMissionContextValue(updatedMission, "remediationApplied", true);
          await tx.saveMission(updatedMission);
          await this.readyStepByKey(tx, updatedMission, "emit_remediation_report", receipt.finishedAt);
          break;
        }
        case "emit_remediation_report":
          await this.readyStepByKey(tx, updatedMission, "finish", receipt.finishedAt);
          break;
        case "finish":
          await this.verifyAndFinalizeMission(tx, updatedMission, receipt.finishedAt);
          break;
        default:
          break;
      }

      return { accepted: true, duplicate: false };
    });
  }

  async resolveApproval(approvalRequestId: string, decision: ApprovalDecision, actor: string, nowIso: string = isoNow()): Promise<ApprovalRequest | null> {
    return this.persistence.runInTransaction(async (tx) => {
      const approval = await tx.getApprovalRequestForUpdate(approvalRequestId);
      if (!approval) {
        return null;
      }
      if (approval.status !== "PENDING") {
        return approval;
      }

      const step = await tx.getMissionStepForUpdate(approval.stepId);
      const mission = step ? await tx.getMissionForUpdate(step.missionId) : null;
      if (!step || !mission) {
        throw new Error(`Approval ${approval.approvalRequestId} is not attached to a live mission step`);
      }

      const resolvedStatus = decision === "approve" ? "APPROVED" : "DENIED";
      const updatedApproval: ApprovalRequest = {
        ...approval,
        status: resolvedStatus,
        resolvedAt: nowIso,
        resolvedBy: actor,
      };
      await tx.saveApprovalRequest(updatedApproval);
      await tx.appendEvent(
        createEvent(
          decision === "approve" ? "APPROVAL_GRANTED" : "APPROVAL_DENIED",
          mission.missionId,
          step.stepId,
          "operator",
          actor,
          "authoritative",
          { approvalRequestId },
          `approval-resolved:${approvalRequestId}:${resolvedStatus}`,
          nowIso,
        ),
      );

      const completedApprovalStep: MissionStep = {
        ...step,
        status: "SUCCEEDED",
        outputRef: { decision: resolvedStatus },
        claimToken: null,
        claimedByWorkerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        updatedAt: nowIso,
      };
      await tx.saveMissionStep(completedApprovalStep);
      await tx.appendEvent(
        createEvent(
          "STEP_SUCCEEDED",
          mission.missionId,
          step.stepId,
          "kernel",
          "approval-resolution",
          "authoritative",
          { decision: resolvedStatus },
          `approval-step-succeeded:${step.stepId}:${resolvedStatus}`,
          nowIso,
        ),
      );

      let updatedMission = mission;
      if (decision === "approve") {
        updatedMission = setMissionContextValue(mission, "remediationApproved", true);
        updatedMission = { ...updatedMission, status: "RUNNING", updatedAt: nowIso };
        await tx.saveMission(updatedMission);
        await tx.appendEvent(
          createEvent(
            "MISSION_RUNNING",
            mission.missionId,
            null,
            "kernel",
            "approval-resolution",
            "authoritative",
            { approvalRequestId },
            `mission-running:${mission.missionId}:approval-granted`,
            nowIso,
          ),
        );
        await this.readyStepByKey(tx, updatedMission, "apply_remediation", nowIso);
      } else {
        updatedMission = setMissionContextValue(mission, "remediationDenied", true);
        updatedMission = { ...updatedMission, status: "RUNNING", updatedAt: nowIso };
        await tx.saveMission(updatedMission);
        await tx.appendEvent(
          createEvent(
            "MISSION_RUNNING",
            mission.missionId,
            null,
            "kernel",
            "approval-resolution",
            "authoritative",
            { approvalRequestId },
            `mission-running:${mission.missionId}:approval-denied`,
            nowIso,
          ),
        );
        await this.readyStepByKey(tx, updatedMission, "finish", nowIso);
      }

      return updatedApproval;
    });
  }

  async projectCommittedEvents(nowIso: string = isoNow()): Promise<void> {
    await this.persistence.runInTransaction(async (tx) => {
      const watermark = await tx.getProjectionWatermark(this.config.projectionName);
      const lastProjectedSequence = watermark?.lastEventSequence ?? 0;
      const newEvents = await tx.listEventsSince(lastProjectedSequence);
      const maxEventSequence = await tx.getMaxEventSequence();
      if (newEvents.length === 0 && watermark) {
        return;
      }

      const missions = await tx.listMissions();
      const summaries: MissionSummary[] = [];
      for (const mission of missions) {
        const approvals = await tx.listApprovalRequests(mission.missionId);
        summaries.push(missionSummaryFromMission(mission, approvals));
      }
      const pendingApprovals = await tx.listPendingApprovalRequests();
      const approvalQueue = pendingApprovals.map((approval) => approvalQueueItemFromApproval(approval));

      const newestUnprojectedTs = newEvents.at(-1)?.ts ?? nowIso;
      const overview: OverviewHealth = {
        key: "overview",
        activeMissionCount: missions.filter((mission) => ["READY", "RUNNING", "WAITING_APPROVAL", "VERIFYING"].includes(mission.status)).length,
        blockedApprovalCount: pendingApprovals.length,
        failedMissionCount: missions.filter((mission) => mission.status === "FAILED" || mission.status === "QUARANTINED").length,
        degradedDependencies: [],
        projectionLagEvents: maxEventSequence - lastProjectedSequence,
        projectionLagMs: newEvents.length > 0 ? diffMs(newestUnprojectedTs, nowIso) : 0,
        isStale: false,
        updatedAt: nowIso,
      };

      await tx.replaceMissionSummaries(summaries);
      await tx.replaceApprovalQueue(approvalQueue);
      await tx.saveOverviewHealth(overview);
      await tx.saveProjectionWatermark({
        projectionName: this.config.projectionName,
        lastEventSequence: maxEventSequence,
        updatedAt: nowIso,
      });
    });
  }

  async getMissionDetail(missionId: string): Promise<MissionDetail | null> {
    return this.persistence.runInTransaction(async (tx) => {
      const mission = await tx.getMission(missionId);
      if (!mission) {
        return null;
      }
      const steps = await tx.listMissionSteps(missionId);
      const approvals = await tx.listApprovalRequests(missionId);
      const artifacts = await tx.listArtifacts(missionId);
      const events = await tx.listEvents(missionId);
      const failedStep = steps.find((step) => step.status === "FAILED" || step.status === "DEAD_LETTERED");
      const failureSummary = mission.status === "FAILED" || mission.status === "QUARANTINED"
        ? failedStep
          ? `Failure in step ${failedStep.stepKey} (${failedStep.status}).`
          : `Mission ended in ${mission.status}.`
        : null;
      return { mission, steps, approvals, artifacts, events, failureSummary };
    });
  }

  async listMissionSummaries(): Promise<MissionSummary[]> {
    return this.persistence.runInTransaction((tx) => tx.getMissionSummaries());
  }

  async listApprovalQueue(): Promise<ApprovalQueueItem[]> {
    return this.persistence.runInTransaction((tx) => tx.getApprovalQueue());
  }

  async getOverviewHealth(): Promise<OverviewHealth | null> {
    return this.persistence.runInTransaction(async (tx) => {
      const stored = await tx.getOverviewHealth();
      if (!stored) {
        return null;
      }
      const watermark = await tx.getProjectionWatermark(this.config.projectionName);
      const lastProjectedSequence = watermark?.lastEventSequence ?? 0;
      const maxEventSequence = await tx.getMaxEventSequence();
      const pendingEvents = await tx.listEventsSince(lastProjectedSequence);
      const newestPendingTs = pendingEvents.at(-1)?.ts ?? stored.updatedAt;
      const lagEvents = maxEventSequence - lastProjectedSequence;
      const lagMs = lagEvents > 0 ? diffMs(newestPendingTs, isoNow()) : 0;
      return {
        ...stored,
        projectionLagEvents: lagEvents,
        projectionLagMs: lagMs,
        isStale: lagMs > this.config.projectionLagThresholdMs || lagEvents > 0,
      };
    });
  }

  private async readyStepByKey(tx: PersistenceTx, mission: Mission, stepKey: string, nowIso: string): Promise<void> {
    const step = await tx.getMissionStepByKey(mission.missionId, stepKey);
    if (!step || step.status !== "PENDING") {
      return;
    }
    const updatedStep: MissionStep = { ...step, status: "READY", availableAt: nowIso, updatedAt: nowIso };
    await tx.saveMissionStep(updatedStep);
    await tx.appendEvent(
      createEvent(
        "STEP_READY",
        mission.missionId,
        step.stepId,
        "kernel",
        "kernel",
        "authoritative",
        { stepKey },
        `step-ready:${step.stepId}:${nowIso}`,
        nowIso,
      ),
    );
  }

  private async enterApprovalWait(tx: PersistenceTx, mission: Mission, nowIso: string): Promise<void> {
    const step = await tx.getMissionStepByKey(mission.missionId, "approval_gate_remediation");
    if (!step || step.status !== "PENDING") {
      return;
    }
    const approvalRequestId = createId("approval");
    const approval: ApprovalRequest = {
      approvalRequestId,
      missionId: mission.missionId,
      stepId: step.stepId,
      actionSummary: "Apply healthcheck remediation",
      riskTier: "medium",
      scopeJson: { tool: "apply_remediation", target: "workspace" },
      rationale: "Diagnostics indicate remediation is required before the mission can finish cleanly.",
      evidenceRefs: ["diagnostics_report"],
      status: "PENDING",
      requestedAt: nowIso,
      resolvedAt: null,
      resolvedBy: null,
    };
    const waitingStep: MissionStep = {
      ...step,
      status: "WAITING_APPROVAL",
      attempt: step.attempt + 1,
      approvalRequestId,
      claimToken: createToken(),
      claimedByWorkerId: "kernel:approval-gate",
      claimedAt: nowIso,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      updatedAt: nowIso,
    };
    const waitingMission: Mission = { ...mission, status: "WAITING_APPROVAL", updatedAt: nowIso };
    await tx.saveApprovalRequest(approval);
    await tx.saveMissionStep(waitingStep);
    await tx.saveMission(waitingMission);
    await tx.appendEvent(
      createEvent(
        "STEP_WAITING_APPROVAL",
        mission.missionId,
        step.stepId,
        "kernel",
        "kernel",
        "authoritative",
        { approvalRequestId },
        `step-waiting-approval:${step.stepId}`,
        nowIso,
      ),
    );
    await tx.appendEvent(
      createEvent(
        "APPROVAL_REQUESTED",
        mission.missionId,
        step.stepId,
        "kernel",
        "kernel",
        "authoritative",
        { approvalRequestId },
        `approval-requested:${approvalRequestId}`,
        nowIso,
      ),
    );
    await tx.appendEvent(
      createEvent(
        "MISSION_WAITING_APPROVAL",
        mission.missionId,
        null,
        "kernel",
        "kernel",
        "authoritative",
        { approvalRequestId },
        `mission-waiting-approval:${mission.missionId}`,
        nowIso,
      ),
    );
  }

  private async handleFailedReceipt(tx: PersistenceTx, mission: Mission, step: MissionStep, receipt: ExecutionReceipt): Promise<void> {
    const nowIso = receipt.finishedAt;
    const retryable = step.retryPolicy.kind !== "none" && step.attempt < step.retryPolicy.maxAttempts && step.retryPolicy.retryableErrorClasses.includes(receipt.errorClass ?? "");
    await tx.appendEvent(
      createEvent(
        "STEP_FAILED",
        mission.missionId,
        step.stepId,
        "worker",
        receipt.workerId,
        "authoritative",
        { errorClass: receipt.errorClass, errorDetail: receipt.errorDetail },
        receipt.idempotencyKey,
        nowIso,
      ),
    );

    if (retryable) {
      const requeued: MissionStep = {
        ...step,
        status: "READY",
        claimToken: null,
        claimedByWorkerId: null,
        claimedAt: null,
        leaseExpiresAt: null,
        updatedAt: nowIso,
        availableAt: addMs(nowIso, step.retryPolicy.backoffMs),
      };
      const readiedMission: Mission = {
        ...mission,
        status: "READY",
        updatedAt: nowIso,
      };
      await tx.saveMission(readiedMission);
      await tx.saveMissionStep(requeued);
      await tx.appendEvent(
        createEvent(
          "STEP_REQUEUED",
          mission.missionId,
          step.stepId,
          "kernel",
          "kernel",
          "authoritative",
          { availableAt: requeued.availableAt },
          `step-requeued:${step.stepId}:${step.attempt}`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "MISSION_READY",
          mission.missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { reason: "step_retryable_failure" },
          `mission-ready:${mission.missionId}:retryable:${step.stepId}`,
          nowIso,
        ),
      );
      return;
    }

    const deadLettered: MissionStep = {
      ...step,
      status: "DEAD_LETTERED",
      claimToken: null,
      claimedByWorkerId: null,
      claimedAt: null,
      leaseExpiresAt: null,
      updatedAt: nowIso,
    };
    const failedMission: Mission = {
      ...mission,
      status: "FAILED",
      updatedAt: nowIso,
      terminalAt: nowIso,
    };
    await tx.saveMissionStep(deadLettered);
    await tx.saveMission(failedMission);
    await tx.appendEvent(
      createEvent(
        "STEP_DEAD_LETTERED",
        mission.missionId,
        step.stepId,
        "kernel",
        "kernel",
        "authoritative",
        { errorClass: receipt.errorClass },
        `step-dead-lettered:${step.stepId}:${step.attempt}`,
        nowIso,
      ),
    );
    await tx.appendEvent(
      createEvent(
        "MISSION_FAILED",
        mission.missionId,
        null,
        "kernel",
        "kernel",
        "authoritative",
        { stepKey: step.stepKey, errorClass: receipt.errorClass },
        `mission-failed:${mission.missionId}:${step.stepId}`,
        nowIso,
      ),
    );
  }

  private async verifyAndFinalizeMission(tx: PersistenceTx, mission: Mission, nowIso: string): Promise<void> {
    const verifyingMission: Mission = { ...mission, status: "VERIFYING", updatedAt: nowIso };
    await tx.saveMission(verifyingMission);
    await tx.appendEvent(
      createEvent(
        "MISSION_VERIFYING",
        mission.missionId,
        null,
        "kernel",
        "kernel",
        "authoritative",
        { requiredArtifactTypes: getRequiredArtifactTypes(mission) },
        `mission-verifying:${mission.missionId}`,
        nowIso,
      ),
    );

    const artifacts = await tx.listArtifacts(mission.missionId);
    const artifactsByType = new Map(artifacts.map((artifact) => [artifact.artifactType, artifact]));
    const missingTypes = getRequiredArtifactTypes(mission).filter((type) => !artifactsByType.has(type));
    const badArtifact = artifacts.find((artifact) => artifact.metadata.integrityOk === false);

    if (badArtifact) {
      const quarantined: Mission = { ...verifyingMission, status: "QUARANTINED", terminalAt: nowIso, updatedAt: nowIso };
      await tx.saveMission(quarantined);
      await tx.appendEvent(
        createEvent(
          "VERIFICATION_FAILED",
          mission.missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { reason: "artifact_integrity_failed", artifactId: badArtifact.artifactId },
          `verification-failed:${mission.missionId}:integrity`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "MISSION_QUARANTINED",
          mission.missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { artifactId: badArtifact.artifactId },
          `mission-quarantined:${mission.missionId}`,
          nowIso,
        ),
      );
      return;
    }

    if (missingTypes.length > 0) {
      const failedMission: Mission = { ...verifyingMission, status: "FAILED", terminalAt: nowIso, updatedAt: nowIso };
      await tx.saveMission(failedMission);
      await tx.appendEvent(
        createEvent(
          "VERIFICATION_FAILED",
          mission.missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { reason: "missing_artifacts", missingTypes },
          `verification-failed:${mission.missionId}:missing`,
          nowIso,
        ),
      );
      await tx.appendEvent(
        createEvent(
          "MISSION_FAILED",
          mission.missionId,
          null,
          "kernel",
          "kernel",
          "authoritative",
          { missingTypes },
          `mission-failed:${mission.missionId}:missing-artifacts`,
          nowIso,
        ),
      );
      return;
    }

    for (const artifact of artifacts) {
      const promoted: Artifact = { ...artifact, promoted: true };
      await tx.saveArtifact(promoted);
      await tx.appendEvent(
        createEvent(
          "ARTIFACT_PROMOTED",
          mission.missionId,
          artifact.stepId,
          "kernel",
          "kernel",
          "authoritative",
          { artifactId: artifact.artifactId, artifactType: artifact.artifactType },
          `artifact-promoted:${artifact.artifactId}`,
          nowIso,
        ),
      );
    }

    const succeededMission: Mission = { ...verifyingMission, status: "SUCCEEDED", terminalAt: nowIso, updatedAt: nowIso };
    await tx.saveMission(succeededMission);
    await tx.appendEvent(
      createEvent(
        "VERIFICATION_PASSED",
        mission.missionId,
        null,
        "kernel",
        "kernel",
        "authoritative",
        { artifactCount: artifacts.length },
        `verification-passed:${mission.missionId}`,
        nowIso,
      ),
    );
    await tx.appendEvent(
      createEvent(
        "MISSION_SUCCEEDED",
        mission.missionId,
        null,
        "kernel",
        "kernel",
        "authoritative",
        { artifactCount: artifacts.length },
        `mission-succeeded:${mission.missionId}`,
        nowIso,
      ),
    );
  }
}

export async function buildArtifactFromFile(missionId: string, stepId: string, artifactType: string, absolutePath: string, metadata: Record<string, unknown>, createdAt: string): Promise<Artifact> {
  const content = await fs.readFile(absolutePath);
  return {
    artifactId: createId("artifact"),
    missionId,
    stepId,
    artifactType,
    uri: absolutePath,
    sha256: sha256(content),
    createdAt,
    promoted: false,
    metadata,
  };
}

export function artifactDirForMission(artifactsRoot: string, missionId: string): string {
  return path.join(artifactsRoot, missionId);
}
