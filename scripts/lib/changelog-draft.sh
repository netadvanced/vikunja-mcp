#!/usr/bin/env bash
#
# changelog-draft.sh — commit classification for scripts/release-prepare.sh's draft
# changelog generator.
#
# Kept in its own file (rather than inline in release-prepare.sh) so the classification
# logic can be exercised by scripts/lib/changelog-draft.test.sh — scripts/ sits outside
# Jest's coverage scope, so this is the harness for it. Source this file, then call
# build_changelog_buckets.
#
# Known bug this file fixes (see scripts/lib/changelog-draft.test.sh test
# "does not drop the oldest commit in range"):
#   `git log --pretty=format:'%s' <range>` does NOT emit a trailing newline after the
#   final (oldest) commit in the range — that's documented `format:` behavior, as
#   opposed to `tformat:`. A plain `while IFS= read -r subject; do ...; done` loop reads
#   that final line's content into $subject but `read` returns exit status 1 (EOF
#   without a trailing newline), which the `while` treats as "stop" *before* running the
#   loop body — silently dropping the oldest commit in the range every time. Confirmed by
#   reproducing the v0.5.1..v0.5.2 draft generation: `feat(projects): add position param
#   to create-bucket/update-bucket` (#122) is the oldest commit in that range and is the
#   exact commit that had to be hand-added to the v0.5.2 CHANGELOG during curation.
#   Fix: `while IFS= read -r subject || [[ -n "$subject" ]]; do` — the `|| [[ -n ... ]]`
#   clause still runs the loop body once for a final line with no trailing newline.

set -u

# Section a classified commit lands in, keyed by conventional-commit type. "other" is the
# bucket for anything that does NOT match a recognized conventional-commit prefix — this is
# the "Unclassified — review manually" section, and it is always rendered when non-empty so
# nothing is silently dropped.
# shellcheck disable=SC2034 # consumed by callers (release-prepare.sh, changelog-draft.test.sh)
declare -gA CHANGELOG_SECTION_TITLES=(
  [feat]="Added"
  [fix]="Fixed"
  [perf]="Changed"
  [refactor]="Changed"
  [docs]="Documentation"
  [chore]="Chores"
  [other]="Unclassified — review manually"
)
# shellcheck disable=SC2034 # consumed by callers (release-prepare.sh, changelog-draft.test.sh)
CHANGELOG_SECTION_ORDER=(feat fix perf refactor docs chore other)

# Recognize all standard conventional-commit types (not just the ones with their own
# CHANGELOG section) so routine `test:`/`ci:`/`build:`/`style:` commits don't pollute the
# Unclassified section on every release. They fold into the `chore` bucket. Anything outside
# this type list (e.g. `release:`, or a non-conventional prose subject) is genuinely
# unclassified and must surface for manual review rather than being silently absorbed.
CHANGELOG_CONVENTIONAL_RE='^(feat|fix|perf|refactor|docs|chore|test|ci|build|style)(\([^)]*\))?!?:[[:space:]]*(.*)$'
CHANGELOG_MERGE_NOISE_RE='^Merge (pull request|branch|remote-tracking branch)'

# classify_commit_subject <subject>
# Echoes "<bucket-key><TAB><message>" on stdout. Never drops input: anything that doesn't
# match CHANGELOG_CONVENTIONAL_RE is classified as "other" with the full original subject
# preserved as the message.
classify_commit_subject() {
  local subject="$1" type msg key
  if [[ "$subject" =~ $CHANGELOG_CONVENTIONAL_RE ]]; then
    type="${BASH_REMATCH[1]}"
    msg="${BASH_REMATCH[3]}"
    case "$type" in
      test | ci | build | style) key="chore" ;;
      *) key="$type" ;;
    esac
    printf '%s\t%s\n' "$key" "$msg"
  else
    printf '%s\t%s\n' "other" "$subject"
  fi
}

# build_changelog_buckets
# Reads one commit subject per line from stdin (the intended input is the raw output of
# `git log --pretty=format:'%s' <range>`, which has NO trailing newline after the final
# entry — see the file header). Populates two globals that the caller must declare first:
#   CHANGELOG_BUCKETS              — associative array, bucket key -> "- msg\n- msg\n..."
#   CHANGELOG_UNCLASSIFIED_SUBJECTS — indexed array of original subjects landed in "other"
build_changelog_buckets() {
  local subject key msg
  while IFS= read -r subject || [[ -n "$subject" ]]; do
    [[ -z "$subject" ]] && continue
    [[ "$subject" =~ $CHANGELOG_MERGE_NOISE_RE ]] && continue

    IFS=$'\t' read -r key msg < <(classify_commit_subject "$subject")
    CHANGELOG_BUCKETS["$key"]+="- ${msg}"$'\n'
    if [[ "$key" == "other" ]]; then
      CHANGELOG_UNCLASSIFIED_SUBJECTS+=("$subject")
    fi
  done
}
