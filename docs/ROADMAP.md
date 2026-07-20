# Roadmap & Status

This document is the durable record of **where this project is going, where it stands, and why** — the vision, the locked architecture decisions, and the honest state of what's implemented, what isn't, and what's next.

Companion documents:
- **[Tracking issue #28](https://github.com/netadvanced/vikunja-mcp-ng/issues/28)** — the live working checklist (waves, PRs, checkboxes). This roadmap explains *why*; #28 tracks *progress*.
- **[docs/API-COVERAGE.md](API-COVERAGE.md)** — the raw endpoint-by-endpoint audit this plan was built from, fully re-verified row-by-row on 2026-07-18 against `main` @ `ce81bd7` (post node-vikunja removal, Waves A–F). Its summary counts were recounted directly from the row markers on the same date (see §4) and match — no drift.
- **[docs/API_NOTES.md](API_NOTES.md)** / **[docs/VIKUNJA_API_ISSUES.md](VIKUNJA_API_ISSUES.md)** — hard-won implementation gotchas and known upstream API quirks. Read before touching endpoint code.
- **[docs/ENDPOINT-PLAYBOOK.md](ENDPOINT-PLAYBOOK.md)** — the how-to conventions for implementing new capabilities.
- **[docs/ENDPOINT-TAIL-RETRIAGE.md](ENDPOINT-TAIL-RETRIAGE.md)** — the C2 (2026-07-18) re-examination of all 64 not-implemented ops under direct REST, with the grouped IMPLEMENT backlog (see §4).
- **[docs/history/2026-07-18-competitive-review.md](history/2026-07-18-competitive-review.md)** — redacted snapshot of the 2026-07-18 competitive analysis against `@eargollo/vikunja-mcp`, the source for §3a's positioning notes.

---

## 1. Vision — where we want to end up

An **AI-first MCP server for Vikunja**: not a 1:1 REST proxy, but a set of task-level tools an AI assistant can use reliably.

**Design pillars (all decided 2026-07-17, see §3):**

1. **Composite-first tools.** One MCP call may perform several API calls with logic between them: verify-then-apply, resolve names to IDs internally, create-if-missing (idempotent "ensure" semantics), read-composites that answer in one call what would otherwise take four. The OpenAPI spec is our *coverage checklist*, not our tool design. Primitives (plain CRUD) remain available as subcommands where fine-grained control matters.
2. **Direct REST on generated types; `node-vikunja` is end-of-life.** The npm client library this project was originally built on was frozen (v0.4.0, May 2025) and had confirmed drift from the real API — stale field names, wrong endpoints, missing coverage. All HTTP now goes through our own thin REST layer (`src/utils/vikunja-rest.ts`) with TypeScript types **generated from the vendored OpenAPI spec**. The library was removed domain-by-domain across Wave D; the final PR (`waveD-node-vikunja-removal`, #73) migrated the last runtime call sites and type-only imports and **deleted the dependency** — `grep -rn node-vikunja src/ package.json package-lock.json` is zero, proven in CI-equivalent local gates.
3. **Deployable and safe by configuration.** A layered config (defaults → `vikunja-mcp.config.json` → env vars, env wins) enables/disables whole modules at tool-registration time — disabled modules are invisible to the AI client. Dangerous surfaces (admin, user deletion, token management) are **deny-by-default**. Secrets never live in the config file: every sensitive env var has a `*_FILE` variant for Docker Swarm secrets / Kubernetes mounts. Container packaging (multi-stage Dockerfile + compose example) landed in Wave E alongside the `vikunja-mcp-ng` repackaging.
4. **Honest semantics.** Vikunja has no transactions; our composites never pretend otherwise. A saga helper (`CompositeOperation`) provides opt-in best-effort rollback with compensations and full trace reporting; partial success is always reported explicitly. Tools that can't do something (deliver binary exports over MCP, persist templates across restarts) say so in their descriptions instead of pretending.
5. **Quality gates that mean something.** Every change lands as a PR with lint/typecheck/tests and a zero-net-new-regressions proof. The test suite reached fully-honest status in the 2026-07 repair waves; coverage thresholds are ratcheted to honest values and raised as coverage grows.

## 2. Current state (2026-07-18, after Waves A–E)

**All planned waves through E are complete.** In sequence:

- **Wave A — baseline repair.** Test suite journey: 190 failing → 68 (Wave A/B, PRs #31–#41) → 0 (Wave A2 mop-up, PRs #42–#46). `lint`/`typecheck` clean throughout.
- **Wave B — 16 confirmed API-contract bugs fixed** (~6 PRs, #31–#41): team management (5 bugs, was entirely non-functional), project *move* silently wiping fields, share creation sending ignored field names, reminder removal that could never succeed, relation counts always reading 0, user settings read from the wrong nesting level, plus 2 real security-validation regressions caught in the same sweep.
- **Wave C — build-out infrastructure**: vendored OpenAPI spec (`docs/vikunja-openapi.json`) + generated TS types; all HTTP centralized on `vikunjaRestRequest` with opossum retry + named circuit breakers; `CompositeOperation` saga helper; layered module-config + `*_FILE` Docker-secrets support; `docs/ENDPOINT-PLAYBOOK.md`.
- **Wave D — capability build-out + full node-vikunja migration**, three capability batches plus a migration sweep:
  - Batch 1 (subscriptions/notifications/reactions, real saved filters, project sharing, project views/Kanban buckets) — PRs #55–#59.
  - Batch 2 (task extras incl. direct `GET /tasks` as primary listing strategy, attachments read-side, tokens/admin/timezones, tool-surface dedupe, the local Docker e2e stack) — PRs #61–#65.
  - Batch 3, the migration sweep (MCP-layer e2e harness against the real stdio server; per-domain node-vikunja migration: tasks core, task sub-resources, projects/labels/teams/users, composites) — PRs #67–#72.
  - **Final removal** (PR #73): last ~19 call-sites + 18 type-only imports migrated, client factory stripped to session plumbing, dependency dropped from `package.json`. **`grep -rn node-vikunja src/ package.json package-lock.json` → 0 hits.** Decision 2 (§3) fully executed.
- **Wave E — repackaging** (PR #74): renamed to **`vikunja-mcp-ng`** (package/bin/MCP identity/server.json); multi-stage Dockerfile + compose example proven by a live `docker run` MCP smoke test against the local e2e stack; `docs/DOCKER-DESKTOP-MCP.md`; scenario-showcase README with every tool call verified against the code; seven `docs/samples/` pages + index; `npm pack --dry-run` publish-ready (name confirmed available on npm; not published yet — owner's call).

**Live numbers as of this document (measured fresh on `main` after the Wave F night-run merges, PRs #75–#81):**

| Metric | Value |
|---|---|
| Test suites | 130 passed / 130 total |
| Tests | 2,900 passed / 2,900 total, 0 failing |
| Coverage (stmts / branches / funcs / lines) | 89.44% / 80.22% / 78% / 89.72% vs. ratcheted gate 87/78/76/87 |
| Registered top-level tools | 22 (`src/tools/index.ts`), ~150 subcommands across them |
| API operations covered | 123 ✅ implemented + 1 ⚠️ implemented-with-bug + 1 🟡 partial + 44 ❌ not implemented = 169 total (73% clean-implemented) — recounted from `docs/API-COVERAGE.md` row markers after wave G-endpoint-tail (2026-07-18, +20 ✅ / −20 ❌ from the G1–G7 flips); matches its summary table exactly, no drift |
| Live verification | `npm run test:mcp` 23/23 against the local Docker e2e stack; MCP-layer e2e harness 50/51 (single failure is a documented Vikunja 2.3.0 server bug, not ours) |

**Known-limited today (deliberate, tracked):**
- `vikunja_templates` is session-only (in-memory) by default; opt-in JSON file persistence shipped in Wave F (PR #78) via the `templates.persistPath` config key / `VIKUNJA_MCP_TEMPLATES_FILE` env var (see §3a(b) — this is *why* SQLite was parked, not a competing effort).
- User-data export can only trigger/report the server-side export — MCP cannot deliver binary files.
- GitHub Actions is disabled repo-wide for now (owner's call); all gates run locally per PR — see §3b's acknowledged gap.
- Release engineering landed (`docs/RELEASING.md`, `CHANGELOG.md`, `scripts/release-{prepare,tag,publish}.sh`): SemVer policy, changelog discipline, and local release scripts are usable today; the tag-triggered publish workflow is INSTALLED as `.github/workflows/release.yml` (2026-07-20, owner decision): GitHub Actions re-enabled with a restricted policy (github-owned + docker/* actions only), npm publishes via OIDC Trusted Publishing (no tokens/secrets), the inherited ci.yml/security.yml were removed — 'only releases run CI' now enforced by having exactly one tag-triggered workflow.

## 3. Locked architecture decisions

This log is **append-only** — never edit or remove an existing row; add new dated rows as decisions are made or revised.

| # | Decision | Date |
|---|---|---|
| 1 | Single tracking issue (#28) + PR-per-change on this fork; no direct commits to main | 2026-07-17 |
| 2 | `node-vikunja` EOL: no new call sites ever; full per-domain migration; dependency removed at the end | 2026-07-17 |
| 3 | All new HTTP via `vikunjaRestRequest` + types generated from the vendored OpenAPI spec | 2026-07-17 |
| 4 | Composite-first tool design; spec = coverage checklist, not tool design | 2026-07-17 |
| 5 | Module enable/disable config: layered file+env, registration-time gating, config can only narrow auth, deny-by-default for dangerous modules | 2026-07-17 |
| 6 | Secrets via `*_FILE` env variants (Docker Swarm/K8s); never in the config file; both-set = startup error | 2026-07-17 |
| 7 | Saga/compensation helper for composites; opt-in `atomic`; destructive steps last; no fake ACID | 2026-07-17 |
| 8 | Upstream courtesy reports (democratize-technology/vikunja-mcp + node-vikunja) batched after our fixes land | 2026-07-17 |
| 9 | `node-vikunja` dependency fully removed from `package.json`; grep-zero proven; project repackaged as `vikunja-mcp-ng` with Docker distribution | 2026-07-18 |
| 10 | Go rewrite: **parked** (not rejected). See §3a(a) for the case and the reopening condition. | 2026-07-18 |
| 11 | SQLite persistence: **parked** in favor of an opt-in JSON file store for templates. See §3a(b) for the reopening trigger. | 2026-07-18 |
| 12 | Positioning adopted from the 2026-07-18 competitive review: global read-only mode + MCP tool annotations (adopted tonight, sibling PRs); version-pinned live e2e (adopted earlier, Wave D). See §3b. | 2026-07-18 |
| 13 | Endpoint-tail re-triage (C2): all 64 `❌` ops re-examined under direct REST. §4's won't-implement list rewritten to a 20 IMPLEMENT / 36 PARKED / 8 NEVER split (no coverage-count change); backlog G1–G7 in `docs/ENDPOINT-TAIL-RETRIAGE.md`. Supersedes the reasoning (not the append-only history) of decision 4's original won't-implement framing. | 2026-07-18 |
| 14 | The PR #63-era decision "bulk-update always per-task, never native" is **SUPERSEDED**. It was conditioned on `node-vikunja`'s malformed `{task_ids, field, value}` payload; that library is fully removed, and external PR #89 (credit: angusmaul) verified the real `models.BulkTask` contract `{task_ids, fields, values}` against a live Vikunja 2.3.0. New decision: native single-request bulk (`POST /tasks/bulk`) is now primary for scalar fields, with per-task fallback retained — **native-first because the direct-REST contract is verified and a single request avoids SQLite lock partial failures**. Condition to revisit: if the bulk endpoint's assignee-clearing bug is fixed upstream, the snapshot/restore workaround (PR #89) can then be dropped. Follow-up hardening (server-derived honest counts, surfaced assignee-restore failures, field allowlist) landed in the same PR wave. | 2026-07-18 |
| 15 | Follow-up to decision 14's revisit condition: source-verified 2026-07-18 against go-vikunja/vikunja source (`pkg/models/tasks.go`, `task_assignees.go`) — the bulk endpoint's assignee-clearing behavior is unfixed on `main` as of commit `2b7d31bfb`; no upstream issue found reporting this specific `fields`-vs-assignees gap (closed go-vikunja/vikunja#1459 is the closest prior art but predates the `fields`/`values` design added by #1456). A draft issue was prepared but not filed — pending owner review. Separately, the same verification pass found the bulk endpoint's `values.assignees` IS honored (just orthogonal to `fields`, unlike the "cannot be set at all" wording decision 14 implied) — this unlocked a narrow simplification: the post-bulk-update assignee-*restore* step (a complete per-task snapshot, not a general assign) now issues ONE `POST /tasks/{taskID}/assignees/bulk` (`models.BulkAssignees`) call per task instead of a per-user `PUT /assignees` loop, same `assigneeRestoreFailures` reporting contract. The snapshot/restore workaround itself (decision 14) stays — its revisit condition (upstream fix) remains open. | 2026-07-18 |
| 16 | **0.6.0 OIDC resource-server epic approved.** Full design in [docs/OIDC-RESOURCE-SERVER.md](OIDC-RESOURCE-SERVER.md) (owner review locked 2026-07-20). Four owner decisions anchor the doc: (a) credential vault = an **encrypted JSON file** (AES-256-GCM via `node:crypto`, per-record IV, master key via the existing `_FILE` secrets machinery, atomic write-then-rename mirroring `src/storage/templateFileStore.ts`) — **not** `better-sqlite3`; (b) `better-sqlite3` is **dropped from `package.json` entirely** (see below — this closes the loop on decision 11/§3a(b)); (c) circuit breakers **stay shared** across users (they protect the one shared upstream Vikunja; per-user rate limits handle noisy neighbors independently; accepted, honestly-documented cross-user coupling, revisit only if multi-Vikunja-instance support lands); (d) all other open questions the design raised are accepted as-is — stateless `StreamableHTTP` transport, `AsyncLocalStorage` request context, self-service provisioning via new `vikunja_auth` `provision`/`status`/`deprovision` subcommands (`sub` always from the validated token, never an argument), per-sub rate limits plus an optional global ceiling, a mock OIDC issuer as the e2e default with an optional real-Keycloak lane, `jose` promoted to a direct pinned dependency, and single-issuer config first with `(issuer,sub)` internal keying so multi-issuer stays additive. Two-wave plan (H1 transport+JWT+identity/isolation with a stub credential source; H2 vault+provisioning+hardening+mock-issuer e2e) with acceptance criteria is in the design doc. **`better-sqlite3` removal**: this closes the loop on decision 11 (§3a(b), SQLite parked 2026-07-18) — its reopening trigger ("a real relational or query need... simple durability alone does not meet this bar") was checked against the OIDC vault's needs and did **not** fire; the vault is a single key→token lookup, not a relational workload, so `better-sqlite3` (proven zero-usage by grep across `src/`, `tests/`, `scripts/`) is removed from `package.json` and the lockfile rather than finally being put to use. | 2026-07-20 |

### §3a. Evaluated options (parked)

Both items below were seriously considered on 2026-07-18 and explicitly **parked, not rejected** — each has a stated condition that would reopen it.

**(a) Go rewrite — parked 2026-07-18**

*The case for:* a single static binary and a tiny distribution image (no Node runtime, no `node_modules` layer); `go-vikunja`'s own generated model structs would give us the same "types from the source of truth" property we currently get from our generated OpenAPI types, without maintaining the generation step ourselves; the MCP-contract e2e harness built in Wave D (PR #67, spawns the real stdio server via the SDK client and asserts on the wire protocol, not the implementation) is a language-agnostic safety net — it doesn't care what language answers the stdio pipe, so a Go implementation could be validated against the exact same contract tests we already have.

*The case against:* the official MCP TypeScript SDK is the reference implementation the protocol spec itself is written against — a Go port inherits schema-validation and transport edge cases the TS SDK has already had shaken out. Our 2,900 verified tests (130 suites, built up over 6 waves against real audited API bugs) don't port for free — they encode hard-won knowledge (fetch-merge-not-replace on task/project updates, the assignee bulk-payload shape, id-vs-username conflation on team routes, dozens more) that would all need re-deriving and re-testing in a second language. The opportunity cost of a rewrite (weeks, minimum) directly competes with the capability-coverage and hardening work still on the roadmap (§4's 44 remaining unimplemented operations, the post-removal polish queue).

*Reopening condition:* a bounded spike — 2–3 tools reimplemented on the official Go SDK, validated end-to-end by the existing MCP-layer e2e harness (no new test infrastructure, reuse what we have) — **if distribution pressure grows** (e.g., users routinely blocked by "no Node/Docker available" rather than by missing capability). Not reopened speculatively.

**(b) SQLite persistence — parked 2026-07-18**

*The case for:* `better-sqlite3` is already a dependency (flagged as possibly-unused in the 2026-07-18 competitive review — worth resolving either way); a real embedded database would give `vikunja_templates` durability across restarts and open the door to a local task cache or offline read-through.

*The case against:* the immediate, concrete need — durable templates — is served by a much smaller opt-in JSON file store, landing as a sibling PR in this same wave. That's a few dozen lines of read/write-with-fsync against a config-supplied path, no schema migrations, no query planner, no new failure mode (corrupt DB file vs. corrupt JSON file are comparably bad but the JSON case is trivially hand-editable/recoverable). Introducing SQLite for a single flat key-value need is disproportionate.

*Reopening trigger:* a **real relational or query need** — e.g., a local task cache with filtering/joins, or genuine offline support requiring more than "read the last-known JSON blob." Simple durability alone does not meet this bar.

### §3b. Positioning & adopted recommendations

A competitive review run 2026-07-18 (redacted snapshot: [docs/history/2026-07-18-competitive-review.md](history/2026-07-18-competitive-review.md)) compared this project against `@eargollo/vikunja-mcp`, a minimal single-dependency competitor. Bottom line: **our lane is comprehensive and governed** — composite/subcommand tool design that reduces round-trips for real task-management workflows, breadth of capability (admin, batch-import, export, templates, reactions, reminders — none of which the competitor has), spec-generated types, and layered module/auth gating. Theirs is minimal and defensively postured — one runtime dependency, a flat 1:1-endpoint tool surface, and a stricter default (nothing can write or delete without an explicit env-var opt-in). Both are legitimate, different positions; the review found no reason to change this project's roadmap direction, but it did surface concrete, adoptable ideas:

- **Adopted tonight (sibling PRs, this wave):** a global read-only / write-off-by-default mode (their `VIKUNJA_MCP_ALLOW_WRITE`/`VIKUNJA_MCP_ALLOW_DELETE` pattern, adapted to our module-gating shape as a coarse blanket toggle layered on top of it, not a replacement for it) and MCP tool annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`) so capable MCP hosts can auto-approve reads and gate confirmations on destructive calls without server-side prompting logic.
- **Adopted earlier (Wave D, PR #65):** a version-pinned live e2e harness (Docker Vikunja 2.3.0, deliberately not `:latest`) — the same shape the competitor uses for the identical reason: catching real API drift instead of trusting a client library's types.
- **Acknowledged gap, not yet closed:** GitHub Actions remains disabled repo-wide by explicit owner decision (all quality gates run locally per PR instead). The competitor has materially more mature CI live today (CodeQL, SHA-pinned workflows, TruffleHog secret scanning, dependency-review gate). This is tracked, not disputed — revisit alongside the coverage ratchet (§2, §6) when CI is re-enabled on this fork.
- **Deliberately not adopted:** the flat 69-tool 1:1-REST-mirror shape itself — our composite/subcommand design is the more defensible choice for real usage and lower AI tool-list context cost at our target scale.

Correctness specifics found in the competitor's code during the review are not catalogued here — this is a public repo with a solo maintainer, and the standard we hold ourselves to (§3, decision 8: batch courtesy reports, don't publish upstream bug catalogs unprompted) applies to other projects' bugs too. See the redacted history snapshot for what's documented instead.

## 4. Coverage: implemented / planned / won't-implement

Vikunja documents **169 API operations**. Fully re-verified row-by-row on 2026-07-18 against current `main` (not just a marker recount of the existing table — every row's status was checked against `src/tools/**`/`src/utils/vikunja-rest.ts`, see `docs/API-COVERAGE.md`'s "Updated as of" line):

| Status | Count | % |
|---|---|---|
| ✅ Implemented | 123 | 73% |
| ⚠️ Implemented (bug) | 1 | 1% |
| 🟡 Partial | 1 | 1% |
| ❌ Not implemented | 44 | 26% |
| **Total** | **169** | 100% |

This re-verification found that most of the "implemented (bug)"/"partial" rows from the original audit had already been fixed by Wave B/C/D code changes but never re-graded in the coverage table — 8 of the 9 "implemented (bug)" rows and 2 of the 3 "partial" rows moved to ✅ on this pass, alongside 20 rows moving straight from ❌ to ✅ (project duplication, project views CRUD, Kanban bucket CRUD, direct user/team project sharing, and the export request/download tools, all of which existed in code but were undercounted). Only 1 ⚠️ row and 1 by-design 🟡 row remain; see `docs/API-COVERAGE.md`'s Issues table and Correctness Issues section for what's still genuinely open. This closes the "post-removal polish queue" re-grading item previously tracked here and in issue #28.

**Endpoint-tail re-triage (C2, 2026-07-18, decision 13).** All 64 `❌` operations were re-examined under the direct-REST architecture (`node-vikunja` removed) — the historical won't-implement list below predated that migration and several of its reasons no longer held (a broken client-library call; a blanket "binary/blob → nothing to expose" rule that had mislabeled JSON endpoints as blobs). New split: **20 IMPLEMENT (approved-to-build) / 36 PARKED / 8 NEVER**. At re-triage time this changed no coverage counts; as of **wave G-endpoint-tail (2026-07-18)** all 20 IMPLEMENT rows (candidates G1–G7) have since shipped and flipped `❌`→`✅` (64→44 `❌`, 103→123 `✅`), leaving the 36 PARKED and 8 NEVER rows as the remaining `❌`. Full per-operation verdicts, spec evidence, and the grouped backlog (G1–G7) are in **[docs/ENDPOINT-TAIL-RETRIAGE.md](ENDPOINT-TAIL-RETRIAGE.md)**; the flipped rows are annotated in `docs/API-COVERAGE.md`.

**Approved-to-build (20, were "won't-implement" or "not yet built" → now IMPLEMENT):** CalDAV tokens (G1); task duplicate + mark-read (G2); the server-side user-export *status* read (G3, JSON `UserExportStatus`, not binary); user-level webhooks (G4, identical `models.Webhook` shape to project webhooks); avatar *provider* get/set + optional upload (G5, the provider endpoints are JSON, not image bytes); user deletion request/confirm/cancel (G6, behind the reserved deny-by-default `userDeletion` key + `confirm: true`); and the JSON subset of project backgrounds — remove / set-unsplash / unsplash-search (G7, low-priority/cosmetic). None coded yet.

**Won't implement — parked (36, feasible but deferred; each has a reopening trigger in the re-triage doc):**
- **Genuinely-binary image bytes** (project/Unsplash background *images* + thumbs, per-user avatar bytes, TOTP QR image): MCP has no binary content channel; a download-URL pattern is possible but very low value. (Note: the avatar/background *settings* and Unsplash *search* are JSON and were re-graded IMPLEMENT above — only the raw image bytes stay parked.)
- **Account-settings & session ceremonies that are feasible but governance-sensitive/low-value** (change password, change email, email confirm, one-time `/user/token`, server-side logout): deferred pending an explicit self-service account-settings module.
- **TOTP 2FA flows** (status/enroll/enable/disable + QR): an AI driving 2FA enrollment/teardown is a security anti-pattern; parked for a human-in-the-loop security-settings module.
- **Migration importers** (19 ops: CSV wizard + Todoist/Trello/Wekan/TickTick/MS-Todo/vikunja-file): one-shot administrative imports with OAuth ceremonies / file uploads — wrong tool for an MCP; the vikunja-file importer has the clearest latent value (round-trip our own `export.ts`).
- **`POST /tasks/{taskID}/assignees/bulk`** (general assign/unassign): replace-semantics footgun (silently unassigns everyone); the additive `PUT /assignees` loop is used deliberately for that flow (democratize-technology/vikunja-mcp#15). Reopens only if a true set-exact-assignees composite is wanted for general use. (Since decision 15: this same endpoint IS used, narrowly, by `vikunja_tasks bulk-update`'s post-bulk assignee-*restore* step, where replace semantics are safe because a complete snapshot is being restored — see decision 15 and `docs/API-COVERAGE.md`.)
- **`GET /routes`**: API self-listing with no AI task-management use case.

**Never (8, hard reason it makes no sense over MCP):** interactive `login`/`register`, OIDC callback, JWT `token/refresh` (needs a browser refresh-cookie this static-token client never holds — architecturally unreachable), the two anonymous pre-auth password-reset legs, and the two destructive test-only endpoints (`DELETE /test/all`, `PATCH /test/{table}`). Legitimate account provisioning remains `vikunja_admin create-user`; destructive account deletion is exposed once, `vikunja_admin`'s `delete-user`, gated behind `confirm: true` + deny-by-default + JWT-only.

## 5. Target tool surface

**22 registered top-level tools today** (`src/tools/index.ts`), ~148 subcommands across them (`vikunja_auth`, `vikunja_tasks` + 6 task sub-resource tools, `vikunja_projects`, `vikunja_labels`, `vikunja_teams`, `vikunja_users`, `vikunja_filters`, `vikunja_templates`, `vikunja_webhooks`, `vikunja_batch_import`, `vikunja_export`, `vikunja_notifications`, `vikunja_subscriptions`, `vikunja_reactions`, `vikunja_tokens`, `vikunja_admin`). Most new capability arrives as *subcommands on existing tools*, not new tools — consolidation is deliberate: fewer, smarter tools cost less AI context and make module toggles meaningful (see §3b: this is the same axis the competitive review flagged as our clearest structural advantage over a flat 1:1-endpoint design).

Remaining target surface (from the original ~55–60-operation Wave D plan, now delivered): saved filters, project sharing (link shares plus direct user/team sharing), project views/Kanban CRUD, project duplication, task extras (position/by-index/direct listing/subtask composites), attachments read-side, tokens/admin/info — **all landed**. Of the 64 operations not implemented before this wave (§4), the C2 re-triage (2026-07-18) found **20 approved-to-build** — grouped as wave items G1–G7 in [docs/ENDPOINT-TAIL-RETRIAGE.md](ENDPOINT-TAIL-RETRIAGE.md); those 20 shipped in **wave G-endpoint-tail (2026-07-18)**, most as subcommands on existing tools (`vikunja_tasks`, `vikunja_users`, `vikunja_projects`, `vikunja_webhooks`) plus two small new tools (`vikunja_caldav_tokens`, `vikunja_user_deletion`). The remaining 44 are parked/never per §4; all remaining work is tracked in issue #28.

## 6. Plan of record (waves)

| Wave | Scope | Status |
|---|---|---|
| A / B | Test-suite repair + 16 audit bug fixes (PRs #31–#41) | ✅ merged 2026-07-17 |
| A2 | Mop-up: remaining 68 failing tests → 0 (PRs #42–#46) | ✅ merged 2026-07-17 |
| C | Infrastructure: vendored spec + generated types; REST helper retry/breaker; module config + secrets; saga helper; endpoint playbook | ✅ merged 2026-07-17 |
| D | Capability build-out (3 batches) + full node-vikunja migration + final removal (PRs #55–#73) | ✅ merged 2026-07-18 — `node-vikunja` gone, grep-zero proven |
| E | Repackaging as `vikunja-mcp-ng`: Docker distribution, scenario README, samples, Docker Desktop MCP how-to (PR #74) | ✅ merged 2026-07-18 |
| F | Docs pass: this roadmap rewrite, evaluated-options record, competitive-review snapshot, upstream courtesy report drafting, post-removal capability queue | in progress |

## 7. Contributing / how work lands

Every change: feature branch → PR on `netadvanced/vikunja-mcp-ng` (never the upstream repo) → lint + typecheck + full test suite with a zero-net-new-regressions proof in the PR body → merge. Conventions for endpoint work live in `docs/ENDPOINT-PLAYBOOK.md`. The OpenAPI spec vendored at `docs/vikunja-openapi.json` is the only source of truth for API shapes — never `node-vikunja`'s types (the dependency itself is gone as of Wave D, but the principle stands for any future client-library temptation).

*Maintained by the project coordinator; update this file when decisions change, keeping §3's decision log append-only.*
