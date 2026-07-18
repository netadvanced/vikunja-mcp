# Competitive review: vikunja-mcp-ng vs @eargollo/vikunja-mcp (2026-07-18, redacted)

> **Archive note:** this is a redacted snapshot of a competitive analysis run 2026-07-18, kept
> for provenance behind `docs/ROADMAP.md` §3b's positioning claims. Per the same "no
> unprompted upstream bug catalog" norm this project holds itself to (ROADMAP §3, decision 8),
> the specific correctness findings from §6 of the original review have been replaced below
> with a one-line summary — a public repo with a solo maintainer gets a courtesy report before
> a public bug list, not after. Everything else (methodology, architecture/capability
> comparison, adopted recommendations, npm-namespace notes) is preserved as originally written.
> `docs/history/` is archive-only — see `docs/ROADMAP.md` for current guidance.

**Ours**: `vikunja-mcp` repo, main @ `eb89b6c`, published as `vikunja-mcp-ng`.
**Theirs**: `github.com/eargollo/vikunja-mcp` @ `98793ba` (2026-07-11), npm `@eargollo/vikunja-mcp@1.1.2`.

## 1. API coverage

| | Ours | Theirs |
|---|---|---|
| Vikunja operations covered | 73/169 (43%), 9 more implemented-with-bug, 3 partial (`docs/API-COVERAGE.md`) | 69 tools, each ~1:1 with one endpoint → ~69/169 (41%), by their own count |
| Domains covered | Tasks, projects, labels, teams, users, filters, templates, webhooks, batch-import, export, notifications, subscriptions, reactions, tokens, admin | Projects, tasks, labels, assignees, comments, relations, attachments (base64 in/out), kanban buckets, teams, sharing (user/team/link), saved filters, notifications/subscriptions, current user, API tokens, webhooks, CalDAV token minting |
| Tool count | 22 registered top-level tools (`src/tools/index.ts`), ~148 subcommands | 69 flat tools (`tools.js`, one per operation) |

**They cover that we don't:**
- CalDAV token issuance — we explicitly scoped this out (`docs/ROADMAP.md`, "niche, and the underlying library call is broken upstream anyway").
- Kanban bucket write ops (create/update/delete bucket, move task to bucket) are live in their default+write tiers; ours landed bucket listing in Wave D but bucket CRUD is still tracked as future work.
- Task attachment upload+delete via base64 in/out of MCP — we only ship read-side (list/get-info/delete) plus a signed-URL workaround for download; they also do upload (base64 request payload), something we don't attempt (fair — MCP truly has no binary channel, they route around it with base64 text, we don't; worth an honest look, see §7).

**We cover that they don't:** admin endpoints (8 ops, deny-by-default + JWT-gated), user account/settings (profile, general settings, timezones), batch-import (CSV/JSON), project export, task reminders, reactions, task relations listing+detail beyond bare kind/id, project duplication is not yet in either (tracked in our backlog, absent from their scope table too), OIDC/login flows (neither does this, by design on both sides), templates (session-scoped composite, unique to us).

## 2. Architecture

| | Ours | Theirs |
|---|---|---|
| HTTP layer | Own thin REST client (`src/utils/vikunja-rest.ts`), fully migrated off `node-vikunja` as of the current wave | Own thin REST client, `makeApi()` (114 lines), built on Node's native `fetch` |
| Typing/spec grounding | TypeScript types generated from the vendored OpenAPI spec (`docs/vikunja-openapi.json`), locked as the only source of truth | Plain JS, no generated types, no vendored spec — schemas hand-written per tool as JSON Schema literals |
| Error handling | Centralized `MCPError`/`ErrorCode`, `src/utils/error-handler.ts` | Centralized in `api.js`: maps `ECONNREFUSED`/DNS/TLS/timeout to readable messages, redacts sensitive response bodies for token/share/CalDAV paths by regex — a nice, small, deliberate touch |
| Retry/resilience | `opossum` circuit breaker (`src/utils/retry.ts`), though coverage is uneven — some paths bypass it per our own audit | **None.** No retry, no circuit breaker, anywhere. One request, one attempt, bounded only by a 30s `AbortSignal.timeout`. A network blip is a hard failure surfaced to the agent. |
| MCP SDK | `@modelcontextprotocol/sdk@^1.20.2` | `@modelcontextprotocol/sdk@^1.20.0` — functionally the same generation |
| Transport | stdio only | stdio only |
| Dependency footprint | 12 runtime deps (`@cfworker/json-schema`, `async-mutex`, `better-sqlite3`, `dotenv`, `express-rate-limit`, `jsonata`, `object-sizeof`, `opossum`, `tslib`, `uuid`, `zod`, the MCP SDK) + 20 devDeps | **1** runtime dependency — the MCP SDK itself, nothing else. This is their headline differentiator and it's real. |
| Build | TypeScript → `dist/`, Docker multi-stage build | Zero build step — plain Node ESM, `node index.js` runs the checked-in source directly |

The single-dependency, no-build-step posture is a genuine, well-executed architectural choice on their side, not a marketing line. Our multi-dependency surface buys real capability they don't have (Zod-validated composite arg schemas, jsonata for reaction/response shaping, a circuit breaker) at the cost of a much larger supply-chain surface.

## 3. AI-ergonomics

- **Tool surface size**: they expose 69 flat tools an AI must pick from every call; we expose 22 tools with ~148 subcommands selected via an enum arg. This is the single biggest philosophical divergence. Their README is explicitly a 1:1 REST-mirror table — no composites. Ours documents composites front-and-center: `share-with-user` resolves a username to an ID, applies, and verifies in one call; `duplicate` project; a daily-triage cross-project filter in one call.
- **Idempotency/name-resolution conveniences**: they have essentially none — most write tools require the caller to already have resolved IDs via a separate lookup tool call. Our composites fold resolution in.
- **Tool descriptions**: theirs are consistently good — short, factual, honest about limitations inline. Comparable in quality to ours; different in that ours also documents composite side-effects (verify-then-report) per-tool.
- **Response shaping**: they return lean, curated JSON per tool, deliberately smaller than raw Vikunja payloads — a genuinely good practice we mostly share via AORP-formatted responses, though ours carries more envelope (timestamps, affectedFields, previousState) which costs tokens for a benefit (diff visibility) they don't offer.
- **Net**: for a small, mostly-read agent workflow, their flat 69-tool surface is easy to reason about per-call but expensive in aggregate tool-list context. For anything approaching real task-management usage (bulk edits, cross-project triage, sharing flows), our composite/subcommand model reduces round-trips and error surface, at the cost of a steeper per-tool schema.

## 4. Safety/ops

Both projects take security seriously, converging on similar ideas from different angles:

| | Ours | Theirs |
|---|---|---|
| Tiered/gated access | Per-module enable/disable (`vikunja-mcp.config.json` + env, deny-by-default for `admin`/`tokens`) | Per-tool-tier enable/disable: `read`+`additive` always on, `write` needs an explicit env opt-in, `delete` needs a separate explicit env opt-in — simpler, coarser, and the *default* posture is stricter than ours (a fresh install of theirs literally cannot mutate or destroy data without an explicit opt-in; ours ships write-capable tools on by default, gating only `admin`/`tokens`). |
| MCP tool annotations | Not verified at time of review | `readOnlyHint`/`destructiveHint`/`idempotentHint` wired per tier, with a curated exception list for reversible deletes — a nice, cheap client-UX touch (auto-approve reads, confirm real deletes). |
| Secrets | Env vars + `*_FILE` variants for Swarm/K8s secret mounts; both-set is a hard startup error | Env vars only; no `_FILE` variant, no secret-mount story |
| Credential masking in logs | General-purpose masking utility | Regex-driven, narrower (3 hardcoded sensitive paths) but present and correct for what it covers |
| Destructive-op guards | `delete-user` requires explicit `confirm: true` beyond the tier gate | Tier gate is the only guard; no per-call confirm flag anywhere |
| Single egress point | Not centrally enforced the same way (documented exceptions exist) | Strictly enforced and grep-verifiable — a real, auditable trust boundary claim |

Their write/delete-off-by-default is a stronger default safety posture than ours — worth adopting or at least discussing (see §7). Their attack surface is also smaller by construction (one dep, one egress point), which is itself a safety property.

## 5. Quality signals

| | Ours | Theirs |
|---|---|---|
| Tests | 125 test files, Jest, ratcheted coverage gate | 6 test files, ~3,500 lines total, coverage gate 100% lines / 90% branches / 100% functions using Node's built-in coverage tooling (no nyc/istanbul/jest) |
| Live/e2e testing | `npm run test:mcp`; a version-pinned local Docker e2e stack | A live-Vikunja e2e test pinned to Vikunja 2.3.0 (deliberately, not `:latest`, so upstream can't silently break their CI) — a genuinely well-built, low-dependency harness |
| CI | Currently disabled repo-wide on our side by owner decision; gates run locally per PR | 4 workflows: unit+lint+e2e+`npm audit`, CodeQL (weekly + push/PR), OIDC trusted release publishing, Dependabot. All actions pinned to full commit SHAs. PR-only dependency-review and TruffleHog secret-scan jobs. Materially more mature CI than what we currently have live. |
| Docs | README + ROADMAP + TOOLS.md + API-COVERAGE.md (audit-grade) + CONFIGURATION.md etc. | README (comprehensive: quickstart, tool table, config, testing, releasing, security) + CHANGELOG + SECURITY.md + a releasing doc |
| License | MIT | MIT |
| Maintenance cadence | Active, multi-wave, dated 2026-07-17/18 in this cycle | Very high release cadence over a short window; young repo |
| Bus factor | Multiple contributors in git history | Single maintainer, zero external PRs merged — classic solo-maintainer risk |
| Traction | Not yet published under the new name | A few thousand npm downloads in the trailing 30 days — real, if modest, usage already; low GitHub star/fork count, no open user-reported bug issues |

## 6. Correctness spot-check

We checked five specific, tricky endpoint implementations in their codebase against our vendored OpenAPI spec (the shared ground truth). **Two correctness issues found; being reported to the maintainer via a courtesy issue.** No further detail is recorded here — see ROADMAP §3, decision 8 for why (batched, private-first courtesy reporting is this project's own norm, and we hold others to the same standard we'd want applied to us).

## 7. Worth adopting

Honestly, several things:

- **Write/delete-off-by-default as the out-of-the-box posture.** Their env-gated write/delete tiers mean a fresh install — even one with a fully-privileged token — cannot mutate or destroy data until an operator explicitly flips a flag. Our module gating narrows *which entities* are exposed but doesn't have an equivalent blanket "read+create only" starting posture. Worth a design discussion even if we don't adopt it wholesale (our composite tools make a clean read/write/delete split harder, but a coarse "safe mode" env var is cheap and valuable).
- **MCP tool annotations** (`readOnlyHint`/`destructiveHint`/`idempotentHint`, with an explicit reversible-delete exception list) — cheap, standards-based, lets capable hosts auto-approve reads and gate confirmations on destructive calls without server-side prompting logic. Worth checking whether we set these consistently.
- **Live e2e harness pinned to a specific Vikunja version**, not `:latest` — a clean, low-dependency pattern for catching real API drift, directly relevant to us since our whole `docs/API-COVERAGE.md` audit exists *because* a client library drifted silently.
- **Pinning GitHub Actions to full commit SHAs + Dependabot keeping them current**, and a secret-scan PR-gate, are both good, easy wins for when our currently-disabled CI comes back online.
- **An explicit "out of scope, by design, and why" README section** is a good documentation pattern: it forecloses "why doesn't this do X" issues and makes the security posture legible. Our `docs/ROADMAP.md` §4 does something similar ("Won't implement") — comparable quality, worth keeping in sync in spirit.
- **Base64 attachment upload** as a real (if awkward) way around MCP's no-binary-channel constraint — we treat this as fully out of scope for upload; they at least attempt it for files that fit in a reasonable base64 payload. Worth a deliberate "yes/no" decision rather than defaulting to "can't".

**Not worth adopting:** the flat 69-tool 1:1 REST-mirror shape itself (our composite/subcommand design is the more defensible choice for real usage and lower AI tool-list context cost), and the single-maintainer/no-CI-currently-live-elsewhere-either bus-factor risk obviously isn't a "feature" to copy.

## Bottom line

**Where we're clearly ahead:** breadth of unique capability (admin, batch-import, export, templates, reactions, reminders — none of which they have at all), composite/AI-ergonomic tool design that reduces round-trips for real task-management workflows, an explicit spec-generated-types architecture versus their hand-written-per-tool JSON Schemas, and a much larger active contributor base versus their bus factor of 1.

**Where they're ahead:** dependency minimalism (1 runtime dep vs. our 12) as both an architecture and safety property; a stronger default safety posture (write/delete opt-in, not opt-out); materially more mature CI running live *today*, versus ours which is currently disabled repo-wide; a 100%-line-coverage bar they actually hit with zero extra tooling; and a version-pinned live-Vikunja e2e harness that's simple enough to trust.

**Adopt:** write/delete-tier opt-in as a coarse safety mode; MCP tool annotations; version-pinned e2e docker harness; SHA-pinned CI with a secret-scan/dependency-review gate, once ours is back online.

**Does their existence change anything strategic?** Only mildly. Namespace collision risk is low — they publish as `@eargollo/vikunja-mcp` (scoped), we're heading to `vikunja-mcp-ng` (unscoped, confirmed available on npm as of this check). Note the unscoped name `vikunja-mcp` itself is already taken by a third, unrelated, apparently-dormant package — so there are now at least three independent Vikunja MCP servers on npm; discoverability, not naming collision, is the real competitive surface. Their download numbers after just over a week show there's real demand for a *minimal, security-first* Vikunja MCP server as a distinct positioning from a *comprehensive* one — validates that both approaches have an audience rather than suggesting either should abandon its lane. No reason to change our roadmap; there is reason to close our CI gap and consider a "minimal/safe-mode" story of our own, since that's the exact axis they're winning on.
