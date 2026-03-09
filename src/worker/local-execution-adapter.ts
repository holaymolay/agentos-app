import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { ToolExecutionRequest, ToolExecutionResult } from "../shared/types.js";
import type { ExecutionAdapter } from "./execution-adapter.js";

const execFileAsync = promisify(execFile);

async function safeExec(file: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync(file, args);
    return result.stdout.trim();
  } catch {
    return "unavailable";
  }
}

export class LocalExecutionAdapter implements ExecutionAdapter {
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const delayMs = request.input.simulateDelayMs ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (request.step.stepKey === "collect_diagnostics") {
      const uname = await safeExec("uname", ["-a"]);
      const uptime = await safeExec("uptime", []);
      const diagnostics = {
        hostname: os.hostname(),
        platform: process.platform,
        nodeVersion: process.version,
        cwd: process.cwd(),
        artifactsDir: request.artifactsDir,
        uname,
        uptime,
        readOnly: true,
        needsRemediation: request.input.forceRemediation === true,
        remediationReason: request.input.forceRemediation === true ? "Forced by mission input for deterministic coverage." : null,
      };
      return {
        status: "SUCCEEDED",
        resultSummary: diagnostics.needsRemediation ? "Diagnostics completed; remediation recommended." : "Diagnostics completed; no remediation required.",
        output: diagnostics,
        errorClass: null,
        errorDetail: null,
      };
    }

    if (request.step.stepKey === "apply_remediation") {
      const targetDir = path.join(request.artifactsDir, "remediation");
      await fs.mkdir(targetDir, { recursive: true });
      const notePath = path.join(targetDir, "applied.txt");
      await fs.writeFile(notePath, "Remediation applied inside AgentOS workspace only.\n", "utf8");
      return {
        status: "SUCCEEDED",
        resultSummary: "Workspace-scoped remediation applied.",
        output: {
          remediationApplied: true,
          notePath,
          scope: "workspace_only",
        },
        errorClass: null,
        errorDetail: null,
      };
    }

    return {
      status: "FAILED",
      resultSummary: `Unknown tool step ${request.step.stepKey}`,
      output: {},
      errorClass: "UNKNOWN_TOOL",
      errorDetail: `Unknown tool step ${request.step.stepKey}`,
    };
  }
}
