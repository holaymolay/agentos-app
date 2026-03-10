#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if git -C "$SCRIPT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$PROJECT_ROOT"

STATE_DIR="$PROJECT_ROOT/.agentos-state"
OPS_BIN_DIR="$STATE_DIR/bin"
COMPOSE=(docker compose)
TARGET_REF="${1:-}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_clean_worktree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing to roll back with tracked local changes in the repo." >&2
    echo "Commit, stash, or discard them first." >&2
    exit 1
  fi
}

install_ops_tools() {
  mkdir -p "$OPS_BIN_DIR"
  for tool in backup.sh deploy.sh rollback.sh check-health.sh; do
    local src="$SCRIPT_DIR/$tool"
    local dest="$OPS_BIN_DIR/$tool"
    if [[ -f "$src" && "$src" != "$dest" ]]; then
      cp "$src" "$dest"
      chmod +x "$OPS_BIN_DIR/$tool"
    fi
  done
}

require_cmd git
require_cmd docker
ensure_clean_worktree
install_ops_tools

if [[ -z "$TARGET_REF" ]]; then
  if [[ ! -f "$STATE_DIR/previous-deploy.txt" ]]; then
    echo "No recorded previous deploy. Pass a commit or tag explicitly." >&2
    exit 1
  fi
  TARGET_REF="$(<"$STATE_DIR/previous-deploy.txt")"
fi

git fetch origin --tags
CURRENT_COMMIT="$(git rev-parse HEAD)"
TARGET_COMMIT="$(git rev-parse "$TARGET_REF")"

echo "$CURRENT_COMMIT" > "$STATE_DIR/previous-deploy.txt"
git checkout --detach "$TARGET_COMMIT"
echo "$TARGET_COMMIT" > "$STATE_DIR/current-deploy.txt"

echo "Rolling back to commit $TARGET_COMMIT"
"${COMPOSE[@]}" up --build -d
"${COMPOSE[@]}" ps

echo "Rollback finished for commit $TARGET_COMMIT"
echo "Next: verify HTTPS, login, Overview, Approvals, and one governed mission path."
