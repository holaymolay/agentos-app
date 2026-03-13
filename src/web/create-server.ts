import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { AgentOsRuntime } from "../bootstrap.js";
import type { ApprovalDecision, HealthcheckMissionInput, OpenClawServiceAction } from "../shared/types.js";

const approvalDecisions = new Set<ApprovalDecision>(["approve", "deny"]);
const openClawActions = new Set<OpenClawServiceAction>(["start", "stop", "restart"]);

function buildMissionUrl(baseUrl: string | null, missionId: string | null): string | null {
  if (!baseUrl || !missionId) {
    return null;
  }
  return `${baseUrl.replace(/\/$/, "")}/missions/${missionId}`;
}

function isBridgeRoute(url: string): boolean {
  return (
    url === "/api/bridge/turns" ||
    url === "/api/bridge/approvals" ||
    url === "/api/bridge/overview" ||
    url.startsWith("/api/bridge/missions/")
  );
}

export async function createServer(runtime: AgentOsRuntime) {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: runtime.config.cookieSecret });

  const publicDir = path.resolve(process.cwd(), "dist/public");
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      decorateReply: false,
    });
  }
  await app.register(fastifyStatic, {
    root: runtime.config.artifactsDir,
    prefix: "/artifacts/",
    decorateReply: false,
  });

  app.addHook("preHandler", async (request, reply) => {
    if (
      request.url.startsWith("/api/auth/login") ||
      request.url.startsWith("/api/auth/me") ||
      isBridgeRoute(request.url)
    ) {
      return;
    }
    if (!request.url.startsWith("/api")) {
      return;
    }
    const token = request.cookies.agentos_session;
    if (!runtime.authService.isAuthenticated(token)) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as { password?: string };
    const token = runtime.authService.login(body.password ?? "");
    if (!token) {
      reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      return;
    }
    reply.setCookie("agentos_session", token, { path: "/", httpOnly: true, sameSite: "lax" });
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (request) => ({ authenticated: runtime.authService.isAuthenticated(request.cookies.agentos_session) }));

  app.post("/api/assistant/turns", async (request, reply) => {
    const body = (request.body ?? {}) as { content?: string; missionInput?: HealthcheckMissionInput };
    if (!body.content?.trim()) {
      reply.code(400).send({ error: "CONTENT_REQUIRED" });
      return;
    }
    const result = await runtime.assistantService.submitUserTurn({
      content: body.content,
      requestedBy: "owner",
      interfaceChannel: "web",
      missionInput: body.missionInput,
    });
    reply.send(result);
  });

  app.post("/api/bridge/turns", async (request, reply) => {
    if (!runtime.authService.isBridgeEnabled()) {
      reply.code(503).send({ error: "BRIDGE_DISABLED" });
      return;
    }
    if (!runtime.authService.isBridgeAuthenticated(request.headers.authorization)) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }

    const body = (request.body ?? {}) as {
      content?: string;
      requestedBy?: string;
      interfaceChannel?: string;
      missionInput?: HealthcheckMissionInput;
    };

    if (!body.content?.trim()) {
      reply.code(400).send({ error: "CONTENT_REQUIRED" });
      return;
    }

    const result = await runtime.assistantService.submitUserTurn({
      content: body.content,
      requestedBy: body.requestedBy?.trim() || "bridge",
      interfaceChannel: body.interfaceChannel?.trim() || "bridge",
      missionInput: body.missionInput,
    });

    reply.send({
      ...result,
      missionUrl: buildMissionUrl(runtime.config.publicBaseUrl, result.missionId),
    });
  });

  app.get("/api/bridge/missions/:missionId", async (request, reply) => {
    if (!runtime.authService.isBridgeEnabled()) {
      reply.code(503).send({ error: "BRIDGE_DISABLED" });
      return;
    }
    if (!runtime.authService.isBridgeAuthenticated(request.headers.authorization)) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }

    const params = request.params as { missionId: string };
    const detail = await runtime.kernel.getMissionDetail(params.missionId);
    if (!detail) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }

    reply.send({
      missionId: detail.mission.missionId,
      summary: detail.mission.summary,
      status: detail.mission.status,
      riskTier: detail.mission.riskTier,
      missionUrl: buildMissionUrl(runtime.config.publicBaseUrl, detail.mission.missionId),
      operatorActionNeeded: detail.approvals.some((approval) => approval.status === "PENDING"),
      approvalSummary: detail.approvals.map((approval) => ({
        approvalRequestId: approval.approvalRequestId,
        actionSummary: approval.actionSummary,
        riskTier: approval.riskTier,
        status: approval.status,
      })),
      artifactSummary: detail.artifacts.map((artifact) => ({
        artifactType: artifact.artifactType,
        promoted: artifact.promoted,
      })),
      stepSummary: detail.steps.map((step) => ({
        stepKey: step.stepKey,
        status: step.status,
      })),
      failureSummary: detail.failureSummary,
    });
  });

  app.get("/api/bridge/approvals", async (request, reply) => {
    if (!runtime.authService.isBridgeEnabled()) {
      reply.code(503).send({ error: "BRIDGE_DISABLED" });
      return;
    }
    if (!runtime.authService.isBridgeAuthenticated(request.headers.authorization)) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }

    const approvals = await runtime.kernel.listApprovalQueue();
    reply.send({
      count: approvals.length,
      approvals: approvals.map((approval) => ({
        approvalRequestId: approval.approvalRequestId,
        missionId: approval.missionId,
        missionUrl: buildMissionUrl(runtime.config.publicBaseUrl, approval.missionId),
        requestedAction: approval.requestedAction,
        rationale: approval.rationale,
        riskTier: approval.riskTier,
        requestedAt: approval.requestedAt,
        status: approval.status,
      })),
    });
  });

  app.get("/api/bridge/overview", async (request, reply) => {
    if (!runtime.authService.isBridgeEnabled()) {
      reply.code(503).send({ error: "BRIDGE_DISABLED" });
      return;
    }
    if (!runtime.authService.isBridgeAuthenticated(request.headers.authorization)) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }

    const [overviewHealth, missions, approvals] = await Promise.all([
      runtime.kernel.getOverviewHealth(),
      runtime.kernel.listMissionSummaries(),
      runtime.kernel.listApprovalQueue(),
    ]);

    const countsByStatus = missions.reduce<Record<string, number>>((acc, mission) => {
      acc[mission.status] = (acc[mission.status] ?? 0) + 1;
      return acc;
    }, {});

    const recentMissions = [...missions]
      .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt))
      .slice(0, 5)
      .map((mission) => ({
        missionId: mission.missionId,
        summary: mission.summary,
        status: mission.status,
        riskTier: mission.riskTier,
        operatorActionNeeded: mission.operatorActionNeeded,
        lastUpdatedAt: mission.lastUpdatedAt,
        missionUrl: buildMissionUrl(runtime.config.publicBaseUrl, mission.missionId),
      }));

    reply.send({
      overviewHealth,
      missionCount: missions.length,
      pendingApprovalCount: approvals.length,
      countsByStatus,
      recentMissions,
    });
  });

  app.get("/api/missions", async () => runtime.kernel.listMissionSummaries());

  app.get("/api/missions/:missionId", async (request, reply) => {
    const params = request.params as { missionId: string };
    const detail = await runtime.kernel.getMissionDetail(params.missionId);
    if (!detail) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(detail);
  });

  app.get("/api/approvals", async () => runtime.kernel.listApprovalQueue());

  app.post("/api/approvals/:approvalRequestId/resolve", async (request, reply) => {
    const params = request.params as { approvalRequestId: string };
    const body = (request.body ?? {}) as { decision?: string };
    if (!body.decision) {
      reply.code(400).send({ error: "DECISION_REQUIRED" });
      return;
    }
    if (!approvalDecisions.has(body.decision as ApprovalDecision)) {
      reply.code(400).send({ error: "INVALID_DECISION" });
      return;
    }
    const resolved = await runtime.kernel.resolveApproval(params.approvalRequestId, body.decision as ApprovalDecision, "owner");
    await runtime.kernel.projectCommittedEvents();
    if (!resolved) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(resolved);
  });

  app.get("/api/overview", async () => {
    const [overviewHealth, missions, approvals] = await Promise.all([
      runtime.kernel.getOverviewHealth(),
      runtime.kernel.listMissionSummaries(),
      runtime.kernel.listApprovalQueue(),
    ]);
    return { overviewHealth, missions, approvals };
  });

  app.get("/api/openclaw/status", async (request, reply) => {
    try {
      reply.send(await runtime.openClawAdminService.getStatus());
    } catch (error) {
      reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/openclaw/:action", async (request, reply) => {
    const params = request.params as { action: string };
    if (!openClawActions.has(params.action as OpenClawServiceAction)) {
      reply.code(400).send({ error: "INVALID_ACTION" });
      return;
    }

    try {
      const status = await runtime.openClawAdminService.performAction(params.action as OpenClawServiceAction);
      reply.send(status);
    } catch (error) {
      if (error instanceof Error && error.message === "OPENCLAW_ADMIN_UNCONFIGURED") {
        reply.code(503).send({ error: "OPENCLAW_ADMIN_UNCONFIGURED" });
        return;
      }
      reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/stream", async () => {
    const [overviewHealth, missions, approvals, recentConversation] = await Promise.all([
      runtime.kernel.getOverviewHealth(),
      runtime.kernel.listMissionSummaries(),
      runtime.kernel.listApprovalQueue(),
      runtime.kernel.getRecentConversationMessages(20),
    ]);
    return { overviewHealth, missions, approvals, recentConversation };
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/artifacts/")) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    if (!fs.existsSync(publicDir)) {
      reply.code(404).send({ error: "UI_NOT_BUILT" });
      return;
    }
    reply.type("text/html").send(fs.readFileSync(path.join(publicDir, "index.html"), "utf8"));
  });

  return app;
}
