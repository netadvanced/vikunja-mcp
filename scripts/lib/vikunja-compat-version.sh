#!/usr/bin/env bash
#
# vikunja-compat-version.sh — single source of truth for "which Vikunja server version is this
# build aligned to". Prints the normalized base version (e.g. "2.3.0") to stdout; nothing else
# on stdout, so this is safe to use via command substitution:
#
#   VIKUNJA_COMPAT_VERSION="$(scripts/lib/vikunja-compat-version.sh)"
#
# Source: the vendored OpenAPI spec's `info.version` field (docs/vikunja-openapi.json), which is
# the same spec generated types are built from (see docs/RELEASING.md "Vikunja compatibility").
# That field is a `git describe`-style string off the Vikunja server repo, e.g.
# "v2.3.0-1019-g95b7e673" — this script normalizes it down to the base release "2.3.0".
#
# Never hand-type this version anywhere else (Docker tags, docs, CHANGELOG) — always derive it
# from this script (or read the printed value from a run of it) so there is exactly one place
# that can drift.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPEC_FILE="${REPO_ROOT}/docs/vikunja-openapi.json"
COMPOSE_FILE="${REPO_ROOT}/docker/e2e/docker-compose.yml"

if [[ ! -f "$SPEC_FILE" ]]; then
  echo "ERROR: vendored OpenAPI spec not found at $SPEC_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to read $SPEC_FILE (already a project dependency via npm run fetch:api-spec)" >&2
  exit 1
fi

RAW_VERSION="$(jq -r '.info.version' "$SPEC_FILE")"
if [[ -z "$RAW_VERSION" || "$RAW_VERSION" == "null" ]]; then
  echo "ERROR: could not read .info.version from $SPEC_FILE" >&2
  exit 1
fi

# Normalize "v2.3.0-1019-g95b7e673" (or plain "2.3.0") down to "2.3.0":
# strip a leading 'v', then strip everything from the first '-' onward.
BASE_VERSION="${RAW_VERSION#v}"
BASE_VERSION="${BASE_VERSION%%-*}"

if [[ ! "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: could not parse a X.Y.Z release out of spec info.version '$RAW_VERSION' (got '$BASE_VERSION')" >&2
  exit 1
fi

# Cross-check against the e2e docker-compose pin, if present. This is a loud WARNING, not a
# failure: the vendored spec is the single source of truth for the compat tag (see header comment
# above); the e2e pin is a separately-maintained decision that should normally agree with it but
# isn't required to gate a release publish.
#
# The compose file's image tag is env-driven (`vikunja/vikunja:${VIKUNJA_VERSION:-2.3.0}`, see
# docker/e2e/docker-compose.yml) so a version-matrix run can override it without editing the
# file — this cross-check reads the *default* fallback value, i.e. the baseline pin everyone gets
# with a plain `npm run e2e:up`, not whatever VIKUNJA_VERSION a given test-matrix run happened to
# override it to.
if [[ -f "$COMPOSE_FILE" ]]; then
  COMPOSE_PIN="$(grep -oE '\$\{VIKUNJA_VERSION:-[0-9]+\.[0-9]+\.[0-9]+\}' "$COMPOSE_FILE" \
    | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
  if [[ -n "$COMPOSE_PIN" && "$COMPOSE_PIN" != "$BASE_VERSION" ]]; then
    echo "WARNING: vendored spec base version ($BASE_VERSION) does not match the e2e Vikunja pin" >&2
    echo "         ($COMPOSE_PIN) in $COMPOSE_FILE — these should usually agree. If the spec was" >&2
    echo "         just refreshed, consider bumping the e2e pin too (and vice versa)." >&2
  fi
fi

echo "$BASE_VERSION"
