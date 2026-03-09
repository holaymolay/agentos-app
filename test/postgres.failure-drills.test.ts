import { afterEach, describe, expect, it } from "vitest";
import {
  createHealthcheckMission,
  createPostgresTestRuntime,
  processUntilApproval,
  processWorkerUntilIdle,
} from "./test-helpers.js";
import type { AgentOsRuntime } from "../src/bootstrap.js";

function futureIso(baseIso: string, deltaMs: number): string {
  return new Date(new Date(baseIso).getTime() + deltaMs).toISOString();
}

const describePostgres = process.env.DATABASE_URL ? describe : describe.skip;
const POSTGRES_TEST_TIMEOUT_MS = 20_000;

let runtime: AgentOsRuntime | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.shutdown();
    runtime = null;
  }
});

describePostgres("Phase 1 exit drills on Postgres", () => {
  it("drill 1: duplicate receipt idempotency does not duplicate artifacts or transitions", async () => {
    runtime = await createPostgresTestRuntime();
    const missionId = await createHealthcheckMission(runtime);

    await runtime.worker.processNextStep();
    const secondStep = await runtime.worker.runOnceWithoutSubmitting();
    expect(secondStep.receipt?.stepKey).toBe("emit_diagnostics_report");

    await runtime.kernel.submitStepReceipt(secondStep.receipt!);
    await runtime.kernel.projectCommittedEvents();
    const duplicate = await runtime.kernel.submitStepReceipt(secondStep.receipt!);

    expect(duplicate).toEqual({ accepted: true, duplicate: true });
    const detail = await runtime.kernel.getMissionDetail(missionId);
    expect(detail?.artifacts).toHaveLength(1);
    expect(detail?.events.filter((event) => event.eventType === "ARTIFACT_RECORDED")).toHaveLength(1);
  }, POSTGRES_TEST_TIMEOUT_MS);

  it("drill 2: worker interruption and lease expiry reject late receipts and do not leave stuck running state", async () => {
    runtime = await createPostgresTestRuntime();
    await createHealthcheckMission(runtime);

    const firstClaim = await runtime.worker.runOnceWithoutSubmitting();
    const lateReceipt = firstClaim.receipt!;
    const claimStepId = firstClaim.claimed!.step.stepId;
    const lateNow = futureIso(firstClaim.claimed!.step.leaseExpiresAt!, 5_000);

    const expired = await runtime.kernel.expireLeases(lateNow);
    const lateResult = await runtime.kernel.submitStepReceipt(lateReceipt);
    const detail = await runtime.kernel.getMissionDetail(firstClaim.claimed!.mission.missionId);
    const step = detail?.steps.find((item) => item.stepId === claimStepId);

    expect(expired).toBe(1);
    expect(lateResult.accepted).toBe(false);
    expect(step?.status).toBe("READY");
    expect(detail?.mission.status).not.toBe("RUNNING");
  }, POSTGRES_TEST_TIMEOUT_MS);

  it("drill 3: approval race settles on exactly one terminal approval outcome", async () => {
    runtime = await createPostgresTestRuntime();
    const missionId = await createHealthcheckMission(runtime, { forceRemediation: true });
    const approvalRequestId = await processUntilApproval(runtime, missionId);

    const [approved, denied] = await Promise.all([
      runtime.kernel.resolveApproval(approvalRequestId, "approve", "owner-a"),
      runtime.kernel.resolveApproval(approvalRequestId, "deny", "owner-b"),
    ]);
    await runtime.kernel.projectCommittedEvents();

    const detail = await runtime.kernel.getMissionDetail(missionId);
    const approval = detail?.approvals[0];
    expect(approved?.status === "APPROVED" || denied?.status === "DENIED" || denied?.status === "APPROVED").toBe(true);
    expect(approval?.status === "APPROVED" || approval?.status === "DENIED").toBe(true);
    expect(detail?.approvals).toHaveLength(1);
    expect(await runtime.kernel.listApprovalQueue()).toHaveLength(0);
  }, POSTGRES_TEST_TIMEOUT_MS);

  it("drill 4: artifact integrity failure quarantines the mission and does not promote the artifact", async () => {
    runtime = await createPostgresTestRuntime();
    const missionId = await createHealthcheckMission(runtime, { forceBadArtifact: true });

    await processWorkerUntilIdle(runtime);

    const detail = await runtime.kernel.getMissionDetail(missionId);
    expect(detail?.mission.status).toBe("QUARANTINED");
    expect(detail?.artifacts[0]?.promoted).toBe(false);
    expect(detail?.events.some((event) => event.eventType === "MISSION_QUARANTINED")).toBe(true);
  }, POSTGRES_TEST_TIMEOUT_MS);

  it("drill 5: read-model staleness is visible instead of silently lying", async () => {
    runtime = await createPostgresTestRuntime();
    const missionId = await createHealthcheckMission(runtime);

    const run = await runtime.worker.runOnceWithoutSubmitting();
    await runtime.kernel.submitStepReceipt(run.receipt!);
    const projectedSummary = (await runtime.kernel.listMissionSummaries()).find((item) => item.missionId === missionId);
    const overviewHealth = await runtime.kernel.getOverviewHealth();
    const canonical = await runtime.kernel.getMissionDetail(missionId);

    expect(projectedSummary?.status).toBe("READY");
    expect(canonical?.mission.status).toBe("RUNNING");
    expect(overviewHealth?.isStale).toBe(true);
    expect((overviewHealth?.projectionLagEvents ?? 0) > 0).toBe(true);
  }, POSTGRES_TEST_TIMEOUT_MS);

  it("drill 6: lane boundary keeps harmless chat out of mission lane and escalates governed work", async () => {
    runtime = await createPostgresTestRuntime();
    const chat = await runtime.assistantService.submitUserTurn({
      content: "Rewrite this sentence to be clearer.",
      requestedBy: "owner",
      interfaceChannel: "web",
    });
    const mission = await runtime.assistantService.submitUserTurn({
      content: "Run a healthcheck on the runtime.",
      requestedBy: "owner",
      interfaceChannel: "web",
    });

    const missions = await runtime.kernel.listMissionSummaries();
    expect(chat.lane).toBe("chat");
    expect(chat.missionId).toBeNull();
    expect(mission.lane).toBe("mission");
    expect(mission.missionId).toBeTruthy();
    expect(missions).toHaveLength(1);
  }, POSTGRES_TEST_TIMEOUT_MS);
});
