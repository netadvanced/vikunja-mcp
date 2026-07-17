# Endpoint Implementation Playbook

Conventions every Wave D domain implementation (agent or human) follows when
adding or migrating Vikunja API coverage. This is a working checklist, not an
essay — if you're about to write a new tool, subcommand, or REST call site,
read this first.

Companion docs: [ROADMAP.md](ROADMAP.md) (the vision/decisions this playbook
implements — read §1 and §3 first), [API-COVERAGE.md](API-COVERAGE.md) (the
endpoint-by-endpoint audit), [API_NOTES.md](API_NOTES.md) /
[VIKUNJA_API_ISSUES.md](VIKUNJA_API_ISSUES.md) (hard-won gotchas — do not
regress what they document). `docs/history/` is archive-only, never current
guidance.

---

## 1. Composite-first design

The OpenAPI spec is a **coverage checklist**, not a tool design. Don't mirror
endpoints 1:1. Design the smallest set of task-level subcommands an AI caller
actually needs, per ROADMAP §1 pillar 1:

- **Ensure-semantics / idempotency.** Prefer create-if-missing and no-op-on-
  retry over raw create/delete primitives where the caller's intent is "make
  this exist" or "make this be gone" rather than "perform this exact API call
  once."
- **Resolve-by-name internally.** Don't make the caller pre-fetch ids they
  shouldn't have to know. Exemplar: `setTaskBucket`
  (`src/tools/tasks/buckets.ts`) — the caller supplies a task id and a bucket
  id; the project id and Kanban view id are resolved internally via
  `vikunjaRestRequest` lookups (`resolveKanbanViewId` in
  `src/utils/vikunja-rest.ts`) rather than demanded as required arguments.
  Wave D composites that resolve a username or label/title string to an id
  follow the same shape: resolve first, call second, never make the model
  guess an id.
- **Verify-then-apply.** For mutations with side effects that matter (e.g.
  destructive or hard-to-undo changes), read current state, check it's what
  you expect, then write — don't write blind.
- **Read composites.** Where a caller would otherwise need several round
  trips to answer one question (e.g. "what's the state of this project"),
  offer a single read that assembles the answer in one call instead of
  making the client stitch several together.
- **Primitives stay available.** Plain CRUD subcommands remain for fine-
  grained control — composites are additive, not a replacement for direct
  access.

## 2. Spec-verification workflow

`docs/vikunja-openapi.json` (vendored, Wave C) is the **only** source of
truth for paths, verbs, and body field names.

- **Before coding:** look up the exact path, HTTP verb, and request/response
  body field names in the spec. Do not infer them from `node-vikunja`'s
  types, from memory, or from a similar-looking endpoint.
- **After coding:** re-check your implementation against the spec once more
  — field names are the most common place for drift (`right` vs
  `permission`, `filter` vs `filter_by`, nested vs flat, etc.).
- **Never trust `node-vikunja` types.** The library is frozen at v0.4.0 (May
  2025), confirmed to have drifted from the real API in multiple places, and
  is being removed from this project (ROADMAP §3 decision 2). If a
  `node-vikunja` type and the OpenAPI spec disagree, the spec wins, always.

## 3. Direct-REST rule

- All **new** HTTP calls go through `vikunjaRestRequest`
  (`src/utils/vikunja-rest.ts`). Never add a new `node-vikunja` call site —
  the library is end-of-life for this project.
- Each domain PR also **migrates that domain's existing `node-vikunja` call
  sites** to `vikunjaRestRequest`, per the domain-by-domain retirement plan
  (ROADMAP §3 decision 2, Wave D+ section). Don't migrate call sites outside
  your domain as a drive-by — that's a different PR's job.
- Type new REST calls against types generated from the vendored OpenAPI spec
  (Wave C infrastructure), not against `node-vikunja`'s bundled types.

## 4. Full-model-replace warning

Several Vikunja update endpoints (notably `POST /projects/{id}`) **replace
the entire resource** — any field you omit from the body is cleared
server-side, not left untouched. Before wiring an update endpoint, check the
spec for whether it's a full-replace (`PUT`/`POST` with a full model schema)
or a genuine partial-update (`PATCH`, or an endpoint documented as
merge-semantics).

**Pattern: fetch → merge → POST.** Exemplar: `buildProjectUpdatePayload`
(`src/tools/projects/crud.ts`) — fetches the current resource, spreads it,
then overlays only the fields the caller actually supplied, so untouched
fields survive the round trip. `updateProject`, `archiveProject`,
`unarchiveProject`, and `moveProject` all build their payload this way.
Watch for exceptions where "omitted" has real meaning: `moveProject` always
sets `parent_project_id` explicitly (to the new parent, or `0` for root)
because an omitted value there means "move to root," not "leave untouched"
— merge-preserves-untouched-fields is the default, but check whether your
endpoint has a field like this before assuming it applies uniformly.

## 5. Non-atomicity rules

Vikunja has no transactions. Never let a composite's response *imply*
atomicity it doesn't have.

- **Partial-success reporting is the default.** Multi-step composites must
  report which steps succeeded and which failed, explicitly, in the
  response — not swallow a mid-sequence failure into a generic error
  (batch-import precedent).
- **`CompositeOperation` saga helper** (landing alongside this playbook in
  Wave C, `src/utils/`) provides opt-in best-effort rollback for composites
  that want it: steps with optional compensations, reverse-order rollback on
  failure, full trace reporting (completed / compensated /
  compensation-failed + manual-fix guidance). Rules baked into it — follow
  them even in code that doesn't use the helper directly:
  - Destructive steps go **last** — Vikunja has no undelete.
  - Update-rollback restores the before-snapshot the fetch-merge-POST
    pattern already captured (§4) — don't fetch twice.
  - Guard on the resource's `updated` timestamp before compensating: if it
    changed since your snapshot, warn and don't clobber a concurrent edit.
  - Rollback is **opt-in per call** (`atomic: true`). Best-effort
    partial-success stays the default.
  - This is not real ACID: no isolation, and side effects (webhooks) fire on
    intermediate writes even if a later step fails and triggers rollback.
    Tool descriptions for any composite offering `atomic: true` must say so.
  - Prefer idempotent forward-recovery (ensure-semantics, §1) over rollback
    wherever "retry to completion" is a better UX than "undo and report
    failure."

## 6. Testing bar

**90%+ branches / 95%+ lines** (current ratcheted gate, see root
`CLAUDE.md`). But the bar that actually catches bugs is stricter than the
number:

- **Assert on the outgoing payload, not just the return value.** A mock that
  only checks the tool's return value can pass while the actual request body
  sent to the API is wrong. This is exactly how the `moveProject`
  data-wipe bug (fixed in the Wave B projects PR) shipped: `moveProject` sent
  a bare `{ parent_project_id }` as the *entire* body of a full-model-replace
  endpoint, silently clearing `title`/`description`/`hex_color`/etc. on every
  move — and the tests only checked the resolved response, never asserted
  `expect(mockClient.projects.updateProject).toHaveBeenCalledWith(id, {...
  full expected payload ...})`. Every write test needs a payload assertion
  like that.
- **Mock the *real* API shape, not a convenient one.** The users-settings
  nesting bug (Wave B `waveB-users-settings-nesting` PR) is the cautionary
  tale: `GET /user` actually returns settings nested under a `settings`
  sub-object, but the test mock returned them flat, matching the (wrong)
  code under test — the mock and the bug agreed with each other, so nothing
  failed. Build mocks from the OpenAPI spec's response schema, not from what
  makes the current implementation pass.
- Both rules apply doubly to anything migrated off `node-vikunja`: the old
  test suite's mocks may themselves be shaped like `node-vikunja`'s drifted
  types. Re-derive them from the spec during migration, don't carry them
  forward unchanged.

## 7. Subcommand / tool naming conventions

- Tools are `vikunja_<domain>`, domain in plural where the domain is a
  resource collection (`vikunja_tasks`, `vikunja_projects`, `vikunja_teams`).
- Every tool follows the subcommand pattern: a `subcommand` (or, in the older
  `vikunja_filters`, `action`) Zod enum routes to a handler — see root
  `CLAUDE.md`'s Tool Design Pattern. New tools use `subcommand`.
- Subcommand names are kebab-case verbs/verb-phrases matching what the
  caller is trying to do, not the HTTP verb: `set-bucket`, `apply-label`,
  `bulk-update`, `list-reminders`. Prefer `<verb>-<noun>` (`add-reminder`)
  over a bare verb when the tool has more than one thing that verb could
  apply to. (`toggleAdmin` on `vikunja_teams` predates this convention —
  match new work to kebab-case, not that exception.)
- Composite/ensure operations are named for the outcome, not the mechanism:
  `ensure-label` (not `find-or-create-label`), `share-by-name` (not
  `resolve-and-share`).
- Honesty in descriptions: if a tool or subcommand can't fully do what its
  name implies (no binary delivery, no persistence across restarts, no real
  atomicity), the Zod tool description says so in plain language — see
  `vikunja_filters` and `vikunja_templates` for the current examples, and
  the `vikunja_export_project` / `request-user-export` descriptions
  (`src/tools/export.ts`) for the house style on how bluntly to state a
  limitation.
