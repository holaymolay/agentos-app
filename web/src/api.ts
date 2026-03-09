export interface AssistantTurnResult {
  lane: "chat" | "mission";
  reply: string;
  missionId: string | null;
}

export interface ConversationMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  lane: "chat" | "mission";
  missionId: string | null;
  createdAt: string;
}

export interface MissionSummary {
  missionId: string;
  summary: string;
  status: string;
  riskTier: string;
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
  riskTier: string;
  scope: Record<string, unknown>;
  evidencePreview: string[];
  requestedAt: string;
  status: string;
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
  mission: Record<string, unknown> & { missionId: string; status: string; summary: string; riskTier: string };
  steps: Array<Record<string, unknown> & { stepId: string; stepKey: string; status: string }>;
  approvals: Array<Record<string, unknown> & { approvalRequestId: string; status: string; actionSummary: string }>;
  artifacts: Array<Record<string, unknown> & { artifactId: string; artifactType: string; uri: string; promoted: boolean }>;
  events: Array<Record<string, unknown> & { sequence: number; eventType: string; ts: string }>;
  failureSummary: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  login(password: string) {
    return request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },
  me() {
    return request<{ authenticated: boolean }>("/api/auth/me");
  },
  submitTurn(content: string) {
    return request<AssistantTurnResult>("/api/assistant/turns", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  },
  getOverview() {
    return request<{ overviewHealth: OverviewHealth | null; missions: MissionSummary[]; approvals: ApprovalQueueItem[] }>("/api/overview");
  },
  getStream() {
    return request<{ overviewHealth: OverviewHealth | null; missions: MissionSummary[]; approvals: ApprovalQueueItem[]; recentConversation: ConversationMessage[] }>("/api/stream");
  },
  getMissions() {
    return request<MissionSummary[]>("/api/missions");
  },
  getMission(missionId: string) {
    return request<MissionDetail>(`/api/missions/${missionId}`);
  },
  getApprovals() {
    return request<ApprovalQueueItem[]>("/api/approvals");
  },
  resolveApproval(approvalRequestId: string, decision: "approve" | "deny") {
    return request(`/api/approvals/${approvalRequestId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  },
};
