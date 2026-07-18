#!/usr/bin/env bash
#
# release-tag.sh — tag the current commit as the version in package.json.
#
# Usage:
#   scripts/release-tag.sh
#
# Run this on `main`, right after a `release: vX.Y.Z` PR (from scripts/release-prepare.sh) has
# merged. It does NOT bump anything — it only tags. See docs/RELEASING.md for the full flow.
#
# What it does:
#   1. Verifies we're on `main`, the tree is clean, and local main matches origin/main.
#   2. Reads the version out of package.json and verifies no `vX.Y.Z` tag exists yet.
#   3. Extracts the matching CHANGELOG.md section as the tag message.
#   4. Creates an ANNOTATED tag `vX.Y.Z` on HEAD and pushes it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Preconditions
# ---------------------------------------------------------------------------

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is not clean." >&2
  git status --short >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: must run this from 'main' (currently on '$CURRENT_BRANCH')." >&2
  exit 1
fi

echo "==> Fetching origin/main"
git fetch origin main --quiet

LOCAL_SHA="$(git rev-parse main)"
REMOTE_SHA="$(git rev-parse origin/main)"
if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  echo "ERROR: local main ($LOCAL_SHA) does not match origin/main ($REMOTE_SHA)." >&2
  echo "       git pull --ff-only" >&2
  exit 1
fi
echo "==> main is up to date with origin/main ($LOCAL_SHA)"

# ---------------------------------------------------------------------------
# 2. Version + idempotency check
# ---------------------------------------------------------------------------

VERSION="$(node -pe "require('./package.json').version")"
TAG_NAME="v${VERSION}"
echo "==> package.json version: $VERSION (tag: $TAG_NAME)"

if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  EXISTING_SHA="$(git rev-parse "${TAG_NAME}^{commit}")"
  if [[ "$EXISTING_SHA" == "$LOCAL_SHA" ]]; then
    echo "==> Tag $TAG_NAME already exists and already points at HEAD ($LOCAL_SHA)."
    echo "==> Nothing to do (idempotent no-op). Checking it's pushed..."
    if git ls-remote --tags origin "$TAG_NAME" | grep -q "$TAG_NAME"; then
      echo "==> $TAG_NAME is already pushed to origin. Done."
      exit 0
    else
      echo "==> $TAG_NAME exists locally but not on origin — pushing now."
      git push origin "refs/tags/${TAG_NAME}"
      exit 0
    fi
  else
    echo "ERROR: tag $TAG_NAME already exists but points at $EXISTING_SHA, not HEAD ($LOCAL_SHA)." >&2
    echo "       That version was already released from a different commit. Bump the version." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 3. Extract the CHANGELOG.md section for this version as the tag message
# ---------------------------------------------------------------------------

CHANGELOG="CHANGELOG.md"
if [[ ! -f "$CHANGELOG" ]]; then
  echo "ERROR: $CHANGELOG not found at repo root." >&2
  exit 1
fi

HEADING_PATTERN="^## \[${VERSION}\]"
START_LINE="$(grep -n -E "$HEADING_PATTERN" "$CHANGELOG" | head -1 | cut -d: -f1 || true)"

if [[ -z "$START_LINE" ]]; then
  echo "ERROR: no '## [$VERSION]' section found in $CHANGELOG." >&2
  echo "       Did the release PR include a curated changelog entry for this version?" >&2
  exit 1
fi

# Find the next '## [' heading after START_LINE (exclusive), or end of file.
END_LINE="$(tail -n "+$((START_LINE + 1))" "$CHANGELOG" | grep -n -E '^## \[' | head -1 | cut -d: -f1 || true)"
if [[ -n "$END_LINE" ]]; then
  END_LINE=$((START_LINE + END_LINE - 1))
else
  END_LINE="$(wc -l <"$CHANGELOG" | tr -d ' ')"
fi

TAG_MESSAGE_FILE="$(mktemp)"
trap 'rm -f "$TAG_MESSAGE_FILE"' EXIT
# Command substitution strips trailing blank lines/newlines portably (no GNU-vs-BSD sed games).
SECTION_TEXT="$(sed -n "${START_LINE},${END_LINE}p" "$CHANGELOG")"
printf '%s\n' "$SECTION_TEXT" >"$TAG_MESSAGE_FILE"

echo "==> Tag message (from CHANGELOG.md lines ${START_LINE}-${END_LINE}):"
echo "-----"
cat "$TAG_MESSAGE_FILE"
echo "-----"

# ---------------------------------------------------------------------------
# 4. Create and push the annotated tag
# ---------------------------------------------------------------------------

echo "==> Creating annotated tag $TAG_NAME on $LOCAL_SHA"
git tag -a "$TAG_NAME" -F "$TAG_MESSAGE_FILE"

echo "==> Pushing $TAG_NAME to origin"
git push origin "refs/tags/${TAG_NAME}"

echo ""
echo "=================================================================="
echo "  Tagged and pushed ${TAG_NAME}"
echo "=================================================================="
echo ""
echo "Next step: npm run release:publish  (or wait for the tag-triggered"
echo "workflow, once docs/github-workflow-release.yml.example is installed"
echo "as .github/workflows/release.yml)."
echo ""
