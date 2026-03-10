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
./scripts/deploy.sh
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

1. off-host backup automation
2. rollback procedure
3. minimal uptime / container-health monitoring

## Backups

The repository now includes a local backup script:

```bash
cd /opt/agentos-app
./scripts/backup.sh
```

By default it creates a timestamped backup directory under:

```text
./backups/<UTC_TIMESTAMP>/
```

Each backup includes:

- `postgres.dump`
- `agentos-data.tgz`
- `.env`
- `SHA256SUMS`
- basic metadata such as `manifest.txt` and `compose.ps.txt`

You can choose a different output root:

```bash
BACKUP_ROOT=/srv/agentos-backups ./scripts/backup.sh
```

At minimum, backup:

- Postgres data
- `agentos_data` artifact volume
- `.env`

Do not store `.env` in Git.

A same-host backup is only an operational convenience. It is not disaster recovery.

After each backup, copy the backup directory off-host to a password-protected system or object store you control.

## Restore Basics

Restore is destructive. Treat it like an incident action, not a casual command.

Minimum safe sequence:

1. stop the app containers so nothing is writing during restore
2. restore artifact data
3. restore the database dump
4. restart the stack
5. validate login, Overview, Approvals, and one governed mission path

Example restore flow:

```bash
cd /opt/agentos-app
docker compose stop web worker
docker compose run --rm --no-deps web sh -lc 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
cat backups/20260309T000000Z/agentos-data.tgz | docker compose run --rm --no-deps web sh -lc 'tar -xzf - -C /app'
cat backups/20260309T000000Z/postgres.dump | docker compose exec -T postgres sh -lc 'pg_restore -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" --clean --if-exists --no-owner'
docker compose up -d
docker compose ps
```

If you need to restore the application secrets too, replace `.env` manually from the backup before starting the stack again.

Before restoring in anger, create one fresh backup of the current state so you have a rollback point.

## Rollback

The repository now includes a simple rollback path:

```bash
cd /opt/agentos-app
./scripts/rollback.sh
```

Default behavior:

- reads the previous deployed commit from `.agentos-state/previous-deploy.txt`
- checks out that commit
- rebuilds the stack
- prints container status

You can also roll back to an explicit commit or tag:

```bash
./scripts/rollback.sh <git-ref>
```

## Controlled Deploys

Use the deploy script instead of ad hoc `git pull` plus rebuilds:

```bash
cd /opt/agentos-app
./scripts/deploy.sh
```

Default behavior:

- refuses to run if the repo has tracked local changes
- records the previously deployed commit
- runs `./scripts/backup.sh` first
- fast-forwards `main` from `origin/main`
- rebuilds and starts the stack

You can deploy an explicit commit or tag:

```bash
./scripts/deploy.sh <git-ref>
```

If you absolutely need to skip the pre-deploy backup, set:

```bash
AGENTOS_SKIP_BACKUP=1 ./scripts/deploy.sh
```

Do not make a habit of skipping backups.

## Monitoring

Not formalized yet.

Minimum reasonable future coverage:

- external HTTPS uptime check
- alert on repeated container restarts
- alert on app unavailability
