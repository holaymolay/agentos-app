#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if git -C "$SCRIPT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$PROJECT_ROOT"

COMPOSE=(docker compose)
LOCAL_URL="${AGENTOS_LOCAL_HEALTH_URL:-http://127.0.0.1:3000/api/auth/me}"
PUBLIC_URL="${AGENTOS_PUBLIC_HEALTH_URL:-}"
EXPECTED_SERVICES=(postgres web worker)

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd curl

running_services="$("${COMPOSE[@]}" ps --services --status running)"
for service in "${EXPECTED_SERVICES[@]}"; do
  if ! grep -qx "$service" <<<"$running_services"; then
    echo "FAIL service not running: $service" >&2
    exit 1
  fi
  echo "OK service running: $service"
done

local_status="$(curl -fsS -o /tmp/agentos-local-health.$$ -w '%{http_code}' "$LOCAL_URL")"
if [[ "$local_status" != "200" ]]; then
  echo "FAIL local health returned $local_status from $LOCAL_URL" >&2
  rm -f /tmp/agentos-local-health.$$
  exit 1
fi
echo "OK local health: $LOCAL_URL ($local_status)"
rm -f /tmp/agentos-local-health.$$

if [[ -n "$PUBLIC_URL" ]]; then
  public_status="$(curl -fsS -o /tmp/agentos-public-health.$$ -w '%{http_code}' "$PUBLIC_URL")"
  if [[ "$public_status" != "200" ]]; then
    echo "FAIL public health returned $public_status from $PUBLIC_URL" >&2
    rm -f /tmp/agentos-public-health.$$
    exit 1
  fi
  echo "OK public health: $PUBLIC_URL ($public_status)"
  rm -f /tmp/agentos-public-health.$$
else
  echo "SKIP public health: set AGENTOS_PUBLIC_HEALTH_URL to enable"
fi

echo "AgentOS healthcheck passed"
