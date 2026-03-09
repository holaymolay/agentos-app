# Operations

## Day-2 Commands

Status:

```bash
cd /opt/agentos-app
docker compose ps
```

Logs:

```bash
cd /opt/agentos-app
docker compose logs -f web
docker compose logs -f worker
docker compose logs -f postgres
```

Rebuild and restart:

```bash
cd /opt/agentos-app
git pull
docker compose up --build -d
docker compose ps
```

Stop:

```bash
cd /opt/agentos-app
docker compose down
```

## What Healthy Looks Like

- reverse proxy returns `200` for the app
- `web` is up and serving on localhost
- `worker` is up and polling
- `postgres` is healthy
- `Approvals` only shows items when a mission is actually waiting for approval
- `Overview` and `Mission Detail` reflect current mission state within the projection freshness window

## Common Pitfalls

## Wrong database host in Docker

Bad:

```text
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentos
```

Inside containers, that points at the container itself and will break startup.

Correct:

```text
DATABASE_URL=postgres://postgres:postgres@postgres:5432/agentos
```

## App exposed directly on the public interface

Do not expose `3000` publicly in production.

Use:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

and terminate public traffic at Caddy or another reverse proxy.

## Empty approvals view

That is normal unless a mission hits an approval gate.

The default healthcheck path usually completes without approval.

## Immediate Next Ops Work

The next operational improvements should be:

1. backup automation
2. rollback procedure
3. minimal uptime / container-health monitoring

## Backups

Not automated yet.

At minimum, backup:

- Postgres data
- `.env`

Do not store `.env` in Git.

## Rollback

Not formalized yet.

Current practical rollback is:

1. identify the last known-good Git commit
2. check it out on the server
3. rebuild containers
4. confirm health

This should be replaced by a documented rollback procedure and, later, image pinning.

## Monitoring

Not formalized yet.

Minimum reasonable future coverage:

- external HTTPS uptime check
- alert on repeated container restarts
- alert on app unavailability
