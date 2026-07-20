# Releasing

This is the ruleset for cutting a release of `vikunja-mcp-ng`. It assumes you're comfortable
with git but haven't necessarily tagged or published an npm package before — every step is
spelled out.

Companion reading: [docs/ROADMAP.md](ROADMAP.md) for where the project stands, and
[CHANGELOG.md](../CHANGELOG.md) for what's already shipped.

## The short version

Releases are **deliberate, batch-time acts**, not something that happens automatically on every
merged PR. Someone decides "it's time to cut a release," picks patch or minor, and runs three
scripts. Version numbers change in exactly one kind of PR: a release PR. Nowhere else.

```
decide scope  →  release:prepare  →  review PR  →  merge  →  release:tag  →  release:publish
```

## 1. SemVer policy (pre-1.0)

This project is pre-1.0 (`0.x.y`), so we don't get to lean on strict SemVer's "breaking changes
require a major bump" — major stays at `0` until we declare the project stable (see §4). Instead
we use the common pre-1.0 convention:

| Bump | When | Example from this project |
|---|---|---|
| **patch** (`0.3.0` → `0.3.1`) | Bug fixes, doc corrections, dependency bumps, internal refactors — nothing a caller has to change for | `0.3.0 → 0.3.1`: response-formatting fixes (no tool signatures changed, output shape corrected) |
| **minor** (`0.3.x` → `0.4.0`) | New capability *or* a breaking change to tool inputs/outputs/config. Pre-1.0, minor absorbs both — there's no separate "major" lane to reach for | `0.3.x → 0.4.0`: next capability batch (new subcommands, new tools, or a config-shape change that requires updating `vikunja-mcp.config.json`) |
| **major** (`0.x.y` → `1.0.0`) | Reserved for the deliberate declaration that the project is stable. Not a size threshold — a status change | `1.0.0`: declared-stable criteria — see §4 |

Rule of thumb: **if existing users have to change anything to keep working (config keys, tool
argument shapes, removed subcommands, Node version floor), it's at least a minor bump, even
pre-1.0.** If they don't have to change anything, it's a patch.

When a batch of changes mixes both, the release takes the higher bump (one breaking-ish change in
a batch of ten bugfixes still makes it a minor).

## 2. Tags explained

A **tag** is a fixed, named pointer to one specific commit — unlike a branch, it doesn't move.
This project uses **annotated tags** (`git tag -a`, not lightweight `git tag`), which store a
message, an author, and a date, and can be verified independently of the commit they point at.

- Tag format: `vX.Y.Z` (e.g. `v0.3.1`), always on `main`, always on the commit that has that
  version in `package.json`.
- No release branches. `main` is the only place work lands and the only place tags are cut from.
- The tag's annotation message is the changelog section for that version — `git show v0.3.1` shows
  you exactly what shipped, no separate lookup needed.
- Pushing a tag matching `v*` is what (eventually) triggers the release workflow — see §6.

## 3. Release checklist

Run through this top to bottom. Steps 1–3 happen on a branch and go through a normal PR review.
Steps 4–6 happen on `main` after that PR is merged.

### Step 1 — Decide scope

Look at what's merged since the last tag (`git log v<last>..main --oneline`, or just read the
`[Unreleased]` section of `CHANGELOG.md` if it's been kept current). Decide **patch** or **minor**
per the table in §1. This is a judgment call — `release:prepare` doesn't decide it for you.

### Step 2 — Run `release:prepare`

```bash
npm run release:prepare -- patch   # or: npm run release:prepare -- minor
```

This script (`scripts/release-prepare.sh`):

- Refuses to run on a dirty tree or on `main` itself — it creates its own branch
  (`release/vX.Y.Z`) off an up-to-date `main`.
- Runs the full gate suite (lint, typecheck, tests, coverage) *before* touching anything —
  a release never starts from red.
- Bumps `package.json` (and `package-lock.json`) with `npm version <patch|minor> --no-git-tag-version`
  — no tag yet, that's step 5.
- Generates a draft changelog section from conventional commits (`feat:`, `fix:`, `chore:`,
  `docs:`, …) since the last tag, and inserts it into `CHANGELOG.md` under `[Unreleased]`.
- Commits everything as `release: vX.Y.Z`.
- Prints the next step: push the branch and open a PR.

### Step 3 — Review and curate the changelog, open the PR

The generated changelog section is a **draft**, grouped mechanically by commit prefix. Read it,
merge duplicate lines, cut noise (`chore: fix typo`), rewrite anything terse into something a user
would understand, and make sure entries are in the right Keep a Changelog category (Added /
Changed / Fixed / Removed / Security). This is the one manual step in the whole pipeline — commit
messages are written for git history, changelog entries are written for readers.

```bash
git push -u origin release/vX.Y.Z
gh pr create --repo netadvanced/vikunja-mcp-ng --base main \
  --title "release: vX.Y.Z" --body "See CHANGELOG.md"
```

### Step 4 — Merge the release PR

Ordinary PR review and merge, same gates as any other PR. Nothing special except that this PR is
the *only* kind allowed to touch the version field.

### Step 5 — Run `release:tag` (on `main`, after merge)

```bash
git checkout main && git pull
npm run release:tag
```

This script (`scripts/release-tag.sh`) reads the version out of `package.json`, verifies no tag
`vX.Y.Z` already exists, creates an **annotated** tag on `HEAD` whose message is the matching
`CHANGELOG.md` section, and pushes the tag.

### Step 6 — Run `release:publish` (or let the workflow do it)

Today, run it locally against the tagged commit:

```bash
git checkout vX.Y.Z   # or just stay on main right after tagging
npm run release:publish
```

This script (`scripts/release-publish.sh`) re-runs the full gates, then:

- `npm publish --access public`
- builds and tags the Docker image `ghcr.io/netadvanced/vikunja-mcp-ng:X.Y.Z`, `:latest`, and a
  `:X.Y.Z-vikunja<A.B.C>` compatibility tag (push only with `--push`) — see §7 below
- `gh release create vX.Y.Z` using the changelog section as the release notes

The tag-triggered workflow is installed as
`.github/workflows/release.yml` (see §6), pushing the tag in step 5 does this automatically and
step 6 becomes a manual fallback rather than the normal path.

## 4. What "1.0.0" means

`1.0.0` is deferred until the project is declared stable — that's an explicit owner decision, not
a metric threshold crossed automatically. At minimum it implies: the tool surface (subcommand
shapes, config schema) is not expected to change without a deprecation window, GitHub Actions CI
is live (currently disabled repo-wide, tracked in `docs/ROADMAP.md` §3b), and the owner says so in
a release PR. Until then, every `0.x` release may contain breaking changes in a minor bump per §1
— that's the pre-1.0 deal.

## 5. Who does what

- **Owner**: decides *when* to release and *what scope* (step 1). Reviews and curates the
  changelog (step 3). Approves and merges the release PR (step 4). Decides when to install the
  GitHub Actions workflow (§6).
- **Agents / anyone with repo access**: can execute the mechanical steps (2, 5, 6) once the owner
  has signed off on scope — these are scripts, not judgment calls. An agent should still surface
  the generated changelog for owner review rather than merging it unseen.

## 6. Automation status

- **Today**: three local scripts (`scripts/release-*.sh`) that a human or agent runs by hand, in
  order. No CI dependency.
- **Installed and active**: `.github/workflows/release.yml` — a tag-triggered
  (`on: push: tags: ['v*']`) GitHub Actions workflow that does steps 5–6's publish work
  automatically once a tag is pushed. It is deliberately kept as an example file rather than a
  live workflow — installing it under `.github/workflows/` is the owner's explicit act, done when
  ready (see the header comment in that file for the secrets it needs). Everyday PRs are
  unaffected either way: the workflow only ever triggers on a `v*` tag push, never on branches or
  PRs.

## 7. Vikunja compatibility

Docker images carry a **Vikunja compatibility tag** in addition to the semver tags, so a deployer
can pick an image that matches their Vikunja server version:

```
ghcr.io/netadvanced/vikunja-mcp-ng:X.Y.Z                  (this exact release)
ghcr.io/netadvanced/vikunja-mcp-ng:X.Y.Z-vikunja<A.B.C>   (this exact release, spelling out
                                                            what Vikunja version it's aligned to)
ghcr.io/netadvanced/vikunja-mcp-ng:latest                 (newest release)
```

e.g. release `0.3.1` aligned to Vikunja `2.3.0` produces `:0.3.1` and `:0.3.1-vikunja2.3.0`.

This follows the same convention as images like `node:20-alpine`: the leading component is always
*our* version, and the trailing component is a suffix that qualifies it, never a standalone
identifier. Alignment info only ever appears as a suffix on our own version, so a tag can never be
misread as "this image *is* Vikunja 2.3.0" — it's always unambiguous that `2.3.0` here describes
compatibility, not identity. We deliberately do not publish a standalone `:vikunja-<ver>`-style
tag (an earlier revision of this scheme did): that tag floated, re-pointing at whichever release
was newest for a given server version, which is exactly the version-number ambiguity this scheme
exists to eliminate. `X.Y.Z-vikunja<A.B.C>` names one exact release, same as the bare `X.Y.Z` tag
— if you want "newest", use `:latest`.

**Single source of truth**: `scripts/lib/vikunja-compat-version.sh` derives the compat version
from the vendored OpenAPI spec's `info.version` field (`docs/vikunja-openapi.json`) — the same
spec our generated TypeScript types are built from — normalized from its `git describe` form
(`v2.3.0-1019-g95b7e673`) down to the base release (`2.3.0`). It cross-checks that against the
Vikunja image pin in `docker/e2e/docker-compose.yml` and prints a loud warning (not a hard
failure) if they've drifted apart. Nothing else hand-types this version: `scripts/release-publish.sh`
and `.github/workflows/release.yml` both call this script rather than embedding the
number.

The image also carries this as OCI labels so the alignment survives a retag even without the tag
name: `org.opencontainers.image.version=<X.Y.Z>` and `io.vikunja.compat=<2.3.0>`.

**Release rule**: if a release changes the base Vikunja version this project targets (a
`docs/vikunja-openapi.json` refresh or an `e2e` pin bump that moves the base version), that's at
least a **minor** release per §1 — the tool contract is now validated against a different server
baseline — and its changelog entry and release notes should lead with *"now aligned to Vikunja
X.Y.Z"* so deployers notice. Every release's notes state the Vikunja version it's aligned to,
whether or not it changed.

Before cutting that release, actually validate against the new server version rather than just
bumping the pin: `VIKUNJA_VERSION=X.Y.Z npm run test:matrix` (see
[docs/LOCAL-TESTING.md](LOCAL-TESTING.md#version-matrix-testing-npm-run-testmatrix)) runs both
local e2e harnesses against it in one command and writes a pass/fail verdict, refresh the vendored
spec if needed (`npm run fetch:api-spec && npm run generate:api-types`), *then* bump the default
`e2e` pin and proceed with the release scope/checklist above.

## 8. The one rule that matters most

**`main` is always releasable.** Every PR — release or otherwise — must land with lint, typecheck,
and the full test suite (with coverage gate) green. A release should never require "wait, let me
also fix this failing test first" — if it does, that fix is its own PR that lands *before* the
release PR, not folded into it. And version numbers in `package.json` change in release PRs only —
never as a side effect of a feature or fix PR.
