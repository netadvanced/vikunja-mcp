#!/usr/bin/env bash
#
# release-publish.sh — publish the currently checked-out release tag.
#
# Usage:
#   scripts/release-publish.sh [--dry-run] [--push]
#
# Run this with the release tag checked out (e.g. `git checkout vX.Y.Z`, or right after
# scripts/release-tag.sh while still on main at the tagged commit). See docs/RELEASING.md.
#
# Flags:
#   --dry-run   Use `npm publish --dry-run`, skip creating the GitHub release, and only print
#               what a real run would do for the GitHub release step. Docker images are still
#               built locally (safe — nothing leaves the machine). Use this for testing.
#   --push      Also push the built Docker images to ghcr.io. Without this flag, images are
#               built and tagged locally only. Irrelevant to npm/GitHub, which follow --dry-run.
#
# What it does:
#   1. Verifies HEAD is exactly the annotated tag matching package.json's version.
#   2. Runs the full gate suite (lint, typecheck, tests, coverage).
#   3. npm publish --access public (or --dry-run).
#   4. docker build, tagged :X.Y.Z and :latest; pushed only with --push.
#   5. gh release create vX.Y.Z using the CHANGELOG.md section as notes (skipped on --dry-run).
#
# Idempotency: skips npm publish if the version is already on the registry, skips the GitHub
# release if it already exists, and skips docker push per-tag if that tag is already present
# on the registry with the same digest is NOT checked (docker push is itself idempotent/cheap).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=false
DO_PUSH=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --push) DO_PUSH=true ;;
    *)
      echo "Usage: $0 [--dry-run] [--push]" >&2
      exit 1
      ;;
  esac
done

echo "==> dry-run: $DRY_RUN, push docker images: $DO_PUSH"

# ---------------------------------------------------------------------------
# 1. Verify HEAD is the release tag matching package.json
# ---------------------------------------------------------------------------

VERSION="$(node -pe "require('./package.json').version")"
TAG_NAME="v${VERSION}"
echo "==> package.json version: $VERSION"

if ! git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "ERROR: tag $TAG_NAME does not exist. Run scripts/release-tag.sh first." >&2
  exit 1
fi

HEAD_SHA="$(git rev-parse HEAD)"
TAG_SHA="$(git rev-parse "${TAG_NAME}^{commit}")"
if [[ "$HEAD_SHA" != "$TAG_SHA" ]]; then
  echo "ERROR: HEAD ($HEAD_SHA) is not tag $TAG_NAME ($TAG_SHA)." >&2
  echo "       git checkout $TAG_NAME" >&2
  exit 1
fi
echo "==> HEAD matches tag $TAG_NAME ($HEAD_SHA)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is not clean." >&2
  git status --short >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Run the full gate suite
# ---------------------------------------------------------------------------

echo "==> Running gates: lint"
npm run lint

echo "==> Running gates: typecheck"
npm run typecheck

echo "==> Running gates: test"
npx jest --silent

echo "==> Running gates: test:coverage"
npm run test:coverage

echo "==> All gates passed"

# ---------------------------------------------------------------------------
# 3. npm publish
# ---------------------------------------------------------------------------

PACKAGE_NAME="$(node -pe "require('./package.json').name")"

ALREADY_PUBLISHED=false
if npm view "${PACKAGE_NAME}@${VERSION}" version >/dev/null 2>&1; then
  ALREADY_PUBLISHED=true
fi

if [[ "$ALREADY_PUBLISHED" == true && "$DRY_RUN" == false ]]; then
  echo "==> ${PACKAGE_NAME}@${VERSION} is already on the npm registry — skipping publish (idempotent)."
elif [[ "$DRY_RUN" == true ]]; then
  echo "==> [dry-run] npm publish --access public --dry-run"
  npm publish --access public --dry-run
else
  echo "==> npm publish --access public"
  npm publish --access public
fi

# ---------------------------------------------------------------------------
# 4. Docker build (+ optional push)
# ---------------------------------------------------------------------------

IMAGE_BASE="ghcr.io/netadvanced/vikunja-mcp-ng"
IMAGE_VERSION_TAG="${IMAGE_BASE}:${VERSION}"
IMAGE_LATEST_TAG="${IMAGE_BASE}:latest"

# Vikunja compatibility tag — single source of truth is the vendored OpenAPI spec, never
# hand-typed. See scripts/lib/vikunja-compat-version.sh and docs/RELEASING.md "Vikunja
# compatibility". Suffixed onto our own version as `X.Y.Z-vikunja<A.B.C>` (node:20-alpine
# convention: our version always leads, alignment is only ever a suffix) so it can never be
# misread as the image being Vikunja itself, and can't collide with our own semver tag namespace.
# Unlike the old standalone `vikunja-<ver>` tag, this one does NOT float — it names this exact
# release, not "whatever's newest for this server version".
VIKUNJA_COMPAT_VERSION="$("${REPO_ROOT}/scripts/lib/vikunja-compat-version.sh")"
COMPAT_TAG="${VERSION}-vikunja${VIKUNJA_COMPAT_VERSION}"
IMAGE_COMPAT_TAG="${IMAGE_BASE}:${COMPAT_TAG}"
echo "==> Vikunja compatibility: ${VIKUNJA_COMPAT_VERSION} (image tag: ${COMPAT_TAG})"

if [[ ! -f Dockerfile ]]; then
  echo "ERROR: Dockerfile not found at repo root." >&2
  exit 1
fi

echo "==> docker build -t ${IMAGE_VERSION_TAG} -t ${IMAGE_LATEST_TAG} -t ${IMAGE_COMPAT_TAG}"
docker build \
  --label "org.opencontainers.image.version=${VERSION}" \
  --label "io.vikunja.compat=${VIKUNJA_COMPAT_VERSION}" \
  -t "$IMAGE_VERSION_TAG" \
  -t "$IMAGE_LATEST_TAG" \
  -t "$IMAGE_COMPAT_TAG" \
  .

if [[ "$DO_PUSH" == true ]]; then
  echo "==> docker push ${IMAGE_VERSION_TAG}"
  docker push "$IMAGE_VERSION_TAG"
  echo "==> docker push ${IMAGE_LATEST_TAG}"
  docker push "$IMAGE_LATEST_TAG"
  echo "==> docker push ${IMAGE_COMPAT_TAG}"
  docker push "$IMAGE_COMPAT_TAG"
else
  echo "==> Skipping docker push (pass --push to push to ghcr.io). Images are built and tagged locally."
fi

# ---------------------------------------------------------------------------
# 5. GitHub release
# ---------------------------------------------------------------------------

CHANGELOG="CHANGELOG.md"
HEADING_PATTERN="^## \[${VERSION}\]"
START_LINE="$(grep -n -E "$HEADING_PATTERN" "$CHANGELOG" | head -1 | cut -d: -f1 || true)"

if [[ -z "$START_LINE" ]]; then
  echo "ERROR: no '## [$VERSION]' section found in $CHANGELOG." >&2
  exit 1
fi

END_LINE="$(tail -n "+$((START_LINE + 1))" "$CHANGELOG" | grep -n -E '^## \[' | head -1 | cut -d: -f1 || true)"
if [[ -n "$END_LINE" ]]; then
  END_LINE=$((START_LINE + END_LINE - 1))
else
  END_LINE="$(wc -l <"$CHANGELOG" | tr -d ' ')"
fi

NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
# Command substitution strips trailing blank lines/newlines portably (no GNU-vs-BSD sed games).
SECTION_TEXT="$(sed -n "${START_LINE},${END_LINE}p" "$CHANGELOG")"
printf '%s\n' "$SECTION_TEXT" >"$NOTES_FILE"

RELEASE_EXISTS=false
if gh release view "$TAG_NAME" --repo netadvanced/vikunja-mcp >/dev/null 2>&1; then
  RELEASE_EXISTS=true
fi

if [[ "$RELEASE_EXISTS" == true ]]; then
  echo "==> GitHub release $TAG_NAME already exists — skipping (idempotent)."
elif [[ "$DRY_RUN" == true ]]; then
  echo "==> [dry-run] Would run:"
  echo "    gh release create $TAG_NAME --repo netadvanced/vikunja-mcp --title \"$TAG_NAME\" --notes-file <changelog section>"
  echo "----- notes preview -----"
  cat "$NOTES_FILE"
  echo "--------------------------"
else
  echo "==> gh release create $TAG_NAME"
  gh release create "$TAG_NAME" --repo netadvanced/vikunja-mcp --title "$TAG_NAME" --notes-file "$NOTES_FILE"
fi

echo ""
echo "=================================================================="
echo "  Publish complete for ${TAG_NAME} (dry-run: $DRY_RUN, docker push: $DO_PUSH)"
echo "  Vikunja compatibility: ${VIKUNJA_COMPAT_VERSION} (image tag: ${COMPAT_TAG})"
echo "=================================================================="
