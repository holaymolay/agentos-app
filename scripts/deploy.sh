#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

STATE_DIR="$PROJECT_ROOT/.agentos-state"
TARGET_REF="${1:-origin/main}"
COMPOSE=(docker compose)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_clean_worktree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing to deploy with tracked local changes in the repo." >&2
    echo "Commit, stash, or discard them first." >&2
    exit 1
  fi
}

require_cmd git
require_cmd docker

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  echo "Missing $PROJECT_ROOT/.env" >&2
  exit 1
fi

ensure_clean_worktree
mkdir -p "$STATE_DIR"

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
echo "$PREVIOUS_COMMIT" > "$STATE_DIR/previous-deploy.txt"

if [[ "${AGENTOS_SKIP_BACKUP:-0}" != "1" ]]; then
  "$PROJECT_ROOT/scripts/backup.sh"
fi

git fetch origin --tags

if [[ "$TARGET_REF" == "origin/main" || "$TARGET_REF" == "main" ]]; then
  if [[ -z "$(git branch --show-current)" ]]; then
    git checkout main
  fi
  git pull --ff-only origin main
else
  TARGET_COMMIT="$(git rev-parse "$TARGET_REF")"
  git checkout --detach "$TARGET_COMMIT"
fi

CURRENT_COMMIT="$(git rev-parse HEAD)"
echo "$CURRENT_COMMIT" > "$STATE_DIR/current-deploy.txt"

echo "Deploying commit $CURRENT_COMMIT"
"${COMPOSE[@]}" up --build -d
"${COMPOSE[@]}" ps

echo "Deployment finished for commit $CURRENT_COMMIT"
echo "Next: verify HTTPS, login, Overview, Approvals, and one governed mission path."
