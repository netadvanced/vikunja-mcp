#!/usr/bin/env bash
# Bootstraps the local Vikunja + Postgres e2e stack (docker/e2e/docker-compose.yml)
# so it's ready for scripts/test-mcp.ts (npm run test:mcp):
#
#   1. Brings the stack up and waits for both services to report healthy.
#   2. Creates a single test user directly via the vikunja container CLI
#      (idempotent — safe to re-run against an already-bootstrapped stack).
#   3. Logs in as that user to get a JWT.
#   4. Uses the JWT to mint a long-lived tk_* API token via PUT /api/v1/tokens,
#      granting every permission the running server advertises via
#      GET /api/v1/routes. Falls back to the JWT itself if token creation
#      fails for any reason.
#   5. Writes docker/e2e/.env (gitignored) and prints `export` lines for
#      VIKUNJA_URL / VIKUNJA_API_TOKEN.
#
# Usage: docker/e2e/bootstrap.sh
# (invoked by `npm run e2e:up`, which runs `docker compose up` first)
#
# The Vikunja image tag is controlled by the `VIKUNJA_VERSION` env var
# (default `2.3.0`, see docker/e2e/docker-compose.yml) -- docker compose
# picks it up automatically via `${VIKUNJA_VERSION:-2.3.0}` interpolation
# in that file, since this script's `compose()` helper just inherits
# whatever is in this process's environment. Exporting it explicitly here
# (rather than relying on it merely being inherited) makes the effective
# version visible in this script's own log output and guarantees `docker
# compose` sees it even if a caller invoked this script directly (bypassing
# `npm run e2e:up`, which also forwards it) without exporting it first:
#
#   VIKUNJA_VERSION=2.4.0 npm run e2e:up
#
# See docs/LOCAL-TESTING.md for the full workflow, including the
# version-matrix runner (`npm run test:matrix`) that drives this.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"

# Default + export so it's visible in the log line below and so `docker
# compose` sees it regardless of how this script was invoked.
export VIKUNJA_VERSION="${VIKUNJA_VERSION:-2.3.0}"

VIKUNJA_URL="http://localhost:33456/api/v1"
TEST_USERNAME="e2e-test"
TEST_EMAIL="e2e-test@vikunja-mcp.local"
TEST_PASSWORD="VikunjaMcpE2E-2026!"
TOKEN_TITLE="vikunja-mcp-e2e"

log() { echo "[bootstrap] $*" >&2; }

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

wait_for_health() {
  log "Waiting for db + vikunja services to report healthy..."
  compose up -d --wait --wait-timeout 180
  log "Stack is healthy."
}

# Returns 0 and prints the JWT on stdout if login succeeds, 1 otherwise.
try_login() {
  local resp
  resp="$(curl -sS -w '\n%{http_code}' -X POST "$VIKUNJA_URL/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}" || true)"
  local status body
  status="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [ "$status" = "200" ]; then
    echo "$body" | jq -r '.token'
    return 0
  fi
  return 1
}

create_test_user() {
  log "Creating test user '$TEST_USERNAME' via container CLI..."
  if compose exec -T vikunja /app/vikunja/vikunja user create \
    -u "$TEST_USERNAME" -e "$TEST_EMAIL" -p "$TEST_PASSWORD"; then
    log "User created."
  else
    log "User create command failed/exited non-zero -- assuming the user" \
        "already exists from a previous bootstrap run and continuing."
  fi
}

mint_api_token() {
  local jwt="$1"
  local expires_at
  expires_at="$(node -e 'console.log(new Date(Date.now()+10*365*24*3600*1000).toISOString())')"

  log "Fetching available permissions from GET /routes..."
  local routes
  if ! routes="$(curl -sSf "$VIKUNJA_URL/routes" -H "Authorization: Bearer $jwt")"; then
    log "GET /routes failed; cannot mint a scoped api token."
    return 1
  fi

  local permissions
  permissions="$(echo "$routes" | jq 'to_entries | map({(.key): (.value | keys)}) | add')"

  log "Creating long-lived API token '$TOKEN_TITLE' via PUT /tokens..."
  local resp status body
  resp="$(curl -sS -w '\n%{http_code}' -X PUT "$VIKUNJA_URL/tokens" \
    -H "Authorization: Bearer $jwt" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg title "$TOKEN_TITLE" --arg exp "$expires_at" --argjson perms "$permissions" \
      '{title: $title, permissions: $perms, expires_at: $exp}')")"
  status="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  # The OpenAPI spec documents 200 for a successful PUT /tokens, but the
  # real server responds 201 Created. Accept both.
  if [ "$status" != "200" ] && [ "$status" != "201" ]; then
    log "PUT /tokens failed (HTTP $status): $body"
    return 1
  fi

  echo "$body" | jq -r '.token'
}

main() {
  log "Vikunja version: $VIKUNJA_VERSION"
  wait_for_health

  local jwt
  if jwt="$(try_login)"; then
    log "Logged in as existing user '$TEST_USERNAME'."
  else
    create_test_user
    if ! jwt="$(try_login)"; then
      log "ERROR: login still failing after creating the test user. Aborting."
      exit 1
    fi
    log "Logged in as newly-created user '$TEST_USERNAME'."
  fi

  local token token_kind
  if token="$(mint_api_token "$jwt")" && [ -n "$token" ] && [ "$token" != "null" ]; then
    token_kind="tk_* api token"
  else
    log "Falling back to the JWT itself as VIKUNJA_API_TOKEN."
    token="$jwt"
    token_kind="JWT (fallback)"
  fi

  {
    echo "VIKUNJA_URL=$VIKUNJA_URL"
    echo "VIKUNJA_API_TOKEN=$token"
  } > "$ENV_FILE"

  log "Wrote $ENV_FILE"
  log "Token kind: $token_kind"
  echo ""
  echo "export VIKUNJA_URL=$VIKUNJA_URL"
  echo "export VIKUNJA_API_TOKEN=$token"
}

main "$@"
