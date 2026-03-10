# Integrations

## OpenClaw Bridge

The first OpenClaw integration should be explicit, not magical.

Use OpenClaw as the channel/runtime front door and AgentOS as the governed
decision system behind it.

### Why the first bridge is explicit

OpenClaw plugin message hooks can observe inbound traffic and modify outbound
messages, but they do not replace the core per-turn reply path cleanly enough
for a full transparent Telegram takeover.

The thinnest real bridge is:

1. OpenClaw receives the Telegram message
2. an explicit OpenClaw command calls AgentOS
3. AgentOS decides `chat` or `mission`
4. OpenClaw relays the AgentOS reply back to Telegram

This keeps:

- OpenClaw as the channel adapter
- AgentOS as the mission/kernel authority
- Mission Control as the approval surface

### AgentOS bridge endpoint

AgentOS exposes a machine-auth endpoint for bridge clients:

```text
POST /api/bridge/turns
Authorization: Bearer <AGENTOS_BRIDGE_TOKEN>
Content-Type: application/json
```

Request body:

```json
{
  "content": "Run a healthcheck on the runtime.",
  "requestedBy": "telegram:1348625485",
  "interfaceChannel": "telegram"
}
```

Response body:

```json
{
  "lane": "mission",
  "reply": "Escalated to mission lane. Created mission mission_x for skill.healthcheck@1.0.0.",
  "missionId": "mission_x",
  "missionUrl": "https://app.example.com/missions/mission_x"
}
```

### AgentOS mission status endpoint

AgentOS also exposes a read-only mission lookup for bridge clients:

```text
GET /api/bridge/missions/:missionId
Authorization: Bearer <AGENTOS_BRIDGE_TOKEN>
```

Response body:

```json
{
  "missionId": "mission_x",
  "summary": "Healthcheck mission for: Run a healthcheck on the runtime.",
  "status": "SUCCEEDED",
  "riskTier": "medium",
  "missionUrl": "https://app.example.com/missions/mission_x",
  "operatorActionNeeded": false,
  "approvalSummary": [],
  "artifactSummary": [
    { "artifactType": "diagnostics_report", "promoted": true }
  ],
  "stepSummary": [
    { "stepKey": "collect_diagnostics", "status": "SUCCEEDED" }
  ],
  "failureSummary": null
}
```

### AgentOS approval queue endpoint

AgentOS exposes a read-only approval queue for bridge clients:

```text
GET /api/bridge/approvals
Authorization: Bearer <AGENTOS_BRIDGE_TOKEN>
```

Response body:

```json
{
  "count": 1,
  "approvals": [
    {
      "approvalRequestId": "approval_x",
      "missionId": "mission_x",
      "missionUrl": "https://app.example.com/missions/mission_x",
      "requestedAction": "Apply healthcheck remediation",
      "rationale": "Diagnostics indicate remediation is required before the mission can finish cleanly.",
      "riskTier": "medium",
      "requestedAt": "2026-03-10T07:20:00.000Z",
      "status": "PENDING"
    }
  ]
}
```

### Required environment

Set these on the AgentOS deployment:

```text
AGENTOS_BRIDGE_TOKEN=<long-random-secret>
AGENTOS_PUBLIC_BASE_URL=https://app.rogerroger.ai
```

Notes:

- `AGENTOS_BRIDGE_TOKEN` is required for machine-to-machine bridge calls.
- `AGENTOS_PUBLIC_BASE_URL` is optional but recommended so bridge clients can
  return a clickable mission URL instead of only a mission id.

### First OpenClaw command shape

The first bridge command should be explicit:

```text
/agentos Run a healthcheck on the runtime.
```

It should:

1. POST the command body to `/api/bridge/turns`
2. pass Telegram sender identity as `requestedBy`
3. relay `reply`
4. append `missionUrl` when present

The first read-only status command should:

1. parse a mission id or mission URL
2. GET `/api/bridge/missions/:missionId`
3. summarize status, approvals, artifacts, and open steps
4. return the mission URL

For Telegram, use an underscore-based command name:

```text
/agentos_status <mission_id_or_mission_url>
```

The first approval queue command should:

1. GET `/api/bridge/approvals`
2. summarize pending approvals concisely
3. include mission URLs when available

For Telegram, use:

```text
/agentos_approvals
```

Do not start with:

- transparent interception of every Telegram DM
- Telegram-native approval handling
- bidirectional mission sync

Those are later phases.
