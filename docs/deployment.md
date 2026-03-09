# Deployment

## Deployment Shape

Phase 1 deployment is intentionally simple:

- one VPS
- one reverse proxy
- one Docker Compose stack
- one Postgres container
- one web container
- one worker container

The recommended public shape is:

- Caddy or another reverse proxy on `80/443`
- app bound only to localhost on `127.0.0.1:3000`
- Postgres not publicly exposed

## Included Assets

The repository includes:

- `Dockerfile`
- `compose.yaml`
- `.env.example`

## First-Time Setup

```bash
cp .env.example .env
```

Set real values in `.env`.

For Docker Compose, the database host should be the Compose service name:

```text
DATABASE_URL=postgres://postgres:postgres@postgres:5432/agentos
```

Do not set the host to `127.0.0.1` inside containerized deployment.

## Start

```bash
docker compose up --build -d
```

## Check Status

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f worker
docker compose logs -f postgres
```

## Update

```bash
git pull
docker compose up --build -d
docker compose ps
```

## Stop

```bash
docker compose down
```

## Reverse Proxy

Recommended Caddy config shape:

```caddy
your-domain.example {
	reverse_proxy 127.0.0.1:3000
}
```

Recommended Compose port binding:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

This keeps the app private behind the reverse proxy.

## Persistence

The Compose stack uses named volumes:

- `postgres_data`
- `agentos_data`

These must be covered by backup planning.

## Post-Deploy Validation

Minimum checks:

1. `docker compose ps` shows all services up
2. `curl -I http://127.0.0.1:3000` succeeds on the host
3. reverse proxy returns `200` over HTTPS
4. login works
5. a diagnostics-only healthcheck mission succeeds
6. an approval-gated remediation mission succeeds

## Known Phase 1 Limits

- single owner-operator auth only
- no external channel integrations
- no horizontal scaling
- no separated worker host
- no production backup automation yet
