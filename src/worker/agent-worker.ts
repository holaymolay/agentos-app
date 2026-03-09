import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../domain/ids.js";
import { artifactDirForMission, buildArtifactFromFile, type ClaimedExecution, type AgentOsKernel } from "../domain/kernel.js";
import { sha256 } from "../shared/crypto.js";
import { isoNow } from "../shared/time.js";
import type { AppConfig, Artifact, ExecutionReceipt, Mission, MissionStep, ToolExecutionResult } from "../shared/types.js";
import type { ExecutionAdapter } from "./execution-adapter.js";

export class AgentWorker {
  constructor(
    private readonly kernel: AgentOsKernel,
    private readonly executionAdapter: ExecutionAdapter,
    private readonly config: AppConfig,
    private readonly workerId: string = "worker-1",
  ) {}

  async processNextStep(): Promise<ClaimedExecution | null> {
    const claimed = await this.kernel.claimReadyStep(this.workerId);
    if (!claimed) {
      return null;
    }

    const receipt = await this.executeClaimedStep(claimed);
    await this.kernel.submitStepReceipt(receipt);
    await this.kernel.projectCommittedEvents();
    return claimed;
  }

  async runOnceWithoutSubmitting(): Promise<{ claimed: ClaimedExecution | null; receipt: ExecutionReceipt | null }> {
    const claimed = await this.kernel.claimReadyStep(this.workerId);
    if (!claimed) {
      return { claimed: null, receipt: null };
    }
    const receipt = await this.executeClaimedStep(claimed);
    return { claimed, receipt };
  }

  async startLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const claimed = await this.processNextStep();
      if (!claimed) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  private async executeClaimedStep(claimed: ClaimedExecution): Promise<ExecutionReceipt> {
    const startedAt = isoNow();
    let artifacts: Artifact[] = [];
    let resultSummary = "";
    let resultData: Record<string, unknown> = {};
    let status: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
    let errorClass: string | null = null;
    let errorDetail: string | null = null;

    try {
      if (claimed.step.stepKind === "tool_call") {
        const toolResult = await this.executionAdapter.execute({
          mission: claimed.mission,
          step: claimed.step,
          input: claimed.input,
          scope: {
            readOnly: claimed.step.stepKey === "collect_diagnostics",
            allowFilesystemWrite: claimed.step.stepKey === "apply_remediation",
            allowShell: true,
          },
          artifactsDir: artifactDirForMission(this.config.artifactsDir, claimed.mission.missionId),
        });
        ({ status, resultSummary, output: resultData, errorClass, errorDetail } = toolResult);
      } else if (claimed.step.stepKind === "assert") {
        const diagnostics = claimed.mission.context.stepOutputs as Record<string, unknown>;
        const collect = diagnostics.collect_diagnostics as Record<string, unknown> | undefined;
        const needsRemediation = collect?.needsRemediation === true;
        resultSummary = needsRemediation ? "Remediation required." : "No remediation required.";
        resultData = { needsRemediation };
      } else if (claimed.step.stepKind === "artifact_emit") {
        artifacts = await this.emitArtifactsForStep(claimed.mission, claimed.step, claimed.input);
        resultSummary = `Emitted ${artifacts.length} artifact(s).`;
        resultData = { artifactIds: artifacts.map((artifact) => artifact.artifactId) };
      } else if (claimed.step.stepKind === "finish") {
        resultSummary = "Finish step complete; mission ready for verification.";
        resultData = { finish: true };
      } else {
        throw new Error(`Unsupported step kind ${claimed.step.stepKind}`);
      }
    } catch (error) {
      status = "FAILED";
      errorClass = error instanceof Error ? error.name || "EXECUTION_ERROR" : "EXECUTION_ERROR";
      errorDetail = error instanceof Error ? error.message : String(error);
      resultSummary = `Execution failed for ${claimed.step.stepKey}`;
      resultData = {};
    }

    return {
      missionId: claimed.mission.missionId,
      stepId: claimed.step.stepId,
      stepKey: claimed.step.stepKey,
      attempt: claimed.step.attempt,
      workerId: this.workerId,
      claimToken: claimed.step.claimToken ?? "",
      status,
      startedAt,
      finishedAt: isoNow(),
      idempotencyKey: `receipt:${claimed.step.stepId}:${claimed.step.attempt}:${createId("idem")}`,
      artifacts,
      resultSummary,
      resultData,
      errorClass,
      errorDetail,
    };
  }

  private async emitArtifactsForStep(mission: Mission, step: MissionStep, input: { forceBadArtifact?: boolean }): Promise<Artifact[]> {
    const missionDir = artifactDirForMission(this.config.artifactsDir, mission.missionId);
    await fs.mkdir(missionDir, { recursive: true });
    const stepOutputs = (mission.context.stepOutputs as Record<string, unknown> | undefined) ?? {};
    const sourceKey = step.stepKey === "emit_diagnostics_report" ? "collect_diagnostics" : "apply_remediation";
    const payload = stepOutputs[sourceKey] ?? {};
    const fileName = step.stepKey === "emit_diagnostics_report" ? "diagnostics-report.json" : "remediation-report.json";
    const absolutePath = path.join(missionDir, fileName);
    const content = JSON.stringify(payload, null, 2);
    await fs.writeFile(absolutePath, content, "utf8");
    const artifact = await buildArtifactFromFile(
      mission.missionId,
      step.stepId,
      step.stepKey === "emit_diagnostics_report" ? "diagnostics_report" : "remediation_report",
      absolutePath,
      {
        integrityOk: input.forceBadArtifact === true && step.stepKey === "emit_diagnostics_report" ? false : true,
        declaredSha256:
          input.forceBadArtifact === true && step.stepKey === "emit_diagnostics_report"
            ? "bad-hash"
            : sha256(content),
      },
      isoNow(),
    );
    if (input.forceBadArtifact === true && step.stepKey === "emit_diagnostics_report") {
      return [{ ...artifact, sha256: "bad-hash", metadata: { ...artifact.metadata, integrityOk: false } }];
    }
    return [artifact];
  }
}
