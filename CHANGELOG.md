# Changelog

All notable changes to `vikunja-mcp-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) with
pre-1.0 semantics — see [docs/RELEASING.md](docs/RELEASING.md) for what that means in practice.

## [Unreleased]

Nothing yet.


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
[Unreleased]: https://github.com/netadvanced/vikunja-mcp/compare/v0.3.1...main
[0.3.1]: https://github.com/netadvanced/vikunja-mcp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/netadvanced/vikunja-mcp/commits/main/
[0.2.2]: https://github.com/democratize-technology/vikunja-mcp/releases/tag/0.2.2
