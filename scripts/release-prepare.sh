#!/usr/bin/env bash
#
# release-prepare.sh — start a release: bump the version, draft the changelog, open a branch.
#
# Usage:
#   scripts/release-prepare.sh patch|minor
#
# What it does (see docs/RELEASING.md for the full policy):
#   1. Verifies the working tree is clean and we're on an up-to-date `main`.
#   2. Creates a fresh `release/vX.Y.Z` branch off `main`.
#   3. Runs the full gate suite (lint, typecheck, tests, coverage) — a release never starts red.
#   4. Bumps package.json / package-lock.json via `npm version <bump> --no-git-tag-version`
#      (no git tag yet — that's scripts/release-tag.sh, run after the release PR merges).
#   5. Generates a draft changelog section from conventional commits since the last tag and
#      inserts it into CHANGELOG.md under [Unreleased].
#   6. Commits everything as `release: vX.Y.Z` and prints the next steps.
#
# This script never pushes and never opens a PR — that's a manual step so a human reviews the
# generated changelog first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 0. Args
# ---------------------------------------------------------------------------

BUMP="${1:-}"
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" ]]; then
  echo "Usage: $0 patch|minor" >&2
  echo "" >&2
  echo "This project is pre-1.0 (see docs/RELEASING.md §1) — releases are patch or minor." >&2
  echo "A major (1.0.0) bump is a deliberate, hand-run 'npm version major' as part of a" >&2
  echo "declared-stable release, not something this script automates." >&2
  exit 1
fi

echo "==> Release scope: $BUMP"

# ---------------------------------------------------------------------------
# 1. Preconditions: clean tree, on main, up to date with origin/main
# ---------------------------------------------------------------------------

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is not clean. Commit, stash elsewhere, or discard changes first." >&2
  git status --short >&2
  exit 1
fi
echo "==> Working tree is clean"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: must run this from 'main' (currently on '$CURRENT_BRANCH')." >&2
  echo "       git checkout main && git pull" >&2
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
# 2. Compute the target version (before bumping, so we can name the branch)
# ---------------------------------------------------------------------------

CURRENT_VERSION="$(node -pe "require('./package.json').version")"
echo "==> Current version: $CURRENT_VERSION"

IFS='.' read -r CUR_MAJOR CUR_MINOR CUR_PATCH <<<"$CURRENT_VERSION"
if [[ "$BUMP" == "patch" ]]; then
  TARGET_VERSION="${CUR_MAJOR}.${CUR_MINOR}.$((CUR_PATCH + 1))"
else
  TARGET_VERSION="${CUR_MAJOR}.$((CUR_MINOR + 1)).0"
fi
echo "==> Target version:  $TARGET_VERSION"

RELEASE_BRANCH="release/v${TARGET_VERSION}"
TAG_NAME="v${TARGET_VERSION}"

if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "ERROR: tag $TAG_NAME already exists. Nothing to prepare." >&2
  exit 1
fi
if git show-ref --verify --quiet "refs/heads/$RELEASE_BRANCH"; then
  echo "ERROR: branch $RELEASE_BRANCH already exists locally. Remove it or resume from it." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Create the release branch
# ---------------------------------------------------------------------------

echo "==> Creating branch $RELEASE_BRANCH"
git checkout -b "$RELEASE_BRANCH"

# ---------------------------------------------------------------------------
# 4. Run the full gate suite — a release never starts from red
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
# 5. Bump package.json / package-lock.json
# ---------------------------------------------------------------------------

echo "==> Bumping version ($BUMP)"
NPM_VERSION_OUTPUT="$(npm version "$BUMP" --no-git-tag-version)"
# npm prints the new version prefixed with 'v', e.g. "v0.3.1"
BUMPED_VERSION="${NPM_VERSION_OUTPUT#v}"

if [[ "$BUMPED_VERSION" != "$TARGET_VERSION" ]]; then
  echo "ERROR: npm bumped to $BUMPED_VERSION but this script expected $TARGET_VERSION." >&2
  echo "       (package.json may have changed underneath this script — investigate before continuing.)" >&2
  exit 1
fi
echo "==> package.json now at $BUMPED_VERSION"

# ---------------------------------------------------------------------------
# 6. Generate a draft changelog section from conventional commits since the last tag
# ---------------------------------------------------------------------------

echo "==> Generating draft changelog section"

LAST_TAG="$(git describe --tags --abbrev=0 --match 'v*' "${LOCAL_SHA}" 2>/dev/null || true)"
if [[ -n "$LAST_TAG" ]]; then
  echo "==> Last tag reachable from main: $LAST_TAG"
  COMMIT_RANGE="${LAST_TAG}..${LOCAL_SHA}"
else
  echo "==> No prior v* tag reachable from main — this is the first tagged release; using full history"
  COMMIT_RANGE="${LOCAL_SHA}"
fi

DRAFT_FILE="$(mktemp)"
trap 'rm -f "$DRAFT_FILE"' EXIT

{
  echo ""
  echo "## [${TARGET_VERSION}] - $(date -u +%Y-%m-%d)"
  echo ""
  echo "_Draft generated from conventional commits by scripts/release-prepare.sh — curate before merging._"
} >>"$DRAFT_FILE"

# Group commit subjects by conventional-commit prefix. Dependency-free: plain git log + shell.
declare -A SECTION_TITLES=(
  [feat]="Added"
  [fix]="Fixed"
  [perf]="Changed"
  [refactor]="Changed"
  [docs]="Documentation"
  [chore]="Chores"
  [other]="Other"
)
SECTION_ORDER=(feat fix perf refactor docs chore other)

declare -A BUCKETS
for key in "${SECTION_ORDER[@]}"; do
  BUCKETS[$key]=""
done

MERGE_NOISE_RE='^Merge (pull request|branch|remote-tracking branch)'
CONVENTIONAL_RE='^(feat|fix|perf|refactor|docs|chore)(\([^)]*\))?!?:[[:space:]]*(.*)$'

while IFS= read -r subject; do
  [[ -z "$subject" ]] && continue
  # Skip merge-noise subjects that add nothing on their own.
  [[ "$subject" =~ $MERGE_NOISE_RE ]] && continue

  if [[ "$subject" =~ $CONVENTIONAL_RE ]]; then
    key="${BASH_REMATCH[1]}"
    msg="${BASH_REMATCH[3]}"
  else
    key="other"
    msg="$subject"
  fi
  BUCKETS[$key]+="- ${msg}"$'\n'
done < <(git log --no-merges --pretty=format:'%s' "$COMMIT_RANGE" 2>/dev/null || true)

WROTE_ANY=false
for key in "${SECTION_ORDER[@]}"; do
  if [[ -n "${BUCKETS[$key]}" ]]; then
    {
      echo ""
      echo "### ${SECTION_TITLES[$key]}"
      echo ""
      printf '%s' "${BUCKETS[$key]}"
    } >>"$DRAFT_FILE"
    WROTE_ANY=true
  fi
done

if [[ "$WROTE_ANY" == false ]]; then
  {
    echo ""
    echo "_No conventional commits found in range \`${COMMIT_RANGE}\` — fill this in by hand._"
  } >>"$DRAFT_FILE"
fi

# Insert the draft section right after the "## [Unreleased]" heading's own body.
# We locate the first "## [" heading that isn't Unreleased and insert before it; if none,
# append at end of file.
CHANGELOG="CHANGELOG.md"
if [[ ! -f "$CHANGELOG" ]]; then
  echo "ERROR: $CHANGELOG not found at repo root." >&2
  exit 1
fi

INSERT_LINE="$(grep -n '^## \[' "$CHANGELOG" | awk -F: '$0 !~ /Unreleased/ {print $1; exit}')"

if [[ -z "$INSERT_LINE" ]]; then
  cat "$DRAFT_FILE" >>"$CHANGELOG"
else
  awk -v insert_line="$INSERT_LINE" -v draft_file="$DRAFT_FILE" '
    NR == insert_line { while ((getline line < draft_file) > 0) print line; print "" }
    { print }
  ' "$CHANGELOG" >"${CHANGELOG}.tmp"
  mv "${CHANGELOG}.tmp" "$CHANGELOG"
fi

echo "==> CHANGELOG.md updated with draft section for ${TARGET_VERSION}"

# ---------------------------------------------------------------------------
# 7. Commit
# ---------------------------------------------------------------------------

git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v${TARGET_VERSION}"

echo ""
echo "=================================================================="
echo "  Prepared release v${TARGET_VERSION} on branch ${RELEASE_BRANCH}"
echo "=================================================================="
echo ""
echo "Next steps:"
echo "  1. Review and curate the generated CHANGELOG.md section (it's a draft)."
echo "  2. git push -u origin ${RELEASE_BRANCH}"
echo "  3. gh pr create --repo netadvanced/vikunja-mcp --base main \\"
echo "       --title \"release: v${TARGET_VERSION}\" --body \"See CHANGELOG.md\""
echo "  4. After merge: git checkout main && git pull && npm run release:tag"
echo ""
