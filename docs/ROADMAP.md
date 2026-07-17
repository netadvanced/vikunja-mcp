# Roadmap & Status

This document is the durable record of **where this project is going, where it stands, and why** — the vision, the locked architecture decisions, and the honest state of what's implemented, what isn't, and what's next.

Companion documents:
- **[Tracking issue #28](https://github.com/netadvanced/vikunja-mcp/issues/28)** — the live working checklist (waves, PRs, checkboxes). This roadmap explains *why*; #28 tracks *progress*.
- **[docs/API-COVERAGE.md](API-COVERAGE.md)** — the raw endpoint-by-endpoint audit (2026-07-17 snapshot) this plan was built from.
- **[docs/API_NOTES.md](API_NOTES.md)** / **[docs/VIKUNJA_API_ISSUES.md](VIKUNJA_API_ISSUES.md)** — hard-won implementation gotchas and known upstream API quirks. Read before touching endpoint code.
- **docs/ENDPOINT-PLAYBOOK.md** *(landing in Wave C)* — the how-to conventions for implementing new capabilities.

---

## 1. Vision — where we want to end up

An **AI-first MCP server for Vikunja**: not a 1:1 REST proxy, but a set of task-level tools an AI assistant can use reliably.

**Design pillars (all decided 2026-07-17, see §3):**

1. **Composite-first tools.** One MCP call may perform several API calls with logic between them: verify-then-apply, resolve names to IDs internally, create-if-missing (idempotent "ensure" semantics), read-composites that answer in one call what would otherwise take four. The OpenAPI spec is our *coverage checklist*, not our tool design. Primitives (plain CRUD) remain available as subcommands where fine-grained control matters.
2. **Direct REST on generated types; `node-vikunja` is end-of-life.** The npm client library this project was built on is frozen (v0.4.0, May 2025) and has confirmed drift from the real API — stale field names, wrong endpoints, missing coverage. All HTTP goes through our own thin REST layer (`src/utils/vikunja-rest.ts`) with TypeScript types **generated from the vendored OpenAPI spec**. The library is being removed domain-by-domain; a final PR deletes the dependency.
3. **Deployable and safe by configuration.** A layered config (defaults → `vikunja-mcp.config.json` → env vars, env wins) enables/disables whole modules at tool-registration time — disabled modules are invisible to the AI client. Dangerous surfaces (admin, user deletion, token management) are **deny-by-default**. Secrets never live in the config file: every sensitive env var has a `*_FILE` variant for Docker Swarm secrets / Kubernetes mounts. Container packaging follows once this lands.
4. **Honest semantics.** Vikunja has no transactions; our composites never pretend otherwise. A saga helper (`CompositeOperation`) provides opt-in best-effort rollback with compensations and full trace reporting; partial success is always reported explicitly. Tools that can't do something (deliver binary exports over MCP, persist templates across restarts) say so in their descriptions instead of pretending.
5. **Quality gates that mean something.** Every change lands as a PR with lint/typecheck/tests and a zero-net-new-regressions proof. The test suite reached fully-honest status in the 2026-07 repair waves; coverage thresholds will be ratcheted to honest values and raised as coverage grows.

## 2. Current state (2026-07-17, after repair waves A/B/A2)

**Working and audited-correct:** task CRUD + filtering (hybrid server/client with camelCase→snake_case translation), task comments, assignees, labels (on-task and standalone), relations, reminders (add/list/remove), attachments (upload), Kanban bucket listing + task placement, project CRUD/hierarchy/link-sharing, teams (full member management — rewritten against the real API), users (profile + settings, correct nesting), webhooks, auth session handling, batch-import, project export, templates (session-scoped).

**16 confirmed API-contract bugs were found by a spec audit and all fixed** (PRs #31–#41): among them team management was entirely non-functional (5 bugs), project *move* silently wiped fields (full-model-replace), share creation sent field names the server ignores, reminder removal could never succeed, relation counts were always 0, and user settings were read from the wrong nesting level. Two real security-validation regressions were also found and fixed. Test debt: 190 failing tests at baseline → 68 after waves A/B; the A2 mop-up targeting 0 is merging as this document lands.

**Known-limited today (deliberate, tracked):**
- `vikunja_filters` manages **local, in-memory** filters only — it does not touch Vikunja's real server-side saved filters (Wave D wires it to the real `/filters` API).
- `vikunja_templates` persists only for the server process lifetime (in-memory storage).
- User-data export can only trigger/report the server-side export — MCP cannot deliver binary files.
- GitHub Actions is disabled repo-wide for now (owner's call); all gates run locally per PR.

## 3. Locked architecture decisions

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

## 4. Coverage: implemented / planned / won't-implement

Vikunja documents **169 API operations**. Where they stand:

| Bucket | ~Count | Notes |
|---|---|---|
| Implemented & audited correct | ~59 | Includes all Wave B bug-fix rewrites |
| **Planned (Wave D)** | **~55–60** | See target surface below |
| Won't implement | ~50 | With reasons, below |

**Planned — the Wave D target surface (~8 domain groups):**
1. **Notifications & subscriptions & reactions** *(owner priority)* — new `vikunja_notifications` tool; subscribe/unsubscribe on projects/tasks; reactions on tasks/comments.
2. **Real saved filters** — rewire `vikunja_filters` to the server's `/filters` CRUD (replaces the local-only implementation).
3. **Project sharing with users & teams** — list/add/update-permission/remove for both; composite "share with user by name".
4. **Project views + duplicate** — views CRUD; `duplicate-project`.
5. **Kanban completion** — bucket create/update/delete; per-view task listing (real card order).
6. **Task extras** — documented `GET /tasks` (filter/order/expand), position, by-index lookup.
7. **Attachments read-side** — list/delete (download limited by MCP's no-binary constraint; metadata + guidance instead).
8. **Tokens, info, admin** — API-token management + `GET /info` (also used to validate connections); admin endpoints behind deny-by-default config.
Plus the remaining user-settings keepers (timezones, server-side export request) folded in where they fit.

**Won't implement (and why):**
- **Binary/blob endpoints** (project backgrounds, Unsplash, avatars, TOTP QR codes): MCP has no binary content channel; nothing useful to expose.
- **Credential ceremonies** (login, register, OIDC, password reset/change, TOTP enroll/enable/disable, email confirm): this server deliberately uses a pre-provisioned token; interactive auth flows belong to the web UI, and an AI assistant handling password ceremonies is an anti-pattern.
- **CalDAV tokens**: niche, and the underlying library call is broken upstream anyway.
- **Migration importers & testing endpoints** (21 ops): one-shot administrative migrations (Todoist/Trello/…) with file uploads — wrong tool for an MCP.
- **User deletion**: destructive account-level operation; excluded unless explicitly requested later (would be deny-by-default config in any case).

## 5. Target tool surface

~14 tools today → **~18–20 tools at end state**. Most new capability arrives as *subcommands on existing tools*, not new tools. New tools expected: `vikunja_notifications`, `vikunja_subscriptions` (possibly folded into tasks/projects), `vikunja_tokens` *(deny-by-default)*, `vikunja_admin` *(deny-by-default)*. On the order of 50–70 new subcommands, a meaningful share of them composites (ensure-label, share-by-name, project-overview, duplicate-project) that consume several endpoints each. Consolidation is deliberate: fewer, smarter tools cost less AI context and make module toggles meaningful.

## 6. Plan of record (waves)

| Wave | Scope | Status |
|---|---|---|
| A / B | Test-suite repair + 16 audit bug fixes (PRs #31–#41) | ✅ merged 2026-07-17 |
| A2 | Mop-up: remaining 68 failing tests → 0 (PRs #42–#45 + filters-suite PR) | 🔄 merging |
| **C** | **Infrastructure**: vendored spec + generated types; REST helper retry/breaker; module config + secrets; saga helper; endpoint playbook | next |
| **D** | **Capability build-out** (~8 domain groups above), each PR = new tools/subcommands **+ that domain's node-vikunja migration** | after C |
| E | Finish line: `node-vikunja` removed from package.json; upstream courtesy reports; coverage ratchet; CI re-enable (owner's call); optional Docker packaging | after D |

## 7. Contributing / how work lands

Every change: feature branch → PR on `netadvanced/vikunja-mcp` (never the upstream repo) → lint + typecheck + full test suite with a zero-net-new-regressions proof in the PR body → merge. Conventions for endpoint work live in docs/ENDPOINT-PLAYBOOK.md (Wave C). The OpenAPI spec vendored at `docs/vikunja-openapi.json` (Wave C) is the only source of truth for API shapes — never `node-vikunja`'s types.

*Maintained by the project coordinator; update this file when decisions change, keeping §3's decision log append-only.*
