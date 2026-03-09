import { describe, expect, it } from "vitest";
import { createHealthcheckMission, createTestRuntime, processUntilApproval, processWorkerUntilIdle } from "./test-helpers.js";

describe("kernel + worker integration", () => {
  it("keeps chat-safe requests out of mission lane", async () => {
    const runtime = await createTestRuntime();
    const result = await runtime.assistantService.submitUserTurn({
      content: "Explain the tradeoff between chat lane and mission lane.",
      requestedBy: "owner",
      interfaceChannel: "web",
    });

    expect(result.lane).toBe("chat");
    expect(result.missionId).toBeNull();
    expect(await runtime.kernel.listMissionSummaries()).toHaveLength(0);
    const conversation = await runtime.kernel.getRecentConversationMessages(10);
    expect(conversation.at(-1)?.content).toContain("Chat lane response:");
  });

  it("creates the governed healthcheck mission with the expected step graph", async () => {
    const runtime = await createTestRuntime();
    const missionId = await createHealthcheckMission(runtime);
    const detail = await runtime.kernel.getMissionDetail(missionId);

    expect(detail?.steps.map((step) => step.stepKey)).toEqual([
      "collect_diagnostics",
      "emit_diagnostics_report",
      "needs_remediation",
      "approval_gate_remediation",
      "apply_remediation",
      "emit_remediation_report",
      "finish",
    ]);
    expect(detail?.steps[0]?.status).toBe("READY");
    expect(detail?.mission.status).toBe("READY");
  });

  it("completes the diagnostics-only happy path", async () => {
    const runtime = await createTestRuntime();
    const missionId = await createHealthcheckMission(runtime);

    await processWorkerUntilIdle(runtime);

    const detail = await runtime.kernel.getMissionDetail(missionId);
    expect(detail?.mission.status).toBe("SUCCEEDED");
    expect(detail?.approvals).toHaveLength(0);
    expect(detail?.artifacts.map((artifact) => artifact.artifactType)).toEqual(["diagnostics_report"]);
    expect(detail?.artifacts[0]?.promoted).toBe(true);
  });

  it("handles approved remediation end-to-end", async () => {
    const runtime = await createTestRuntime();
    const missionId = await createHealthcheckMission(runtime, { forceRemediation: true });
    const approvalRequestId = await processUntilApproval(runtime, missionId);

    await runtime.kernel.resolveApproval(approvalRequestId, "approve", "owner");
    await runtime.kernel.projectCommittedEvents();
    await processWorkerUntilIdle(runtime);

    const detail = await runtime.kernel.getMissionDetail(missionId);
    expect(detail?.mission.status).toBe("SUCCEEDED");
    expect(detail?.artifacts.map((artifact) => artifact.artifactType).sort()).toEqual([
      "diagnostics_report",
      "remediation_report",
    ]);
    expect(detail?.artifacts.every((artifact) => artifact.promoted)).toBe(true);
  });

  it("allows denied remediation to finish as diagnostics-only", async () => {
    const runtime = await createTestRuntime();
    const missionId = await createHealthcheckMission(runtime, { forceRemediation: true });
    const approvalRequestId = await processUntilApproval(runtime, missionId);

    await runtime.kernel.resolveApproval(approvalRequestId, "deny", "owner");
    await runtime.kernel.projectCommittedEvents();
    await processWorkerUntilIdle(runtime);

    const detail = await runtime.kernel.getMissionDetail(missionId);
    expect(detail?.mission.status).toBe("SUCCEEDED");
    expect(detail?.artifacts).toHaveLength(1);
    expect(detail?.artifacts[0]?.artifactType).toBe("diagnostics_report");
    expect(detail?.approvals[0]?.status).toBe("DENIED");
  });
});
