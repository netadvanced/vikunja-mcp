# Releasing

The ruleset for cutting a release of `vikunja-mcp-ng`. It assumes you're comfortable with git but
haven't necessarily tagged or published an npm package before — every step is spelled out. An
operator should be able to execute a release from this document alone.

Companion reading: [docs/ROADMAP.md](ROADMAP.md) for where the project stands,
[CHANGELOG.md](../CHANGELOG.md) for what's already shipped,
[docs/LOCAL-TESTING.md](LOCAL-TESTING.md) for the version-matrix/e2e harnesses referenced in the
pre-tag checklist, and [docs/BATTLE-TESTING.md](BATTLE-TESTING.md) for the agent battle-testing
harness also referenced there.

## 1. Policy

- **Pre-1.0 SemVer.** This project is `0.x.y`; major stays at `0` until the project is declared
  stable (§2, Step 7 covers what that eventually requires). We use the common pre-1.0 convention:

  | Bump | When |
  |---|---|
  | **patch** (`0.5.0 → 0.5.1`) | Bug fixes, doc corrections, dependency bumps, internal refactors — nothing a caller has to change for. |
  | **minor** (`0.5.x → 0.6.0`) | New capability *or* a breaking change to tool inputs/outputs/config. Pre-1.0, minor absorbs both — there's no separate major lane to reach for. Also the bump for any change to the base Vikunja version this project targets (§3). |
  | **major** (`0.x.y → 1.0.0`) | Reserved for the deliberate declaration that the project is stable — a status change, not a size threshold. |

  Rule of thumb: **if existing users have to change anything to keep working (config keys, tool
  argument shapes, removed subcommands, Node version floor), it's at least a minor bump, even
  pre-1.0.** A batch that mixes patch- and minor-level changes takes the higher bump.

- **Releases are deliberate, batch-time acts**, never something that happens automatically on a
  merged PR. Someone decides "it's time to cut a release," picks patch or minor, and runs the flow
  in §2. Version numbers in `package.json` change in exactly one kind of PR — a release PR —
  nowhere else.

- **Curated changelog from conventional commits.** `CHANGELOG.md` follows [Keep a
  Changelog](https://keepachangelog.com/en/1.0.0/). Each release's section starts as a mechanical
  draft generated from conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, …) since
  the last tag, then gets hand-curated (§2, Step 2) into something a user would actually want to
  read — this is the one manual, judgment-driven step in an otherwise scripted pipeline. The
  annotated release tag's message and the GitHub release notes are both generated directly from
  this section, so what you write there is what ships in three places at once.

- **`main` is always releasable.** Every PR — release or otherwise — lands with lint, typecheck,
  and the full coverage-gated test suite green. A release should never require "let me also fix
  this failing test first"; that fix is its own PR that lands *before* the release PR.

## 2. Release flow

```
release-prepare.sh <patch|minor> → curate CHANGELOG → open release PR → merge
  → pre-tag checklist → release:tag → tag-triggered workflow publishes
```

Steps 1–3 happen on a branch and go through normal PR review. Steps 4–7 happen on `main` after
that PR merges. Steps 1, 2, 5, and 6 are things an operator (human or agent, once scope is
decided) does by hand; step 7 is fully automated by `.github/workflows/release.yml` once the tag
lands.

### Step 1 — Decide scope and run `release:prepare`

Look at what's merged since the last tag (`git log v<last>..main --oneline`, or the `[Unreleased]`
section of `CHANGELOG.md` if it's current) and decide **patch** or **minor** per §1 — this is a
judgment call the script doesn't make for you. Then:

```bash
npm run release:prepare -- patch   # or: npm run release:prepare -- minor
```

`scripts/release-prepare.sh`:

- Refuses to run on a dirty tree or on `main` itself; creates its own branch (`release/vX.Y.Z`)
  off an up-to-date `main`.
- Runs the full gate suite (lint, typecheck, tests, coverage) before touching anything — a release
  never starts from red.
- Bumps `package.json`/`package-lock.json` via `npm version <patch|minor> --no-git-tag-version` —
  no git tag yet, that's Step 5.
- Generates a draft changelog section from conventional commits since the last tag and inserts it
  into `CHANGELOG.md` under `[Unreleased]`.
- Commits everything as `release: vX.Y.Z` and prints the next steps. It never pushes and never
  opens a PR — that's the operator's job next, so a human reviews the generated changelog first.

### Step 2 — Curate the changelog, open the PR

The generated section is a mechanical draft grouped by commit prefix. Read it, merge duplicate
lines, cut noise (`chore: fix typo`), rewrite terse entries into something a reader would
understand, and confirm entries sit in the right Keep a Changelog category (Added / Changed /
Fixed / Removed / Security). If this release changes the base Vikunja version the project targets,
lead the section with *"now aligned to Vikunja X.Y.Z"* (§3).

```bash
git push -u origin release/vX.Y.Z
gh pr create --repo netadvanced/vikunja-mcp-ng --base main \
  --title "release: vX.Y.Z" --body "See CHANGELOG.md"
```

### Step 3 — Merge the release PR

Ordinary review and merge, same gates as any other PR — nothing special except this PR is the
*only* kind allowed to touch the version field.

### Step 4 — Pre-tag verification checklist (mandatory)

**Do not run `release:tag` (Step 5) until every box below is checked.** Pushing a `vX.Y.Z` tag
immediately triggers the live, OIDC-authenticated publish workflow (Step 6) — there is no dry-run
and no undo for an npm publish.

- [ ] **Full local gates, clean.** `npm run lint && npm run typecheck && npm run test:coverage` —
      all three green on the exact commit you're about to tag. This should already be true from
      Step 3's merge gate, but re-confirm on `main` post-merge, not just on the branch beforehand.
- [ ] **Version-matrix regression, both DBs, on the version this release aligns to.** Run
      `VIKUNJA_VERSION=<aligned> npm run test:matrix` for both `VIKUNJA_DB=postgres` and
      `VIKUNJA_DB=sqlite` — see
      [docs/LOCAL-TESTING.md](LOCAL-TESTING.md#version-matrix-testing-npm-run-testmatrix) for what
      the runner does and how to read a verdict file. `<aligned>` is whatever
      `docker/e2e/docker-compose.yml`'s default pin currently is (currently `2.4.0` — see
      LOCAL-TESTING.md's "Version pinning and refresh"); omit `VIKUNJA_VERSION` to use that
      default explicitly.
  - [ ] `VIKUNJA_VERSION=<aligned> VIKUNJA_DB=postgres npm run test:matrix` — PASS.
  - [ ] `VIKUNJA_VERSION=<aligned> VIKUNJA_DB=sqlite npm run test:matrix` — PASS.
  - [ ] **Minimum-supported-version floor regression:** `VIKUNJA_VERSION=2.3.0 npm run test:matrix`
        (postgres is sufficient for the floor check unless the release touches DB-concurrency
        behavior, in which case run both backends) — `2.3.0` is the documented minimum supported
        Vikunja version (see
        [docs/LOCAL-TESTING.md](LOCAL-TESTING.md#version-pinning-and-refresh)), deliberately
        different from the aligned/default version so it never gets exercised by accident. A
        `FAIL` here needs the same triage as any other matrix failure (script staleness vs. real
        tool bug vs. new server-drift) before proceeding.
- [ ] **Live MCP harness expectations, read honestly, not assumed.** The matrix run above already
      executes both `npm run test:mcp` and `npm run test:e2e:mcp` per version/DB combination, but
      confirm you're reading the results against the *current* tolerances, not stale memory of a
      previous release: open `scripts/mcp-e2e.ts` and check what is currently version-gated (as of
      this writing, one documented tolerance — `GET /tasks/{id}/assignees` 500s unconditionally
      below Vikunja 2.4.0, tolerated only on servers `< 2.4.0` and a hard failure on 2.4.0+; see
      `driftTolerated()` / `versionLessThan()` in that file and
      [docs/LOCAL-TESTING.md](LOCAL-TESTING.md#true-mcp-layer-e2e-harness-npm-run-teste2emcp)'s
      "Findings categorization" section). Any `✗` (hard failure) blocks the release; any `⚠
      server-drift` must match a tolerance actually present in `scripts/mcp-e2e.ts` today — if the
      script's tolerances have changed since this paragraph was last edited, trust the script and
      update this paragraph in the same PR.
- [ ] **Battle smoke (cheapest scenario, manual, deliberate).** Run at least
      `npm run battle -- --scenario single-task-smoke --model haiku` (or the sonnet default) per
      [docs/BATTLE-TESTING.md](BATTLE-TESTING.md) — the harness that measures tool-surface
      ergonomics with a real agent, not just server correctness. **This costs real money and is
      never automated** (see BATTLE-TESTING.md's cost warning); one cheap scenario is the floor
      for every release. If this release changes tool descriptions, argument shapes, error
      messages, or adds/removes subcommands, run the full scenario library
      (`npm run battle -- --all`) instead and read the friction report for regressions before
      tagging.
- [ ] **Changelog curation, final pass.** Re-read the `CHANGELOG.md` section for this version once
      more on `main` post-merge (not just during Step 2's PR review) — this text becomes the
      annotated tag's message and the GitHub release notes (Step 6). Confirm it's accurate, in the
      right Keep a Changelog categories, and leads with the Vikunja alignment line if applicable
      (§3).

Only once every box above is checked, proceed to Step 5.

### Step 5 — Run `release:tag` (on `main`, after merge)

```bash
git checkout main && git pull
npm run release:tag
```

`scripts/release-tag.sh` reads the version out of `package.json`, verifies no tag `vX.Y.Z` already
exists, creates an **annotated** tag (`git tag -a`, not lightweight) on `HEAD` whose message is the
matching `CHANGELOG.md` section, and pushes it. A tag is a fixed pointer to one commit, always on
`main` — there are no release branches. **Pushing this tag immediately triggers the live release
workflow** (Step 6) — this is the point of no return; it's why Step 4 comes first.

### Step 6 — the tag-triggered workflow does the rest

Pushing the tag is what actually kicks off the release. `.github/workflows/release.yml` triggers
on any `v*` tag push and, on the tagged commit:

1. Re-runs the full gate suite (lint, typecheck, tests, coverage, build) — the release never
   publishes from an environment that hasn't re-verified green.
2. Verifies the tag matches `package.json`'s version.
3. Publishes to npm via **OIDC Trusted Publishing** — `npm publish --access public`, no npm token
   and no repository secret involved; npmjs.com is configured to trust this exact repo + workflow
   filename, and provenance attestation is generated automatically.
4. Builds and pushes the Docker image to `ghcr.io/netadvanced/vikunja-mcp-ng`, tagged `:X.Y.Z`,
   `:latest`, and the compatibility tag `:X.Y.Z-vikunja<A.B.C>` (§3), using the built-in
   `GITHUB_TOKEN`.
5. Runs `gh release create vX.Y.Z`, using the `CHANGELOG.md` section as the release notes.

This is the **only** Actions workflow in this repository — everyday PRs and branch pushes never
trigger it; general per-PR CI remains off by separate, still-standing owner decision (see
`docs/ROADMAP.md` §3b). Nothing further to run by hand once the tag lands, other than watching the
workflow run go green. If Actions is ever unavailable, see the Appendix for the manual fallback.

## 3. Vikunja alignment workflow

How this project tracks new upstream Vikunja releases, proven end-to-end aligning to 2.4.0
(tracking issue #28, item A1):

1. A new upstream Vikunja version ships.
2. Validate the tool surface against it before touching any pins:
   `VIKUNJA_VERSION=<new> npm run test:matrix` for both `VIKUNJA_DB=postgres` and `sqlite`, **and**
   the minimum-supported floor (`VIKUNJA_VERSION=2.3.0 npm run test:matrix`) to confirm the floor
   still holds — see
   [docs/LOCAL-TESTING.md](LOCAL-TESTING.md#version-matrix-testing-npm-run-testmatrix).
3. Refresh the vendored spec from the pinned container and regenerate types:
   `VIKUNJA_VERSION=<new> npm run e2e:up && npm run fetch:api-spec:container && npm run
   generate:api-types`. Use the container spec, not `npm run fetch:api-spec` (which hits
   `try.vikunja.io`'s `unstable` build, always ahead of any tag) — see
   [docs/API-SPEC.md](API-SPEC.md#where-the-spec-comes-from).
4. Audit the coverage delta: diff the refreshed spec against `docs/API-COVERAGE.md` for new,
   removed, or changed endpoints and update that doc's counts accordingly.
5. Bump the default `e2e` pin in `docker/e2e/docker-compose.yml` (and `docker/e2e/bootstrap.sh`'s
   matching default) to the new version.
6. Open an alignment PR containing the spec/type refresh, the coverage audit update, and the pin
   bump.
7. Ship it as a **minor** release (§1) — a change to the base Vikunja version is a change to the
   server baseline the tool contract is validated against, never a patch. Lead the changelog entry
   with *"now aligned to Vikunja X.Y.Z"*.

**Compat tag semantics.** Every release's Docker image carries the aligned Vikunja version as a
suffix on its own version, never as a standalone tag: `X.Y.Z-vikunja<A.B.C>` (e.g. `0.5.1` aligned
to `2.4.0` → `:0.5.1-vikunja2.4.0`), the same convention as `node:20-alpine`. This is deliberate:
an earlier scheme published a standalone floating `:vikunja-<ver>` tag that re-pointed at whichever
release was newest for a server version — exactly the ambiguity this scheme exists to avoid.
`scripts/lib/vikunja-compat-version.sh` is the single source of truth, deriving the compat version
from the vendored spec's `info.version` field rather than anyone hand-typing it; it also cross-
checks against the `e2e` pin and warns (doesn't fail) on drift. The image also carries this as OCI
labels (`org.opencontainers.image.version`, `io.vikunja.compat`) so alignment survives a retag.

**Minimum-supported vs. aligned** — the project supports a floor version in addition to the
current aligned/default version (currently floor `2.3.0`, aligned `2.4.0`); see
[docs/LOCAL-TESTING.md](LOCAL-TESTING.md#version-pinning-and-refresh) for the policy and what
keeps a workaround alive past the point its target bug is fixed upstream.

## 4. Appendix — manual fallback

`scripts/release-publish.sh` (`npm run release:publish`) is the documented fallback for the rare
case where GitHub Actions is unavailable and a release can't wait. It is **disaster-recovery
only** — the tag-triggered workflow (§2, Step 6) is the normal path for every release.

```bash
git checkout vX.Y.Z   # or stay on main right after scripts/release-tag.sh
npm run release:publish            # add --push to also push the Docker image
```

It re-verifies HEAD is the tagged commit, re-runs the full gate suite, then does by hand what the
workflow does automatically: `npm publish --access public`, build-and-tag the Docker image
(pushed only with `--push`), and `gh release create vX.Y.Z` from the `CHANGELOG.md` section.

Unlike the tag-triggered workflow, this path does **not** use OIDC Trusted Publishing — `npm
publish` here authenticates as whatever account is logged in locally, which for an account with
2FA set to "auth and writes" (the norm for a security-conscious npm org) means an **interactive
npm web-auth prompt (security-key/WebAuthn confirmation) in a browser** during the publish step.
It is not headless and cannot run unattended in CI — another reason it's a fallback, not the
primary path.
