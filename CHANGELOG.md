# Changelog

All notable changes to `vikunja-mcp-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) with
pre-1.0 semantics — see [docs/RELEASING.md](docs/RELEASING.md) for what that means in practice.

## [Unreleased]

Nothing yet.







## [0.5.2] - 2026-07-22

A maintenance patch: sharing and filter bug fixes, a dependency security bump, and the
under-the-hood groundwork for Vikunja 2.4.0. The announced, hardened *"optimised for Vikunja 2.4"*
alignment — battle-tested, with v2 API fast-paths — is the upcoming **0.6.0** milestone; this
release only lays the groundwork and does not yet claim it.

### Added

- **Bucket position** — `vikunja_projects` create-bucket / update-bucket now accept an optional
  `position` argument to control kanban bucket ordering. Contributed by @angusmaul (#122).

### Changed

- **Vikunja 2.4.0 groundwork.** The e2e/version-matrix default pin moved `2.3.0` → `2.4.0`, the
  vendored OpenAPI spec was refreshed directly from the pinned 2.4.0 container and types
  regenerated (the only surface change: five creation endpoints corrected `200` → `201`), and the
  known `GET /tasks/{id}/assignees` server-drift tolerance is now version-gated — a hard failure on
  2.4.0+, where the upstream 500 is fixed. Minimum supported Vikunja remains **2.3.0**.

### Fixed

- **Sharing:** creating a link share now rejects a `name`/`title` mix-up instead of silently
  producing an unnamed share, and a `GET`-by-id on a just-created share no longer 404s (worked
  around an upstream link-share hash-vs-id bug by routing through the list endpoint) (#133).
- **Filters:** raw filter strings are now always re-serialized through the server-boundary field
  translation, so client-facing field names round-trip correctly instead of being rejected by the
  server's parser (#129).

### Removed

- Dropped the unused `better-sqlite3` dependency (declared but never imported).

### Security

- Overrode transitive `js-yaml` to `>=4.2.1`, clearing GHSA-52cp-r559-cp3m (a dev-scope
  quadratic-CPU advisory). `npm audit` reports zero vulnerabilities.

### Internal

- Docs: ground-up rewrite of `RELEASING.md` (including the mandatory pre-tag checklist) and a full
  audit refresh of `ROADMAP.md`; 2.4.0 API-coverage re-audit (no new endpoint surface); OIDC
  resource-server design doc added for a future OIDC mode.
- Test/CI: fixed the `spyOn`/`mockRestore` root cause and silenced localStorage teardown noise;
  bumped the release-workflow actions to current majors.

## [0.5.1] - 2026-07-20

First release published via npm Trusted Publishing (OIDC) from the tag-triggered GitHub Actions workflow — no tokens, with provenance attestation. Docker images now also publish to ghcr.io automatically.

### Fixed

- Bulk-create now serializes its task-creation writes. On SQLite-backed Vikunja, 8 concurrent creates triggered "database is locked" 500s whose retries amplified the contention and tripped the circuit breaker — turning a lock storm into a full endpoint outage (live repro: 2/12, 0/12, 0/12 created across three 12-task calls). Contributed by @angusmaul (#116), independently verified (#119) and live-proven on a real SQLite stack before merge

### Added

- SQLite variant for the local e2e stack (`VIKUNJA_DB=postgres|sqlite`), a DB dimension in the version matrix, and a SQLite-sensitive 12-task bulk-create stress check — the class of bug #116 exposed can no longer hide behind our Postgres-only test stack (#120)

### Chores

- Tag-triggered release workflow installed with OIDC Trusted Publishing; inherited never-run CI workflows removed — exactly one workflow, running only on version tags (#123)

## [0.5.0] - 2026-07-19

The agent-ergonomics release. A full battle-testing campaign (8 scenarios, REST-verified, run against a real local Vikunja) measured where AI agents actually struggle with the tool surface — every change in this release is backed by that evidence, and two changes we *thought* we needed were dropped because the evidence said otherwise.

### Added

- `bulk-set-bucket` (on `vikunja_tasks` and `vikunja_task_bulk`): distribute many tasks across Kanban buckets with one call — view/bucket resolution happens once, writes are sequential with honest per-task failure reporting (#114)
- `bulk-create-subtasks` on `vikunja_tasks`: create and relate multiple subtasks under a parent in one call, saga-compensated per subtask (#114)
- Battle harness: two new scenarios (existing-label reuse, project-rename-share probe) and a broadened validation-error classifier built from real campaign transcripts (#111)

### Fixed

- `vikunja_tasks update` no longer silently drops `bucketId` — it now routes through the shared bucket-placement logic and reports `bucketId` in `affectedFields` only when actually applied. This was the top friction in the campaign: agents lost their Kanban placement and burned 40% extra calls recovering (#112)
- `vikunja_filters build` now emits filter strings in the same camelCase the filter validator accepts (it previously emitted server-side snake_case, actively steering agents into validation errors); filter fields also accept snake_case aliases (`due_date`, `percent_done`, …) with normalization (#113)
- `vikunja_projects` id-domain subcommands (list-buckets, views, duplicate, backgrounds, …) accept `projectId` as an alias for `id` — the campaign showed agents reach for `projectId` first (#112)
- Residual API-coverage issues closed: batch-import no longer fires an empty user search; project-hierarchy fetches paginate honestly instead of a 1000-item cap; share listing accepts a search param; webhooks and user-search accept pagination params; export avoids a recursive refetch (6 fixed, 1 verified already-fixed) (#115)

### Chores

- Coverage ratchet raised to 89/89/80/78 (statements/lines/branches/functions)

## [0.4.1] - 2026-07-18

README-only patch so the npm package page reflects the published state: adds the "From npm" Quick Start (`npx -y vikunja-mcp-ng`), the npm version badge, and the post-rename repository links. No code changes.

## [0.4.0] - 2026-07-18

A capability batch: 20 newly implemented API operations (API coverage now 123/169, 73%), a native single-request bulk-update, and two new local test harnesses. No breaking changes; four new tool surfaces are disabled by default and opt-in via module config.

### Added

- `vikunja_caldav_tokens` tool (list/create/delete) behind a new deny-by-default `caldavTokens` module key, and a `vikunja_user_export_status` tool completing the user-export request/status/download trio (#98)
- `vikunja_users` avatar subcommands: `get-avatar`, `set-avatar` (provider validated against the server's accepted values), `upload-avatar` (multipart) (#99)
- `vikunja_user_deletion` tool (request/confirm/cancel) wired to the reserved deny-by-default `userDeletion` module key, with explicit `confirm: true` gates and secret masking (#100)
- `vikunja_webhooks` account-wide `scope: 'user'` covering `/user/settings/webhooks*` — list/create/update/delete/list-events (#101)
- `vikunja_projects` opt-in cosmetic backgrounds module (`remove-background`, `set-unsplash-background`, `search-unsplash`) behind a new default-off `backgrounds` key (#102)
- `vikunja_tasks` `duplicate` and `mark-read` subcommands (#103)
- Agent battle-testing harness: `npm run battle` spawns a headless AI agent against the tool surface and grades correctness (direct REST verification) and ergonomics (transcript friction metrics) (#96)
- Version-matrix e2e testing: `VIKUNJA_VERSION`-parameterized local stack and one-command `npm run test:matrix` verdict runner (#94)

### Fixed

- Bulk-update now uses Vikunja's native `POST /tasks/bulk` `{task_ids, fields, values}` contract — one request instead of N concurrent per-task writes, eliminating silent task loss under SQLite lock contention; per-task merge kept as fallback. Contributed by @angusmaul (#89), with follow-ups for server-derived success counts, surfaced assignee-restore failures (#95), and a single bulk-replace assignee restore per task (#103)
- Concurrent per-user assignee write loops serialized across six call sites (same SQLite lock-contention class); task-listing `sort` fields now validated against an allowlist with camelCase normalization instead of being silently ignored (#97)
- MCP e2e harness absence checks now model MCP SDK >=1.22 `{isError: true}` results instead of expecting thrown errors

### Documentation

- README factual pass: tool count corrected to 27, unshipped claims removed, safety wording aligned with actual behavior (#104)
- Endpoint-tail re-triage of all 64 not-implemented operations under the direct-REST architecture: 20 IMPLEMENT / 36 PARKED / 8 NEVER, with per-op rationale (#93)
- API coverage recounted after the endpoint-tail wave: 123 implemented / 44 not implemented; server-behavior notes replaced with Go-source-verified mechanisms

### Chores

- Coverage ratchet raised to 89/89/80/77 (statements/lines/branches/functions)

## [0.3.1] - 2026-07-18

A small patch release: a response-formatting bugfix plus the release engineering machinery
this very release was cut with, and two late chores/docs polish items. No tool signatures or
config shapes changed. Aligned to Vikunja 2.3.0 (unchanged from 0.3.0).

### Added

- Release engineering machinery: SemVer policy documentation, a Keep a Changelog
  `CHANGELOG.md`, and three dependency-free scripts (`release-prepare`/`release-tag`/
  `release-publish`) implementing the checklist in `docs/RELEASING.md`. A tag-triggered GitHub
  Actions publish workflow ships as an example file only
  (`docs/github-workflow-release.yml.example`), pending the owner's decision to enable Actions
  repo-wide (#88).
- Docker images now carry a Vikunja compatibility tag derived from the vendored OpenAPI spec's
  version, plus matching OCI labels (`org.opencontainers.image.version`, `io.vikunja.compat`),
  so a deployer can pick an image aligned to their Vikunja server version (#88).

### Fixed

- List responses no longer silently render an empty body for collections over 10 items — the
  hidden cutoff in `formatSuccessMessage` is replaced with a token-safe 50-item render cap, with
  an explicit "Showing 50 of N" notice beyond that (#85, via #87).
- List rendering no longer alternates between a rich heading layout and a plain line depending on
  item shape, which produced broken-looking interleaved lists — all list items now render
  consistently as numbered lines with sub-bullet detail; single-item ("get") responses keep their
  heading layout (#86, via #87).

### Documentation

- Rewrote README as a minimal landing page (pitch, badges, fork notice, one hero example, quick
  start, capabilities table), leaning on `docs/TOOLS.md` and `docs/samples/` for depth. From-source
  install is now primary; the npm package name isn't secured yet and isn't advertised (#90).

### Chores

- Revised the Docker Vikunja-compatibility tag introduced in #88 from a standalone floating
  `vikunja-<ver>` tag to a per-release suffix on our own version (`X.Y.Z-vikunja<A.B.C>`,
  `node:20-alpine`-style), eliminating the version-number ambiguity of the earlier scheme (#91).

## [0.3.0] - 2026-07-18

This release is the fork's coming-out story: `netadvanced/vikunja-mcp` started from
`democratize-technology/vikunja-mcp` at `0.2.2` with a failing test suite and a set of confirmed
API-contract bugs, and became `vikunja-mcp-ng` — a direct-REST, composite-first, Docker-distributed
MCP server with roughly triple the capability surface it started with. **Aligned to Vikunja
2.3.0** (see [docs/RELEASING.md](docs/RELEASING.md) "Vikunja compatibility" for what that means
and how it's tracked). See [docs/ROADMAP.md](docs/ROADMAP.md) for the full wave-by-wave account
this entry summarizes.

### Added

- Real saved filters, project sharing (link shares plus direct user/team sharing), project
  views/Kanban bucket CRUD, and project duplication (#55, #57, #58, #59).
- Notifications, subscriptions, and reactions tools (#56).
- Task extras: direct `GET /tasks` as the primary listing strategy, position/by-index access, and
  subtask composites (#64, #77).
- Attachments (read-side), API tokens, admin operations, and server info tools (#62, #63).
- A local Docker e2e stack and an MCP-layer end-to-end harness that drives the real stdio server
  via the SDK client and asserts on the wire protocol (#65, #67).
- Opt-in JSON file persistence for `vikunja_templates`, configurable via `templates.persistPath` /
  `VIKUNJA_MCP_TEMPLATES_FILE` (#78).
- Global read-only / write-off-by-default mode, layered on top of per-module config gating (#81).
- MCP tool annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint`) so capable hosts can
  auto-approve reads and gate destructive calls (#81).
- Docker distribution: multi-stage `Dockerfile`, compose example, `docs/DOCKER-DESKTOP-MCP.md`.
- `docs/ENDPOINT-PLAYBOOK.md`, `docs/ROADMAP.md`, and a scenario-driven README with a
  `docs/samples/` walkthrough page per scenario.

### Changed

- **Renamed the project and package to `vikunja-mcp-ng`** — package name, bin name, MCP server
  identity, and `server.json` all updated (#74).
- All HTTP now goes through a single REST helper (`vikunjaRestRequest`) on TypeScript types
  generated from a vendored OpenAPI spec (`docs/vikunja-openapi.json`), with `opossum`-backed retry
  and named circuit breakers (#49, #52).
- Introduced layered module configuration (defaults → `vikunja-mcp.config.json` → env, env wins)
  with deny-by-default gating for dangerous modules (admin, user deletion, token management), plus
  `*_FILE` env-var variants for Docker Swarm / Kubernetes secrets (#51).
- Added `CompositeOperation`, an opt-in best-effort saga helper with compensations and trace
  reporting for multi-call composite tools (#50).
- Coverage thresholds ratcheted upward four times in step with real, measured coverage growth
  (#48, #60, #66, #82).

### Fixed

- Test suite repaired from 190 failing tests to fully green (#31–#46), then held there through
  every subsequent wave — 130 suites / 2,900 tests / 0 failing as of this release.
- 16 confirmed API-contract bugs, including: team management being entirely non-functional (5
  bugs), project *move* silently wiping unrelated fields, share creation sending field names the
  API ignored, reminder removal that could never succeed, relation counts always reading zero, and
  user settings read from the wrong response nesting level (#31–#41).
- Two security-validation regressions caught in the same audit sweep (#31–#41).

### Removed

- **`node-vikunja` dependency removed entirely.** The client library this project originally
  depended on was frozen upstream (last release May 2025) with confirmed drift from the live API.
  Migrated per-domain across Wave D (tasks core, task sub-resources, projects/labels/teams/users,
  composites) and dropped from `package.json` in the final removal PR (#73). Verified zero-hit via
  `grep -rn node-vikunja src/ package.json package-lock.json`.

## [0.2.2] - fork point

Fork point from [`democratize-technology/vikunja-mcp`](https://github.com/democratize-technology/vikunja-mcp)
at `0.2.2`. Everything above `[0.3.0]` in this file describes work done on the fork
(`netadvanced/vikunja-mcp`, now `vikunja-mcp-ng`); history prior to the fork point lives in the
upstream project.

<!--
v0.3.0 predates this fork's first `v*` tag (v0.3.1), so it has no tag to compare from and keeps
a commits/main link. From v0.3.1 onward, releases are tagged and use standard
compare-between-tags links.
-->
[Unreleased]: https://github.com/netadvanced/vikunja-mcp-ng/compare/v0.3.1...main
[0.3.1]: https://github.com/netadvanced/vikunja-mcp-ng/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/netadvanced/vikunja-mcp-ng/commits/main/
[0.2.2]: https://github.com/democratize-technology/vikunja-mcp/releases/tag/0.2.2
