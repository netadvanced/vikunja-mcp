# Endpoint-tail re-triage (C2, 2026-07-18)

**Scope:** re-examine **all 64 `❌ Not implemented` operations** in [docs/API-COVERAGE.md](API-COVERAGE.md) under *today's* architecture — direct REST (`src/utils/vikunja-rest.ts` / `vikunjaRestMultipartRequest`) against types generated from the vendored OpenAPI spec (`docs/vikunja-openapi.json`, `v2.3.0-1019-g95b7e673`), with `node-vikunja` fully removed. The historical won't-implement verdicts (`docs/ROADMAP.md` §4) predate that migration; several rested on limitations that no longer apply (a broken client-library call, a blanket "binary/blob → nothing to expose" rule that mislabeled JSON endpoints, or "niche" reasoning that direct REST makes cheap). This pass re-justifies every verdict against the spec as ground truth.

**Why now:** this is Pierre's explicit C2 scope change. It is a **docs-only** re-triage — no production code changes. Every operation below is **still `❌` in the coverage table**; an `IMPLEMENT` verdict here means *approved-to-build*, not *built*. The `102 ✅ / 1 ⚠️ / 2 🟡 / 64 ❌` accounting is unchanged by this pass; a row only flips to `✅` in the PR that actually lands its code (the coverage doc's standing maintenance rule).

**Method:** each verdict was checked against the vendored spec — request/response schemas, `consumes`/`produces` (to tell a genuine binary blob from a JSON endpoint that was mislabeled as one), and path/verb. Where a verdict hinges on reserved infrastructure (e.g. the deny-by-default `userDeletion` module key) that was confirmed in `src/config/types.ts`. No live server was called.

## Verdict summary

| Verdict | Count | Meaning |
|---|---|---|
| **IMPLEMENT** | 20 | Feasible and worth building under direct REST; grouped into candidate wave items below. Still `❌` until code lands. |
| **PARKED** | 36 | Feasible but deliberately deferred (governance-sensitive, low AI value, or a security ceremony an assistant shouldn't drive). Each carries a concrete reopening trigger. |
| **NEVER** | 8 | Hard reason it makes no sense over MCP (pre-auth/anonymous credential ceremony, architecturally-unreachable session flow, or a destructive test-only endpoint). |
| **Total** | **64** | |

The headline change from the 2026-07-17 won't-implement list: **CalDAV tokens, user-deletion, task duplicate/mark-read, user-level webhooks, the server-side user-export status read, and the avatar-*provider* + a few background operations are all JSON endpoints trivially reachable via direct REST** — the old "binary/blob" and "niche, library-broken" rationales no longer hold for them. What stays parked (TOTP/OIDC/login/password/email ceremonies, migration importers, the genuinely-binary avatar/background *image* bytes) is re-justified below with today's reasons, not 2026-07-17's.

## Candidate IMPLEMENT backlog (proposed future wave items)

Grouped composite-first (per `docs/ROADMAP.md` §1 pillar 1 and decision 4 — the spec is a coverage checklist, not a tool design). Ranked high-value/low-risk first. Sizing is rough (S ≈ a subcommand or two reusing existing helpers; M ≈ a new sub-family or multipart/gated surface).

| # | Candidate item | Ops | Size | Home | Rationale |
|---|---|---|---|---|---|
| **G1** | **CalDAV tokens** — `list` / `create` / `delete` | 3 | S | New `vikunja_caldav_tokens` (parallels `vikunja_tokens`); consider a `caldavTokens` module key | All three are plain JSON (`GET`→`user.Token[]`, `PUT`→`user.Token` incl. the one-time secret, `DELETE {id}`→`models.Message`). Direct REST makes this trivial; the old "niche + library-broken" reason is moot (we hand-roll HTTP now). |
| **G2** | **Task duplicate + mark-read** — `duplicate`, `mark-read` | 2 | S | Subcommands on `vikunja_tasks` | `PUT /tasks/{taskID}/duplicate` (no body, returns the full duplicated `models.Task`) directly parallels the already-shipped `vikunja_projects duplicate`. `POST /tasks/{projecttask}/read` returns `models.TaskUnreadStatus` — pairs with the `is_unread` field. |
| **G3** | **User-export status** — `status` | 1 | S | Subcommand on the existing user-export surface (`vikunja_request_user_export` / `vikunja_download_user_export`) or a new `vikunja_user_export_status` | `GET /user/export` returns `models.UserExportStatus` (JSON: `id`/`created`/`expires`/`size`) — **not** a binary payload. It completes the request→status→download trio whose other two legs already ship. |
| **G4** | **User-level webhooks** — extend webhooks with a user scope | 5 | M | `vikunja_webhooks` gains `scope: user` (or a sibling `vikunja_user_webhooks`) | `/user/settings/webhooks*` uses the **identical `models.Webhook` shape** already handled for project webhooks — list/create/update/delete + an events list. Mostly a routing/scoping extension over proven code. |
| **G5** | **Avatar provider settings** — `get-avatar`, `set-avatar` (+ optional `upload-avatar`) | 2 (+1) | S (+M) | Subcommands on `vikunja_users` | `GET`/`POST /user/settings/avatar` exchange `v1.UserAvatarProvider` (`{avatar_provider}`) — **JSON, not image bytes** (the old "binary/blob" label was wrong for these two). Optional `PUT /user/settings/avatar/upload` is multipart, reusing the `vikunja_tasks attach` `vikunjaRestMultipartRequest` pattern (M). |
| **G6** | **User deletion** — `request` / `confirm` / `cancel` (governance-gated) | 3 | S (code) / design-heavy | New `vikunja_user_deletion`, gated behind the **already-reserved** deny-by-default `userDeletion` module key + an explicit `confirm: true` arg | All JSON (`request`/`cancel` take `{password}`; `confirm` takes the emailed `{token}`). `userDeletion` is already in `DANGEROUS_MODULE_KEYS` (`src/config/types.ts`) with no tool behind it yet — this is exactly the reserved slot's intended use. Small code, but ship with the same care as `vikunja_admin delete-user`. |
| **G7** | **Project backgrounds** (low-priority, cosmetic) — `remove-background`, `set-unsplash-background`, `search-unsplash` | 3 | S | Subcommands on `vikunja_projects`; consider an opt-in `backgrounds` module | The JSON subset only: `DELETE /projects/{id}/background`→`models.Project`, `POST /projects/{id}/backgrounds/unsplash` (body `background.Image`)→`models.Project`, `GET /backgrounds/unsplash/search`→`background.Image[]`. Feasible, but low value for a task-management assistant — bundle as an optional cosmetic module, not a priority. |

**Recommended sequencing:** G1–G4 are clean, low-risk quick wins on already-proven patterns and are the natural "endpoint-tail" wave (a batch of ~11 ops). G5's JSON pair is a cheap add; its upload leg is optional. G6 is small in code but governance-sensitive — treat as its own gated deliverable. G7 is optional/cosmetic and can stay parked until asked for.

## Full 64-operation re-triage

Legend: **S/M/L** = rough effort. "Was" = the 2026-07-17 won't-implement / not-built rationale being revised.

### IMPLEMENT (20)

| Method | Path | Verdict | Home | Was → now |
|---|---|---|---|---|
| GET | `/user/settings/token/caldav` | IMPLEMENT (S) | G1 `vikunja_caldav_tokens list` | "CalDAV niche / library-broken" → plain JSON `user.Token[]`, trivial via direct REST. |
| PUT | `/user/settings/token/caldav` | IMPLEMENT (S) | G1 `vikunja_caldav_tokens create` | Returns `user.Token` incl. the one-time secret (surface once, like `vikunja_tokens create`). |
| DELETE | `/user/settings/token/caldav/{id}` | IMPLEMENT (S) | G1 `vikunja_caldav_tokens delete` | Path-param only, `models.Message` response. |
| PUT | `/tasks/{taskID}/duplicate` | IMPLEMENT (S) | G2 `vikunja_tasks duplicate` | "Not yet built" → direct parallel to shipped project-duplicate; no body, returns full task. |
| POST | `/tasks/{projecttask}/read` | IMPLEMENT (S) | G2 `vikunja_tasks mark-read` | "Not built" → JSON `models.TaskUnreadStatus`; pairs with `is_unread`. |
| GET | `/user/export` | IMPLEMENT (S) | G3 export `status` | "Server-side export, not exposed" → returns `models.UserExportStatus` (JSON, not binary); completes the request/download trio already shipped. |
| GET | `/user/settings/webhooks` | IMPLEMENT (M) | G4 user-scope `list` | "User webhook family entirely absent" → identical `models.Webhook[]` to project webhooks. |
| PUT | `/user/settings/webhooks` | IMPLEMENT (M) | G4 user-scope `create` | Body `models.Webhook`, same shape as project webhooks. |
| GET | `/user/settings/webhooks/events` | IMPLEMENT (S) | G4 user-scope `list-events` | JSON array; mirrors project `GET /webhooks/events`. |
| POST | `/user/settings/webhooks/{id}` | IMPLEMENT (M) | G4 user-scope `update` | Update by id, `models.Webhook`. |
| DELETE | `/user/settings/webhooks/{id}` | IMPLEMENT (S) | G4 user-scope `delete` | Path-param only, `models.Message`. |
| GET | `/user/settings/avatar` | IMPLEMENT (S) | G5 `vikunja_users get-avatar` | "Binary/blob" → **wrong label**: returns `v1.UserAvatarProvider` (JSON `{avatar_provider}`), not image bytes. |
| POST | `/user/settings/avatar` | IMPLEMENT (S) | G5 `vikunja_users set-avatar` | "Binary/blob" → JSON body `v1.UserAvatarProvider`; sets the provider (gravatar/upload/…). |
| PUT | `/user/settings/avatar/upload` | IMPLEMENT (M) | G5 `vikunja_users upload-avatar` (optional) | "No equivalent avatar-upload built" → feasible via the `vikunja_tasks attach` multipart pattern; only meaningful when provider = upload. |
| POST | `/user/deletion/request` | IMPLEMENT (S) | G6 `vikunja_user_deletion request` | "User deletion won't-implement" → JSON `{password}`; `userDeletion` deny-by-default key already reserved. |
| POST | `/user/deletion/confirm` | IMPLEMENT (S) | G6 `vikunja_user_deletion confirm` | JSON `{token}` (emailed) — caller supplies the token; gated like the request leg. |
| POST | `/user/deletion/cancel` | IMPLEMENT (S) | G6 `vikunja_user_deletion cancel` | JSON `{password}`; the safe "undo" leg — arguably the most useful of the three. |
| DELETE | `/projects/{id}/background` | IMPLEMENT (S) | G7 `vikunja_projects remove-background` | "Binary/blob" → **wrong label**: returns `models.Project` (JSON). |
| POST | `/projects/{id}/backgrounds/unsplash` | IMPLEMENT (S) | G7 `vikunja_projects set-unsplash-background` | "Binary/blob" → JSON body `background.Image`, returns `models.Project`. |
| GET | `/backgrounds/unsplash/search` | IMPLEMENT (S) | G7 `vikunja_projects search-unsplash` | "Binary/blob" → returns `background.Image[]` (JSON); the image bytes stay parked, but search is JSON. |

### PARKED (36)

Feasible under direct REST, but deferred. Each row states today's reason + the trigger that would reopen it.

| Method | Path | Reason (2026-07-18) | Reopening trigger |
|---|---|---|---|
| POST | `/user/token` | Static pre-provisioned-token client holds no browser session to exchange for a one-time token; no current caller. | A concrete need for short-lived scoped tokens minted from the session. |
| POST | `/user/logout` | `disconnect` clears the local session; server-side logout is a no-op for `tk_*` API tokens and low-value for JWT. | A real JWT session-invalidation security requirement. |
| POST | `/user/confirm` | Email-confirmation ceremony; `vikunja_admin create-user` already covers provisioning via `skip_email_confirm`. | A self-service signup-confirm module is explicitly wanted. |
| POST | `/user/password` | Change-own-password (old+new) is a governance-sensitive account op an assistant shouldn't drive by default. | A deny-by-default self-service account-settings module. |
| POST | `/user/settings/email` | Change-email (triggers a confirmation ceremony); same governance concern, low AI value. | Same account-settings module as above. |
| GET | `/user/settings/totp` | 2FA status read has little value without the (parked) enrollment flow. | A user-driven security-settings module. |
| POST | `/user/settings/totp/enable` | Handing an AI the TOTP secret/passcode defeats the purpose of 2FA — an anti-pattern to automate. | Same security-settings module, with an explicit human-in-the-loop design. |
| POST | `/user/settings/totp/disable` | Disabling 2FA on the user's behalf is a security-downgrade an assistant shouldn't drive. | Same. |
| POST | `/user/settings/totp/enroll` | Enrollment ceremony (returns the secret; needs a passcode round-trip). | Same. |
| GET | `/user/settings/totp/qrcode` | Both a credential ceremony *and* genuinely binary (`produces: file` — the enrollment QR image). | Same, and only if a binary/image channel is solved. |
| GET | `/{username}/avatar` | Genuinely binary (`application/octet-stream`); a download-URL pattern is possible but avatar bytes are very low value. | A concrete avatar-display use case + the attachment-style download-URL contract extended here. |
| GET | `/projects/{id}/background` | Genuinely binary (`application/octet-stream`); download-URL pattern possible, low value. | Same as above for background images. |
| PUT | `/projects/{id}/backgrounds/upload` | Multipart image upload; feasible via the attach pattern but low value for a task assistant. | User demand for arbitrary background upload. |
| GET | `/backgrounds/unsplash/image/{image}` | Genuinely binary image bytes. | A solved binary/image delivery channel. |
| GET | `/backgrounds/unsplash/image/{image}/thumb` | Genuinely binary thumbnail bytes. | Same. |
| GET | `/routes` | API self-listing; no AI task-management use case. | A diagnostic/self-description feature that needs the route table. |
| POST | `/tasks/{taskID}/assignees/bulk` | Replace-semantics (`models.BulkAssignees`) silently unassigns everyone; the additive `PUT /assignees` loop is used deliberately (upstream issue #15). Unchanged by direct REST — still a footgun. | A genuine "set the exact assignee set" composite that *wants* replace-semantics — this is the correct primitive for that. |
| PUT | `/migration/csv/detect` | Vikunja's CSV-migration wizard; a one-shot admin import, wrong tool for MCP. `batch-import` already covers task CSV via normal creates. | Explicit demand to drive the native migration wizard through the assistant. |
| PUT | `/migration/csv/migrate` | Same migration-wizard family. | Same. |
| PUT | `/migration/csv/preview` | Same. | Same. |
| GET | `/migration/csv/status` | Same. | Same. |
| GET | `/migration/microsoft-todo/auth` | External-service migration requiring an OAuth ceremony; wrong tool for MCP. | Same. |
| POST | `/migration/microsoft-todo/migrate` | Same. | Same. |
| GET | `/migration/microsoft-todo/status` | Same. | Same. |
| PUT | `/migration/ticktick/migrate` | External-service migration importer. | Same. |
| GET | `/migration/ticktick/status` | Same. | Same. |
| GET | `/migration/todoist/auth` | OAuth-ceremony migration importer. | Same. |
| POST | `/migration/todoist/migrate` | Same. | Same. |
| GET | `/migration/todoist/status` | Same. | Same. |
| GET | `/migration/trello/auth` | OAuth-ceremony migration importer. | Same. |
| POST | `/migration/trello/migrate` | Same. | Same. |
| GET | `/migration/trello/status` | Same. | Same. |
| POST | `/migration/vikunja-file/migrate` | Vikunja-file importer (multipart `formData`); our own `export.ts` output is never round-tripped through it. Of the migration family this has the clearest latent value (import what we export). | A "restore/import a Vikunja export" feature is wanted — pairs with `vikunja_export`. |
| GET | `/migration/vikunja-file/status` | Status leg of the above. | Same. |
| PUT | `/migration/wekan/migrate` | External-service migration importer. | Same as other importers. |
| GET | `/migration/wekan/status` | Same. | Same. |

### NEVER (8)

Hard reason it makes no sense over MCP.

| Method | Path | Hard reason |
|---|---|---|
| POST | `/login` | Interactive username/password login (`user.Login`) hands the assistant raw credentials to mint a JWT — an anti-pattern — and is redundant: this server authenticates with a pre-provisioned token by design. |
| POST | `/register` | Self-service account creation ceremony; no coherent MCP flow. Legitimate provisioning is `vikunja_admin create-user` (deny-by-default, JWT-only). |
| POST | `/auth/openid/{provider}/callback` | OIDC browser-redirect callback — a web-UI ceremony with no meaning over a stdio MCP transport. |
| POST | `/user/token/refresh` | Requires a refresh-token cookie issued at browser login, which a static pre-provisioned-token client never holds. Architecturally unreachable, not merely deferred. |
| POST | `/user/password/reset` | Anonymous, pre-auth "email me a reset link" ceremony; no coherent caller for an already-authenticated pre-provisioned-token server. |
| POST | `/user/password/token` | Completes a reset with an emailed token — the anonymous pre-auth counterpart of the above; same hard reason. |
| DELETE | `/test/all` | Destructive test-only endpoint (wipes the DB); never exposed. |
| PATCH | `/test/{table}` | Test-only DB-seeding endpoint; never exposed. |

## Effect on the coverage accounting

None. All 64 rows remain `❌ Not implemented` (`102 ✅ / 1 ⚠️ / 2 🟡 / 64 ❌`). The 20 `IMPLEMENT` verdicts are *approved-to-build*, tracked as candidate wave items G1–G7 above; each flips to `✅` only in the PR that lands its code. `docs/API-COVERAGE.md`'s Notes column is updated for those 20 rows to record the new verdict and point here; the 36 `PARKED` / 8 `NEVER` rows keep their `❌` with reasons re-justified above. `docs/ROADMAP.md` §4's won't-implement list is rewritten to match, and its decision log carries a dated re-triage entry.
