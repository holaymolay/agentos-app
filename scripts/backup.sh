#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${1:-${BACKUP_ROOT:-$PROJECT_ROOT/backups}}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
COMPOSE=(docker compose)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd sha256sum
require_cmd cp
require_cmd mkdir
require_cmd date

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Missing $PROJECT_ROOT/.env. Refusing to create an incomplete backup." >&2
  exit 1
fi

if ! "${COMPOSE[@]}" ps >/dev/null 2>&1; then
  echo "docker compose is not available for this project. Run the script from the repo with the stack installed." >&2
  exit 1
fi

DATA_SERVICE=""
if "${COMPOSE[@]}" ps --services --status running | grep -qx 'web'; then
  DATA_SERVICE='web'
elif "${COMPOSE[@]}" ps --services --status running | grep -qx 'worker'; then
  DATA_SERVICE='worker'
else
  echo "Neither web nor worker is running, so /app/data cannot be captured safely." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Creating AgentOS backup in $BACKUP_DIR"

"${COMPOSE[@]}" ps > "$BACKUP_DIR/compose.ps.txt"
"${COMPOSE[@]}" config --services > "$BACKUP_DIR/services.txt"

if git -C "$PROJECT_ROOT" rev-parse HEAD >/dev/null 2>&1; then
  git -C "$PROJECT_ROOT" rev-parse HEAD > "$BACKUP_DIR/git-revision.txt"
fi

cat > "$BACKUP_DIR/manifest.txt" <<MANIFEST
created_at_utc=$TIMESTAMP
project_root=$PROJECT_ROOT
backup_dir=$BACKUP_DIR
data_source_service=$DATA_SERVICE
files=postgres.dump,agentos-data.tgz,.env,SHA256SUMS
MANIFEST

"${COMPOSE[@]}" exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/postgres.dump"
"${COMPOSE[@]}" exec -T "$DATA_SERVICE" sh -lc 'tar -czf - -C /app data' > "$BACKUP_DIR/agentos-data.tgz"
cp "$PROJECT_ROOT/.env" "$BACKUP_DIR/.env"
chmod 600 "$BACKUP_DIR/.env"

(
  cd "$BACKUP_DIR"
  sha256sum postgres.dump agentos-data.tgz .env > SHA256SUMS
)

echo "Backup complete: $BACKUP_DIR"
echo "Next step: copy this backup directory off-host. A same-disk backup is not disaster recovery."
