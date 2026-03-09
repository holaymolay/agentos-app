# AgentOS App

`agentos-app` is a TypeScript implementation of a governed assistant runtime.

The Phase 1 scope is intentionally narrow:
- one assistant identity
- one operator-only web app
- one governed mission skill: `skill.healthcheck@1.0.0`
- one approval flow
- one bounded worker runtime
- one Postgres-backed kernel as canonical state

## What It Includes

- Fastify API and cookie-authenticated operator surface
- React/Vite UI with:
  - `Assistant`
  - `Overview`
  - `Approvals`
  - `Mission Detail`
- Deterministic kernel-owned mission and step lifecycle state
- Approval requests, artifacts, append-only events, and projection views
- Single worker execution loop with leases, retries, requeue, and dead-letter handling
- Failure-drill coverage for:
  - duplicate receipts
  - lease expiry
  - approval races
  - artifact verification failure
  - read-model staleness
  - lane boundary behavior

## Documentation

- [Architecture](./docs/architecture.md)
- [Development](./docs/development.md)
- [Deployment](./docs/deployment.md)
- [Operations](./docs/operations.md)
- [Roadmap](./docs/roadmap.md)
- [Security Policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## What It Does Not Include

- multi-user auth or RBAC
- public chat-channel integrations
- generalized workflow builder
- external runtime adapters
- deployment hardening

## Architecture Shape

- `chat lane`: low-friction conversational interaction
- `mission lane`: governed execution for consequential work
- canonical truth lives in the kernel tables and kernel APIs
- workers and UI submit actions or receipts; they do not own lifecycle truth

## Requirements

- Node.js 22+
- npm
- PostgreSQL 16+ for the real runtime path

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment:

```bash
cp .env.example .env
```

3. Set real local values in `.env`.

4. Run the build:

```bash
npm run build
```

5. Start the web process:

```bash
npm run start:web
```

6. Start the worker process in a separate shell:

```bash
npm run start:worker
```

## Local PostgreSQL Example

If you want a disposable local Postgres for development:

```bash
docker run --rm \
  --name agentos-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=agentos \
  -p 5432:5432 \
  postgres:16-alpine
```

Then set:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentos
```

## Scripts

- `npm test`
  Runs the in-memory test suite.

- `npm run test:postgres`
  Runs the Postgres-backed failure drills.
  Requires `DATABASE_URL`.

- `npm run build`
  Builds the web UI and server runtime.

- `npm run start:web`
  Starts the web app from `dist/`.

- `npm run start:worker`
  Starts the worker loop from `dist/`.

## Docker

This repo includes:
- `Dockerfile`
- `compose.yaml`

The Docker setup is designed for the Phase 1 single-VPS shape:
- one `web` container
- one `worker` container
- one `postgres` container

### Run with Docker Compose

1. Copy the example environment:

```bash
cp .env.example .env
```

2. Set real values in `.env`.

3. Start the stack:

```bash
docker compose up --build -d
```

4. Check status:

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f worker
```

5. Stop the stack:

```bash
docker compose down
```

Persistent data is stored in named volumes:
- `postgres_data`
- `agentos_data`

The compose stack exposes the web app on port `3000`.
For a production VPS, put a reverse proxy such as Caddy or Nginx in front of it and do not expose Postgres publicly.

For the recommended production shape, bind the app to localhost only:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

and proxy public traffic through a reverse proxy on `80/443`.

## Repository Hygiene

Ignored by default:
- `node_modules/`
- `dist/`
- `data/`
- `.runtime-smoke/`
- `.env*`

This repo is intended to be open-sourceable without local runtime junk or private environment files.
