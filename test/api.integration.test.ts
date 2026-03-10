import { afterEach, describe, expect, it } from "vitest";
import { createTestRuntime, createTestServer, processUntilApproval } from "./test-helpers.js";

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (closeServer) {
    await closeServer();
    closeServer = null;
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
  });
});
