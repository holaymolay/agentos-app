import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import type { OpenClawAdminBridgeStatus, OpenClawServiceAction } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export interface OpenClawAdminBridgeConfig {
  bindHost: string;
  port: number;
  bearerToken: string;
  serviceName: string;
}

function respondJson(reply: ServerResponse, statusCode: number, payload: unknown): void {
  reply.statusCode = statusCode;
  reply.setHeader("Content-Type", "application/json");
  reply.end(JSON.stringify(payload));
}

function isAuthorized(request: IncomingMessage, expectedToken: string): boolean {
  const header = request.headers.authorization;
  return header === `Bearer ${expectedToken}`;
}

function parseSystemctlShow(stdout: string): OpenClawAdminBridgeStatus {
  const values = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }
    values.set(trimmed.slice(0, delimiterIndex), trimmed.slice(delimiterIndex + 1));
  }

  const mainPidRaw = values.get("MainPID") ?? "0";
  const mainPid = Number.parseInt(mainPidRaw, 10);

  return {
    serviceName: values.get("Id") ?? "openclaw-gateway.service",
    activeState: values.get("ActiveState") ?? "unknown",
    subState: values.get("SubState") ?? "unknown",
    unitFileState: values.get("UnitFileState") ?? "unknown",
    mainPid: Number.isFinite(mainPid) && mainPid > 0 ? mainPid : null,
    startedAt: values.get("ActiveEnterTimestamp") || null,
    fragmentPath: values.get("FragmentPath") || null,
  };
}

async function readStatus(serviceName: string): Promise<OpenClawAdminBridgeStatus> {
  const { stdout } = await execFileAsync("systemctl", [
    "--user",
    "show",
    serviceName,
    "--property=Id,ActiveState,SubState,UnitFileState,MainPID,ActiveEnterTimestamp,FragmentPath",
    "--no-pager",
  ]);
  return parseSystemctlShow(stdout);
}

async function runAction(serviceName: string, action: OpenClawServiceAction): Promise<void> {
  await execFileAsync("systemctl", ["--user", action, serviceName, "--no-pager"]);
}

export function createOpenClawAdminBridge(config: OpenClawAdminBridgeConfig) {
  return createServer(async (request, reply) => {
    if (request.url === "/health" && request.method === "GET") {
      respondJson(reply, 200, { ok: true });
      return;
    }

    if (!isAuthorized(request, config.bearerToken)) {
      respondJson(reply, 401, { error: "UNAUTHORIZED" });
      return;
    }

    try {
      if (request.url === "/status" && request.method === "GET") {
        respondJson(reply, 200, await readStatus(config.serviceName));
        return;
      }

      const actionMatch = request.url?.match(/^\/actions\/(start|stop|restart)$/);
      if (actionMatch && request.method === "POST") {
        const action = actionMatch[1] as OpenClawServiceAction;
        await runAction(config.serviceName, action);
        respondJson(reply, 200, await readStatus(config.serviceName));
        return;
      }

      respondJson(reply, 404, { error: "NOT_FOUND" });
    } catch (error) {
      respondJson(reply, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}
