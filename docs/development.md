# Development

## Requirements

- Node.js 22+
- npm
- PostgreSQL 16+ for the real runtime path

## Install

```bash
npm install
cp .env.example .env
```

Set real values in `.env`.

## Build

```bash
npm run build
```

## Run locally

Web process:

```bash
npm run start:web
```

Worker process:

```bash
npm run start:worker
```

Run them in separate terminals.

## Local Postgres

For local development:

```bash
docker run --rm \
  --name agentos-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=agentos \
  -p 5432:5432 \
  postgres:16-alpine
```

Then use:

```text
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentos
```

This `127.0.0.1` value is for local host development only.
Do not use it inside the Docker Compose stack.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AGENTOS_OWNER_PASSWORD` | single-owner app login password |
| `AGENTOS_COOKIE_SECRET` | cookie signing secret |
| `AGENTOS_HEARTBEAT_INTERVAL_MS` | worker lease heartbeat interval |
| `AGENTOS_LEASE_DURATION_MS` | lease expiry threshold |
| `AGENTOS_PROJECTION_LAG_THRESHOLD_MS` | stale projection threshold |
| `AGENTOS_PROJECTION_NAME` | projection watermark identity |
| `AGENTOS_DATA_DIR` | local artifact/data directory |
| `AGENTOS_ASSISTANT_ID` | canonical assistant identity string |

## Tests

Run the standard test suite:

```bash
npm test
```

Run the Postgres-backed drill suite:

```bash
npm run test:postgres
```

`test:postgres` requires `DATABASE_URL`.

## Important Code Paths

- `src/domain/kernel.ts`
  - lifecycle authority
- `src/db/postgres.ts`
  - Postgres persistence
- `src/worker/agent-worker.ts`
  - worker loop
- `src/web/create-server.ts`
  - API surface
- `src/services/assistant-service.ts`
  - lane classification and turn handling
- `src/skills/healthcheck.ts`
  - current governed skill

## Development Guardrails

- Do not let the UI or worker mutate canonical lifecycle state directly.
- Do not widen Phase 1 into a workflow builder.
- Do not add OpenClaw as a runtime dependency in the Phase 1 core path.
- Preserve the chat lane / mission lane separation.
