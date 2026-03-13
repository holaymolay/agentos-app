import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type ApprovalQueueItem,
  type ConversationMessage,
  type MissionDetail,
  type MissionSummary,
  type OpenClawStatus,
  type OverviewHealth,
} from "./api";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function LoginGate({ onReady }: { onReady: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.login(password);
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>AgentOS Mission Control</h1>
        <p>Owner-only operator console for one assistant identity and one governed mission engine.</p>
        <label className="field">
          <span>Owner password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <div className="error-text">{error}</div> : null}
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="primary" type="submit">Enter Mission Control</button>
        </div>
      </form>
    </div>
  );
}

function ShellLayout(props: {
  overviewHealth: OverviewHealth | null;
  missions: MissionSummary[];
  approvals: ApprovalQueueItem[];
  recentConversation: ConversationMessage[];
  refresh: () => Promise<void>;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">AgentOS</div>
        <div className="brand-sub">One assistant. One mission kernel.</div>
        <nav className="nav">
          <NavLink to="/assistant">Assistant</NavLink>
          <NavLink to="/overview">Overview</NavLink>
          <NavLink to="/approvals">Approvals</NavLink>
          <NavLink to="/openclaw">OpenClaw</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/assistant" element={<AssistantPage recentConversation={props.recentConversation} refresh={props.refresh} />} />
          <Route path="/overview" element={<OverviewPage overviewHealth={props.overviewHealth} missions={props.missions} approvals={props.approvals} />} />
          <Route path="/approvals" element={<ApprovalsPage approvals={props.approvals} refresh={props.refresh} />} />
          <Route path="/openclaw" element={<OpenClawPage />} />
          <Route path="/missions/:missionId" element={<MissionDetailPage />} />
          <Route path="*" element={<AssistantPage recentConversation={props.recentConversation} refresh={props.refresh} />} />
        </Routes>
      </main>
    </div>
  );
}

function AssistantPage({ recentConversation, refresh }: { recentConversation: ConversationMessage[]; refresh: () => Promise<void> }) {
  const [content, setContent] = useState("Run a healthcheck on the runtime.");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitTurn(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.submitTurn(content);
      setContent("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Assistant</h1>
          <p className="page-subtitle">Fast chat lane by default. Explicit mission escalation when the request becomes consequential.</p>
        </div>
      </header>
      <div className="panel">
        <div className="chat-thread">
          {recentConversation.length === 0 ? <div className="empty-state">No conversation yet.</div> : recentConversation.map((message) => (
            <div className={`chat-bubble ${message.role}`} key={message.messageId}>
              <div className="chat-header">
                <span>{message.role === "user" ? "Operator" : "Assistant"}</span>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              <div>{message.content}</div>
              {message.missionId ? (
                <div style={{ marginTop: 10 }}>
                  <NavLink className="inline-link" to={`/missions/${message.missionId}`}>Open mission {message.missionId}</NavLink>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <form className="chat-composer" onSubmit={submitTurn}>
          <label className="field">
            <span>New request</span>
            <textarea rows={4} value={content} onChange={(event) => setContent(event.target.value)} />
          </label>
          {error ? <div className="error-text">{error}</div> : null}
          <div className="actions">
            <button className="primary" disabled={pending} type="submit">{pending ? "Submitting..." : "Send"}</button>
            <button className="secondary" type="button" onClick={() => refresh()}>Refresh</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OverviewPage({ overviewHealth, missions, approvals }: { overviewHealth: OverviewHealth | null; missions: MissionSummary[]; approvals: ApprovalQueueItem[] }) {
  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Mission-lane work only. Canonical summaries with visible projection freshness.</p>
        </div>
        {overviewHealth?.isStale ? <div className="stale-pill">Projection stale: {overviewHealth.projectionLagEvents} event(s)</div> : null}
      </header>
      <div className="stat-grid">
        <div className="stat"><div className="stat-label">Active missions</div><div className="stat-value">{overviewHealth?.activeMissionCount ?? 0}</div></div>
        <div className="stat"><div className="stat-label">Blocked approvals</div><div className="stat-value">{overviewHealth?.blockedApprovalCount ?? 0}</div></div>
        <div className="stat"><div className="stat-label">Failed missions</div><div className="stat-value">{overviewHealth?.failedMissionCount ?? 0}</div></div>
        <div className="stat"><div className="stat-label">Queue health</div><div className="stat-value">{approvals.length === 0 ? "Clear" : "Action"}</div></div>
      </div>
      <div className="panel table-list">
        {missions.length === 0 ? <div className="empty-state">No governed missions yet.</div> : missions.map((mission) => (
          <div className="table-row" key={mission.missionId}>
            <div className="row-top">
              <div>
                <div><NavLink className="inline-link" to={`/missions/${mission.missionId}`}>{mission.summary}</NavLink></div>
                <div className="row-meta">{mission.missionId} · {mission.skillVersionId}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="status-pill">{mission.status}</span>
                <span className="risk-pill">{mission.riskTier}</span>
              </div>
            </div>
            <div className="meta-line">Updated {formatTime(mission.lastUpdatedAt)} {mission.operatorActionNeeded ? "· operator action needed" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApprovalsPage({ approvals, refresh }: { approvals: ApprovalQueueItem[]; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(approvalRequestId: string, decision: "approve" | "deny") {
    setBusy(`${approvalRequestId}:${decision}`);
    setError(null);
    try {
      await api.resolveApproval(approvalRequestId, decision);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <p className="page-subtitle">High-signal queue for explicit operator authorization.</p>
        </div>
      </header>
      {error ? <div className="error-text">{error}</div> : null}
      <div className="panel table-list">
        {approvals.length === 0 ? <div className="empty-state">No pending approvals.</div> : approvals.map((approval) => (
          <div className="approval-item" key={approval.approvalRequestId}>
            <div className="row-top">
              <div>
                <div>{approval.requestedAction}</div>
                <div className="row-meta">Mission <NavLink className="inline-link" to={`/missions/${approval.missionId}`}>{approval.missionId}</NavLink></div>
              </div>
              <span className="risk-pill">{approval.riskTier}</span>
            </div>
            <div>{approval.rationale}</div>
            <div className="meta-line">Evidence: {approval.evidencePreview.join(", ") || "n/a"}</div>
            <div className="actions">
              <button className="primary" disabled={busy !== null} onClick={() => resolve(approval.approvalRequestId, "approve")}>Approve</button>
              <button className="danger" disabled={busy !== null} onClick={() => resolve(approval.approvalRequestId, "deny")}>Deny</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenClawPage() {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setError(null);
    try {
      setStatus(await api.getOpenClawStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function performAction(action: "start" | "stop" | "restart") {
    setBusy(action);
    setError(null);
    try {
      setStatus(await api.controlOpenClaw(action));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">OpenClaw</h1>
          <p className="page-subtitle">Service status and bounded lifecycle control for Roger&apos;s runtime.</p>
        </div>
      </header>
      {error ? <div className="error-text">{error}</div> : null}
      <div className="detail-grid">
        <div className="stacked">
          <div className="detail-card">
            <div className="row-top">
              <strong>Service status</strong>
              <span className="status-pill">{status?.configured ? `${status.activeState} / ${status.subState}` : "unconfigured"}</span>
            </div>
            <div className="meta-line">Unit: {status?.serviceName ?? "openclaw-gateway.service"}</div>
            <div className="meta-line">Unit file: {status?.unitFileState ?? "unknown"}</div>
            <div className="meta-line">Main PID: {status?.mainPid ?? "n/a"}</div>
            <div className="meta-line">Started: {status?.startedAt ?? "n/a"}</div>
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="primary" disabled={busy !== null || !status?.configured} onClick={() => performAction("start")}>Start</button>
              <button className="secondary" disabled={busy !== null || !status?.configured} onClick={() => performAction("restart")}>Restart</button>
              <button className="danger" disabled={busy !== null || !status?.configured} onClick={() => performAction("stop")}>Stop</button>
              <button className="secondary" disabled={busy !== null} onClick={() => void loadStatus()}>Refresh</button>
            </div>
          </div>
          <div className="detail-card">
            <strong>Portal wiring</strong>
            {status?.configured ? (
              <>
                <div className="meta-line" style={{ marginTop: 8 }}>Host admin bridge is configured and reachable through AgentOS.</div>
                {status.dashboardUrl ? (
                  <div style={{ marginTop: 12 }}>
                    <a className="inline-link" href={status.dashboardUrl} rel="noreferrer" target="_blank">Open Roger web UI</a>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state" style={{ marginTop: 12 }}>
                OpenClaw admin bridge is not configured yet. Set the OpenClaw admin bridge URL and token in AgentOS, then point the web container at the host bridge.
              </div>
            )}
          </div>
        </div>
        <div className="stacked">
          <div className="detail-card">
            <strong>What this controls</strong>
            <div className="meta-line" style={{ marginTop: 8 }}>
              These actions only manage the host OpenClaw gateway service. They do not replace Mission Control, and they do not grant arbitrary shell access from the portal.
            </div>
          </div>
          <div className="detail-card">
            <strong>Bridge details</strong>
            <div className="meta-line" style={{ marginTop: 8 }}>Fragment path: {status?.fragmentPath ?? "n/a"}</div>
            <div className="meta-line">Dashboard URL: {status?.dashboardUrl ?? "not configured"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MissionDetailPage() {
  const { missionId = "" } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getMission(missionId)
      .then((payload) => {
        if (active) {
          setDetail(payload);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [missionId]);

  if (error) {
    return <div className="error-text">{error}</div>;
  }

  if (!detail) {
    return <div className="panel">Loading mission detail...</div>;
  }

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Mission Detail</h1>
          <p className="page-subtitle">Canonical mission state, evidence, approvals, and timeline.</p>
        </div>
        <button className="secondary" onClick={() => navigate(-1)}>Back</button>
      </header>
      <div className="detail-grid">
        <div className="stacked">
          <div className="detail-card">
            <strong>{detail.mission.summary}</strong>
            <div className="meta-line" style={{ marginTop: 8 }}>{detail.mission.missionId}</div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="status-pill">{detail.mission.status}</span>
              <span className="risk-pill">{detail.mission.riskTier}</span>
            </div>
            {detail.failureSummary ? <div className="error-text">{detail.failureSummary}</div> : null}
          </div>
          <div className="detail-card">
            <strong>Approvals</strong>
            <div className="stacked" style={{ marginTop: 12 }}>
              {detail.approvals.length === 0 ? <div className="meta-line">No approval history.</div> : detail.approvals.map((approval) => (
                <div key={approval.approvalRequestId}>
                  <div>{approval.actionSummary}</div>
                  <div className="meta-line">{approval.status}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="detail-card">
            <strong>Artifacts</strong>
            <div className="stacked" style={{ marginTop: 12 }}>
              {detail.artifacts.length === 0 ? <div className="meta-line">No artifacts yet.</div> : detail.artifacts.map((artifact) => (
                <div key={artifact.artifactId}>
                  <a className="inline-link" href={artifact.uri.replace(/^.*\/artifacts/, "/artifacts")}>{artifact.artifactType}</a>
                  <div className="meta-line">{artifact.promoted ? "Promoted" : "Recorded only"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="stacked">
          <div className="detail-card">
            <strong>Steps</strong>
            <div className="timeline" style={{ marginTop: 12 }}>
              {detail.steps.map((step) => (
                <div className="timeline-item" key={step.stepId}>
                  <div className="row-top">
                    <div>{step.stepKey}</div>
                    <span className="status-pill">{step.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="detail-card">
            <strong>Event timeline</strong>
            <div className="timeline" style={{ marginTop: 12 }}>
              {detail.events.map((event) => (
                <div className="timeline-item" key={event.sequence}>
                  <div className="row-top">
                    <div>{event.eventType}</div>
                    <div className="meta-line">#{event.sequence}</div>
                  </div>
                  <div className="meta-line">{formatTime(event.ts)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [stream, setStream] = useState<{
    overviewHealth: OverviewHealth | null;
    missions: MissionSummary[];
    approvals: ApprovalQueueItem[];
    recentConversation: ConversationMessage[];
  }>({ overviewHealth: null, missions: [], approvals: [], recentConversation: [] });

  async function refresh() {
    const payload = await api.getStream();
    setStream(payload);
  }

  useEffect(() => {
    let mounted = true;
    api.me().then((payload) => {
      if (mounted) {
        setReady(payload.authenticated);
      }
    }).catch(() => {
      if (mounted) {
        setReady(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [ready]);

  const shell = useMemo(
    () => <ShellLayout overviewHealth={stream.overviewHealth} missions={stream.missions} approvals={stream.approvals} recentConversation={stream.recentConversation} refresh={refresh} />,
    [stream],
  );

  if (!ready) {
    return <LoginGate onReady={() => setReady(true)} />;
  }

  return <BrowserRouter>{shell}</BrowserRouter>;
}
