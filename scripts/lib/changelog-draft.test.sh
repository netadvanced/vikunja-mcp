#!/usr/bin/env bash
#
# changelog-draft.test.sh — shell-level self-check for scripts/lib/changelog-draft.sh.
#
# scripts/ sits outside Jest's coverage scope, so this is the harness for the changelog
# draft classification logic used by scripts/release-prepare.sh. Run directly:
#
#   bash scripts/lib/changelog-draft.test.sh
#
# or via `npm run test:release-prepare`. Exits non-zero (and prints every failing
# assertion) if anything regresses.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=./changelog-draft.sh
source "$REPO_ROOT/scripts/lib/changelog-draft.sh"

PASS=0
FAIL=0

# assert_eq <label> <expected> <actual>
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $label"
    echo "  expected: $(printf '%q' "$expected")"
    echo "  actual:   $(printf '%q' "$actual")"
  fi
}

# assert_contains <label> <haystack> <needle>
assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $label"
    echo "  expected to contain: $(printf '%q' "$needle")"
    echo "  actual: $(printf '%q' "$haystack")"
  fi
}

# reset_buckets — (re)declare the globals build_changelog_buckets writes into, as a fresh
# release-prepare.sh invocation would before calling it.
reset_buckets() {
  declare -gA CHANGELOG_BUCKETS=()
  declare -ga CHANGELOG_UNCLASSIFIED_SUBJECTS=()
  local key
  for key in "${CHANGELOG_SECTION_ORDER[@]}"; do
    CHANGELOG_BUCKETS[$key]=""
  done
}

echo "== classify_commit_subject =="

result="$(classify_commit_subject 'feat(projects): add position param to create-bucket/update-bucket')"
assert_eq "scoped feat" "$(printf 'feat\tadd position param to create-bucket/update-bucket')" "$result"

result="$(classify_commit_subject 'fix(bulk): forward startDate/endDate on bulk-create tasks (#168) (#170)')"
assert_eq "squash-merge fix with double PR refs" \
  "$(printf 'fix\tforward startDate/endDate on bulk-create tasks (#168) (#170)')" "$result"

result="$(classify_commit_subject 'fix: coerce date-only dates to RFC3339 in single-task create (#167) (#169)')"
assert_eq "unscoped fix with PR ref" \
  "$(printf 'fix\tcoerce date-only dates to RFC3339 in single-task create (#167) (#169)')" "$result"

result="$(classify_commit_subject 'feat!: breaking change example')"
assert_eq "breaking-change bang" "$(printf 'feat\tbreaking change example')" "$result"

result="$(classify_commit_subject 'test(e2e): make the hasV2Api assertion version-aware (probe, not hard-coded true) (#172)')"
assert_eq "test type folds into chore bucket" \
  "$(printf 'chore\tmake the hasV2Api assertion version-aware (probe, not hard-coded true) (#172)')" "$result"

result="$(classify_commit_subject 'ci: bump release-workflow actions to current majors (node 24 runtimes)')"
assert_eq "ci type folds into chore bucket" \
  "$(printf 'chore\tbump release-workflow actions to current majors (node 24 runtimes)')" "$result"

result="$(classify_commit_subject 'release: v0.5.2 (#141)')"
assert_eq "non-conventional 'release:' subject is unclassified, not dropped" \
  "$(printf 'other\trelease: v0.5.2 (#141)')" "$result"

result="$(classify_commit_subject 'bump some dependency without a prefix')"
assert_eq "prefix-less subject is unclassified, not dropped" \
  "$(printf 'other\tbump some dependency without a prefix')" "$result"

echo "== build_changelog_buckets =="

# Regression test for the actual bug: git log --pretty=format:'%s' does NOT emit a
# trailing newline after the final (oldest) commit. printf here reproduces that exactly
# (no trailing \n on the last entry) to prove the oldest commit in a range is no longer
# silently dropped.
reset_buckets
INPUT=$'docs: newest commit\nfix: middle commit\nfeat(projects): oldest commit, no trailing newline'
build_changelog_buckets <<<"$INPUT"

assert_contains "oldest commit (no trailing newline) is NOT dropped" \
  "${CHANGELOG_BUCKETS[feat]}" "- oldest commit, no trailing newline"
assert_contains "middle commit still classified" "${CHANGELOG_BUCKETS[fix]}" "- middle commit"
assert_contains "newest commit still classified" "${CHANGELOG_BUCKETS[docs]}" "- newest commit"

# Merge-commit noise (from an actual `git merge` rather than a squash) must not appear as
# a bullet, but must also not swallow a real commit adjacent to it.
reset_buckets
INPUT=$'Merge pull request #122 from angusmaul/feat/bucket-position\nfeat(projects): add position param to create-bucket/update-bucket'
build_changelog_buckets <<<"$INPUT"

assert_eq "merge-noise line produces no feat bucket pollution beyond the real commit" \
  $'- add position param to create-bucket/update-bucket\n' "${CHANGELOG_BUCKETS[feat]}"

# Unclassified tracking: every commit that fails to match the conventional-commit regex
# must be reported, not silently absorbed.
reset_buckets
INPUT=$'release: v0.6.0 (#171)\nfeat: normal feature'
build_changelog_buckets <<<"$INPUT"

assert_eq "unclassified count" "1" "${#CHANGELOG_UNCLASSIFIED_SUBJECTS[@]}"
assert_eq "unclassified subject captured verbatim" "release: v0.6.0 (#171)" "${CHANGELOG_UNCLASSIFIED_SUBJECTS[0]:-}"
assert_contains "unclassified subject also lands in the 'other' bucket for the changelog section" \
  "${CHANGELOG_BUCKETS[other]}" "- release: v0.6.0 (#171)"

echo ""
echo "== Results: $PASS passed, $FAIL failed =="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
