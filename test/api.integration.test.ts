import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, createTestServer, processUntilApproval } from "./test-helpers.js";
import type { OpenClawAdminBridgeStatus } from "../src/shared/types.js";

let closeServer: (() => Promise<void>) | null = null;
let closeBridgeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
  if (closeBridgeServer) {
    await closeBridgeServer();
    closeBridgeServer = null;
  }
});

describe("api integration", () => {
  it("requires owner login and serves the main MVP flows", async () => {
    const runtime = await createTestRuntime();
    const app = await createTestServer(runtime);
    closeServer = () => app.close();

    const unauthenticated = await app.inject({ method: "GET", url: "/api/overview" });
    expect(unauthenticated.statusCode).toBe(401);

    const badLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "wrong-password" },
    });
    expect(badLogin.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "dev-test-password" },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((item) => item.name === "agentos_session");
    expect(cookie?.value).toBeTruthy();

    const chatTurn = await app.inject({
      method: "POST",
      url: "/api/assistant/turns",
      headers: { cookie: `agentos_session=${cookie?.value}` },
      payload: { content: "Explain the lane boundary." },
    });
    expect(chatTurn.statusCode).toBe(200);
    expect(chatTurn.json().lane).toBe("chat");

    const missionTurn = await app.inject({
      method: "POST",
      url: "/api/assistant/turns",
      headers: { cookie: `agentos_session=${cookie?.value}` },
      payload: { content: "Run a healthcheck on the runtime." },
    });
    expect(missionTurn.statusCode).toBe(200);
    const missionPayload = missionTurn.json();
    expect(missionPayload.lane).toBe("mission");
    expect(missionPayload.missionId).toBeTruthy();

    const overview = await app.inject({
      method: "GET",
      url: "/api/overview",
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().missions).toHaveLength(1);

    const detail = await app.inject({
      method: "GET",
      url: `/api/missions/${missionPayload.missionId}`,
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().mission.missionId).toBe(missionPayload.missionId);
  });

  it("rejects fake defer approvals and does not expose a worker trigger endpoint", async () => {
    const runtime = await createTestRuntime();
    const app = await createTestServer(runtime);
    closeServer = () => app.close();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "dev-test-password" },
    });
    const cookie = login.cookies.find((item) => item.name === "agentos_session");

    const missionTurn = await app.inject({
      method: "POST",
      url: "/api/assistant/turns",
      headers: { cookie: `agentos_session=${cookie?.value}` },
      payload: {
        content: "Run a healthcheck on the runtime.",
        missionInput: { forceRemediation: true },
      },
    });
    const missionId = missionTurn.json().missionId as string;
    const approvalRequestId = await processUntilApproval(runtime, missionId);

    const invalidDecision = await app.inject({
      method: "POST",
      url: `/api/approvals/${approvalRequestId}/resolve`,
      headers: { cookie: `agentos_session=${cookie?.value}` },
      payload: { decision: "defer" },
    });
    expect(invalidDecision.statusCode).toBe(400);
    expect(invalidDecision.json().error).toBe("INVALID_DECISION");

    const workerRoute = await app.inject({
      method: "POST",
      url: "/api/worker/run-once",
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(workerRoute.statusCode).toBe(404);
  });

  it("accepts machine-auth bridge turns and returns mission URLs when configured", async () => {
    const runtime = await createTestRuntime({
      bridgeToken: "dev-bridge-token-123456",
      publicBaseUrl: "https://app.rogerroger.ai",
    });
    const app = await createTestServer(runtime);
    closeServer = () => app.close();

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/bridge/turns",
      payload: { content: "Explain the lane boundary." },
    });
    expect(unauthorized.statusCode).toBe(401);

    const chatTurn = await app.inject({
      method: "POST",
      url: "/api/bridge/turns",
      headers: { authorization: "Bearer dev-bridge-token-123456" },
      payload: {
        content: "Explain the lane boundary.",
        requestedBy: "telegram:1348625485",
        interfaceChannel: "telegram",
      },
    });
    expect(chatTurn.statusCode).toBe(200);
    expect(chatTurn.json()).toMatchObject({
      lane: "chat",
      missionId: null,
      missionUrl: null,
    });

    const missionTurn = await app.inject({
      method: "POST",
      url: "/api/bridge/turns",
      headers: { authorization: "Bearer dev-bridge-token-123456" },
      payload: {
        content: "Run a healthcheck on the runtime.",
        requestedBy: "telegram:1348625485",
        interfaceChannel: "telegram",
      },
    });
    expect(missionTurn.statusCode).toBe(200);
    expect(missionTurn.json()).toMatchObject({
      lane: "mission",
      missionUrl: expect.stringContaining("/missions/"),
    });

    const missionId = missionTurn.json().missionId as string;

    const unauthorizedDetail = await app.inject({
      method: "GET",
      url: `/api/bridge/missions/${missionId}`,
    });
    expect(unauthorizedDetail.statusCode).toBe(401);

    const missionDetail = await app.inject({
      method: "GET",
      url: `/api/bridge/missions/${missionId}`,
      headers: { authorization: "Bearer dev-bridge-token-123456" },
    });
    expect(missionDetail.statusCode).toBe(200);
    expect(missionDetail.json()).toMatchObject({
      missionId,
      status: "READY",
      missionUrl: expect.stringContaining(`/missions/${missionId}`),
      artifactSummary: [],
      operatorActionNeeded: false,
    });

    const remediationTurn = await app.inject({
      method: "POST",
      url: "/api/bridge/turns",
      headers: { authorization: "Bearer dev-bridge-token-123456" },
      payload: {
        content: "Run a healthcheck on the runtime.",
        requestedBy: "telegram:1348625485",
        interfaceChannel: "telegram",
        missionInput: { forceRemediation: true },
      },
    });
    const remediationMissionId = remediationTurn.json().missionId as string;
    await processUntilApproval(runtime, remediationMissionId);

    const unauthorizedApprovals = await app.inject({
      method: "GET",
      url: "/api/bridge/approvals",
    });
    expect(unauthorizedApprovals.statusCode).toBe(401);

    const approvalQueue = await app.inject({
      method: "GET",
      url: "/api/bridge/approvals",
      headers: { authorization: "Bearer dev-bridge-token-123456" },
    });
    expect(approvalQueue.statusCode).toBe(200);
    expect(approvalQueue.json()).toMatchObject({
      count: 1,
      approvals: [
        {
          missionId: remediationMissionId,
          missionUrl: expect.stringContaining(`/missions/${remediationMissionId}`),
          requestedAction: "Apply healthcheck remediation",
          riskTier: "medium",
          status: "PENDING",
        },
      ],
    });

    const unauthorizedOverview = await app.inject({
      method: "GET",
      url: "/api/bridge/overview",
    });
    expect(unauthorizedOverview.statusCode).toBe(401);

    const overview = await app.inject({
      method: "GET",
      url: "/api/bridge/overview",
      headers: { authorization: "Bearer dev-bridge-token-123456" },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      missionCount: 2,
      pendingApprovalCount: 1,
      countsByStatus: {
        WAITING_APPROVAL: 1,
      },
    });
    expect(overview.json().recentMissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          missionId: remediationMissionId,
          missionUrl: expect.stringContaining(`/missions/${remediationMissionId}`),
        }),
      ]),
    );
  });

  it("surfaces OpenClaw service status and controls through the owner API", async () => {
    const bridgeState: OpenClawAdminBridgeStatus = {
      serviceName: "openclaw-gateway.service",
      activeState: "active",
      subState: "running",
      unitFileState: "enabled",
      mainPid: 482_906,
      startedAt: "Thu 2026-03-12 10:00:00 UTC",
      fragmentPath: "/home/molay/.config/systemd/user/openclaw-gateway.service",
    };

    const bridge = createServer((request, reply) => {
      if (request.headers.authorization !== "Bearer dev-openclaw-admin-token") {
        reply.statusCode = 401;
        reply.end(JSON.stringify({ error: "UNAUTHORIZED" }));
        return;
      }

      if (request.method === "GET" && request.url === "/status") {
        reply.setHeader("Content-Type", "application/json");
        reply.end(JSON.stringify(bridgeState));
        return;
      }

      const action = request.url?.match(/^\/actions\/(start|stop|restart)$/)?.[1];
      if (request.method === "POST" && action) {
        if (action === "stop") {
          bridgeState.activeState = "inactive";
          bridgeState.subState = "dead";
          bridgeState.mainPid = null;
        } else {
          bridgeState.activeState = "active";
          bridgeState.subState = "running";
          bridgeState.mainPid = 900_001;
        }
        reply.setHeader("Content-Type", "application/json");
        reply.end(JSON.stringify(bridgeState));
        return;
      }

      reply.statusCode = 404;
      reply.end(JSON.stringify({ error: "NOT_FOUND" }));
    });

    await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    closeBridgeServer = async () => {
      await new Promise<void>((resolve, reject) => bridge.close((error) => (error ? reject(error) : resolve())));
    };
    const address = bridge.address() as AddressInfo;

    const runtime = await createTestRuntime({
      openClawAdminUrl: `http://127.0.0.1:${address.port}`,
      openClawAdminToken: "dev-openclaw-admin-token",
      openClawDashboardUrl: "https://roger.example.com",
    });
    const app = await createTestServer(runtime);
    closeServer = () => app.close();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "dev-test-password" },
    });
    const cookie = login.cookies.find((item) => item.name === "agentos_session");

    const status = await app.inject({
      method: "GET",
      url: "/api/openclaw/status",
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      configured: true,
      serviceName: "openclaw-gateway.service",
      activeState: "active",
      subState: "running",
      dashboardUrl: "https://roger.example.com",
    });

    const restart = await app.inject({
      method: "POST",
      url: "/api/openclaw/restart",
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(restart.statusCode).toBe(200);
    expect(restart.json()).toMatchObject({
      configured: true,
      activeState: "active",
      subState: "running",
      mainPid: 900_001,
    });

    const stop = await app.inject({
      method: "POST",
      url: "/api/openclaw/stop",
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toMatchObject({
      configured: true,
      activeState: "inactive",
      subState: "dead",
      mainPid: null,
    });

    const invalidAction = await app.inject({
      method: "POST",
      url: "/api/openclaw/reload",
      headers: { cookie: `agentos_session=${cookie?.value}` },
    });
    expect(invalidAction.statusCode).toBe(400);
    expect(invalidAction.json().error).toBe("INVALID_ACTION");
  });
});
