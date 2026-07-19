# Local End-to-End Testing

This document describes the disposable local Vikunja stack in `docker/e2e/`,
used to run `scripts/test-mcp.ts` (`npm run test:mcp`) against a real Vikunja
server instead of mocks. The stack supports two DB backends — Postgres
(default) and SQLite (`VIKUNJA_DB=sqlite`, item F2 / tracking issue #28) —
see "DB backend variant" below.

> **Production safety.** This stack — and `npm run test:mcp` in general — is
> for a throwaway local Vikunja instance only. Never point `VIKUNJA_URL` /
> `VIKUNJA_API_TOKEN` at a production Vikunja instance, and never run this
> (or any automated test run) against one. `test:mcp` creates and deletes
> projects, tasks, and labels, and the bootstrap script creates a
> known-password test user — none of that is safe against real data.

## What's in `docker/e2e/`

- `docker-compose.yml` — a multi-service stack, namespaced under the compose
  project name `vikunja-mcp-e2e` so it can't collide with anything else
  running on the machine. Uses non-default host ports: **33456** for
  Vikunja (`VIKUNJA_URL` points here, same for both DB backends) and 33457
  for Postgres (optional, for ad-hoc `psql` debugging only, postgres backend
  only). Two DB-backend variants are defined as Compose *profiles* —
  `postgres` (`db` + `files-init` + `vikunja`, the pre-existing default) and
  `sqlite` (`sqlite-db-init` + `files-init` + `vikunja-sqlite`, added by item
  F2) — see the comment block at the top of the file for the full profile
  design and why it's profiles rather than a merged overlay file. All
  services have healthchecks and their data lives in named volumes
  (`vikunja-mcp-e2e-db`, `vikunja-mcp-e2e-sqlite-db`, `vikunja-mcp-e2e-files`)
  so the stack survives a restart. Only one profile is ever active at a
  time; both variants publish the same host port.
- `bootstrap.sh` — waits for the stack to become healthy, creates a test
  user via the Vikunja container CLI, logs in to get a JWT, and uses that
  JWT to mint a long-lived `tk_*` API token (falling back to the JWT itself
  if token creation fails). Writes `docker/e2e/.env` (gitignored) and
  prints `export VIKUNJA_URL=...` / `export VIKUNJA_API_TOKEN=...` lines.
  Safe to re-run against an already-bootstrapped stack (idempotent: it logs
  in with the existing test user instead of re-creating it, and mints a
  fresh token each time). Reads `VIKUNJA_DB` (default `postgres`) to select
  which Compose profile/service to bring up and bootstrap against.

## DB backend variant (`VIKUNJA_DB=postgres|sqlite`)

By default (`VIKUNJA_DB` unset, or `postgres`) this stack behaves exactly as
it always has: Vikunja backed by a real Postgres service. Set
`VIKUNJA_DB=sqlite` to instead run Vikunja against its own embedded SQLite
database (a file in the `vikunja-mcp-e2e-sqlite-db` named volume, no
separate DB service at all):

```bash
VIKUNJA_DB=sqlite npm run e2e:up
```

This exists because SQLite and Postgres have different concurrency
characteristics under concurrent writes — SQLite serializes writers with a
file lock, Postgres uses MVCC — so a whole class of bug (concurrent-write
lock contention, e.g. netadvanced/vikunja-mcp-ng#116: `bulk-create`'s
`maxConcurrency: 8` write fan-out 500ing with "database is locked" on
SQLite, then tripping the shared circuit breaker into a full create-endpoint
outage) was **structurally invisible** to every local/matrix run before this
variant existed, because this stack only ever ran Postgres. Running the
same harnesses against the `sqlite` variant surfaces that class of bug
instead of silently passing.

`npm run e2e:down` always tears down *both* profiles (`--profile postgres
--profile sqlite down -v`, see `package.json`) so `-v` reliably removes all
three named volumes regardless of which variant was last up — there is no
"leftover sqlite volume" case to worry about after a plain `e2e:down`.

`scripts/mcp-e2e.ts` includes one check explicitly written to catch this
class of bug: a 12-task `bulk-create` stress check, labeled
`(sqlite-sensitive, see #116)` in its output. It's expected to pass 12/12 on
Postgres and on a SQLite stack whose `bulk-create` write concurrency has
been fixed (e.g. serialized); on an *unfixed* SQLite stack it is expected to
intermittently under-create (partial success, e.g. 11/12) with
`"database is locked"` visible in `docker compose logs vikunja-sqlite` even
though the HTTP response body only ever says `"Internal Server Error"`. A
`FAIL` on this one check against `VIKUNJA_DB=sqlite` is expected and
documented, not a harness bug — see the PR that introduced this check for
recorded before/after evidence.

## Bringing the stack up

```bash
npm run e2e:up
```

This runs `docker/e2e/bootstrap.sh`, which itself brings the compose stack
up (`docker compose -f docker/e2e/docker-compose.yml up -d --wait`) before
bootstrapping it. On success it prints:

```
export VIKUNJA_URL=http://localhost:33456/api/v1
export VIKUNJA_API_TOKEN=tk_...
```

and writes the same two values to `docker/e2e/.env`.

## Running `test:mcp` against it

Either eval the printed exports directly:

```bash
eval "$(npm run e2e:up | grep '^export ')"
npm run test:mcp
```

or, once `docker/e2e/.env` exists (e.g. from a prior `npm run e2e:up`),
source it:

```bash
set -a && source docker/e2e/.env && set +a
npm run test:mcp
```

### Pointing a manual MCP client (e.g. Claude Desktop/Code) at the stack

Configure the server with the same two environment variables, e.g. in an
MCP client config:

```json
{
  "mcpServers": {
    "vikunja-e2e": {
      "command": "node",
      "args": ["/path/to/vikunja-mcp/dist/index.js"],
      "env": {
        "VIKUNJA_URL": "http://localhost:33456/api/v1",
        "VIKUNJA_API_TOKEN": "tk_..."
      }
    }
  }
}
```

Then follow `docs/MCP-TEST-CHECKLIST.md` for the manual walkthrough.

## Inspecting the stack by hand (web UI)

The `vikunja/vikunja` image serves the built frontend and the API from the
same process on the same port, so once `npm run e2e:up` reports the stack
healthy you can just open it in a browser:

- **Web UI:** http://localhost:33456/
- **API base:** http://localhost:33456/api/v1
- **Login:** the bootstrap-created test user — username `e2e-test`, password
  as set in `TEST_PASSWORD` at the top of `docker/e2e/bootstrap.sh` (a fixed,
  throwaway, local-only credential; it's never randomized, so the value in
  that script is always current and correct — check there rather than
  trusting a copy of it in this doc going stale).

This is a real login against the local instance, independent of the
`tk_*` API token in `docker/e2e/.env` — useful for eyeballing whatever
`test:mcp` (or a manual MCP client session) just created/changed in the
`MCP-Test` project, or any other project, while the automated run's output
is still on screen.

## Tearing the stack down

```bash
npm run e2e:down
```

This runs `docker compose -f docker/e2e/docker-compose.yml down -v`,
removing the containers **and** the named volumes (`-v`) — the stack leaves
nothing behind. Run it whenever you're done; there's no reason to leave a
Vikunja instance listening on localhost between sessions.

## How the bootstrap works, in detail

1. `docker compose ... up -d --wait` — waits for `db`'s `pg_isready`
   healthcheck and, once `db` is healthy and the one-shot `files-init`
   container has chowned the files volume to uid 1000 (the vikunja image
   runs as uid 1000 with no shell, so it can't fix that itself — see the
   comment in `docker-compose.yml`), for `vikunja`'s own `healthcheck`
   subcommand (`vikunja healthcheck`; the image is `FROM scratch`, so
   there's no curl/wget to probe `/health` with).
2. Attempts `POST /login` with the fixed test credentials
   (`e2e-test` / a fixed password, see `bootstrap.sh`). If that succeeds,
   the user already exists from a previous run and creation is skipped.
3. Otherwise, runs `vikunja user create -u e2e-test -e ... -p ...` via
   `docker compose exec` (the CLI baked into the same container image),
   then logs in.
4. Calls `GET /routes` with the JWT to discover every permission group and
   action the running server exposes, then `PUT /tokens` with a permissions
   object granting all of them and a 10-year expiry, producing a `tk_*`
   API token. If that call fails for any reason, falls back to using the
   JWT itself as `VIKUNJA_API_TOKEN` (the MCP server auto-detects JWT vs.
   API-token by the `eyJ`/`tk_` prefix — see `src/auth/AuthManager.ts`).

## Version pinning and refresh

The stack pins `vikunja/vikunja:2.3.0` — see the comment block at the top
of `docker/e2e/docker-compose.yml` for the full reasoning. Short version:
`2.3.0` is the latest stable tag on Docker Hub, and it's the closest
reproducible baseline to the vendored OpenAPI spec at
`docs/vikunja-openapi.json` (`info.version` = `v2.3.0-1019-g95b7e673`,
i.e. an `unstable` build 1019 commits ahead of the `v2.3.0` tag — that
spec was fetched from `try.vikunja.io`, which always runs `unstable`, via
`npm run fetch:api-spec`). Expect the vendored spec to document some
endpoints/fields slightly ahead of what `2.3.0` actually serves; that's a
**known, expected gap**, not test drift, unless it manifests as an actual
failure in a real run.

To refresh the pin when a newer stable Vikunja release ships:

1. Check available tags: `curl -s https://hub.docker.com/v2/repositories/vikunja/vikunja/tags?page_size=100`
   (or the [releases page](https://github.com/go-vikunja/vikunja/releases)).
2. Bump the tag in `docker/e2e/docker-compose.yml` and its comment block.
3. `npm run fetch:api-spec` to refresh `docs/vikunja-openapi.json` against
   the (unstable) spec, if you also want to re-check spec/tool alignment.
4. `npm run e2e:down && npm run e2e:up && npm run test:mcp` and re-triage
   any new failures using the same (a)/(b)/(c) categories as any other
   real-server run (script staleness / real server drift / environment
   issue — see the PR that introduced this stack for the categorization
   convention).

## Known limitation: `test:mcp` doesn't call the MCP tool layer

`scripts/test-mcp.ts` talks directly to the Vikunja REST API over `fetch()`
using the same request shapes the MCP tools use — it does not spawn the
MCP server or drive it over the MCP stdio/JSON-RPC protocol, and it never
calls anything under `src/tools/`. (It even has a leftover
`validateMCPResponse()` helper for validating an `{content: [...]}`-shaped
MCP tool response that is never called anywhere in the file.) A clean
`test:mcp` run confirms the real Vikunja server behaves the way the
scripted REST calls assume; it does **not** confirm that `src/tools/*.ts`
sends those exact requests. Cross-check against `docs/API-COVERAGE.md`
(which *is* audited against the actual tool source) for tool-level
correctness, and treat a clean `test:mcp` run as necessary but not
sufficient evidence that the MCP tools themselves are correct. The harness
below (`test:e2e:mcp`) closes that gap.

## True MCP-layer e2e harness (`npm run test:e2e:mcp`)

`scripts/mcp-e2e.ts` is the harness that actually exercises `src/tools/*.ts`
end to end, addressing the limitation above. Unlike `test:mcp`, it:

1. Runs `npm run build`.
2. Spawns `dist/index.js` as a real child process over stdio.
3. Connects to it with `@modelcontextprotocol/sdk`'s `Client` +
   `StdioClientTransport` — the same transport a real MCP client (Claude
   Desktop, Claude Code, etc.) uses.
4. Drives the server exclusively through `client.callTool()`. Every
   assertion in the run is against the actual tool response text (ids,
   titles, field values it round-trips), not just absence of an error.

Run it against the local stack:

```bash
npm run e2e:up   # if not already running
npm run test:e2e:mcp
```

It requires no environment variables — the stack's fixed local port
(`http://localhost:33456`) is hard-coded, and credentials are obtained
itself the same way `docker/e2e/bootstrap.sh` does (log in as `e2e-test`,
mint a fresh `tk_*` API token via `PUT /tokens`, tolerating the 201 the real
server returns where the spec documents 200). It doesn't need
`docker/e2e/.env` to exist.

### Coverage

`list-tools` (asserting the expected tool set, including the tools that
should be *absent* under API-token auth and default module config —
`vikunja_users`/`vikunja_export_*` are JWT-only, `vikunja_tokens`/
`vikunja_admin` are deny-by-default "dangerous" modules), then a
representative flow through the real tools: auth status/info/connect,
projects create/get/update/list, tasks create/update/list (both
project-scoped and the cross-project `GET /tasks` aggregation path),
labels create + apply to a task, assignees (resolved via project-user
search, then assign/list), comments create/list/get/update/delete,
reminders add/list/remove, Kanban list-views/list-buckets/set-bucket,
notifications list, and saved filters create/list/delete.

### Safety: never touches a real Vikunja instance

The harness deliberately does **not** read the ambient `VIKUNJA_URL` /
`VIKUNJA_API_TOKEN` environment variables that the MCP server itself (and
`scripts/test-mcp.ts`) honor. A developer's shell commonly has those
exported for day-to-day use of the server against a real Vikunja account
(direnv, a personal MCP client config, etc.) — during this harness's own
development, an early version *did* fall back to `process.env.VIKUNJA_URL`
when unset, and because the developer's shell already exported it for
unrelated reasons, a full run silently created, searched, and deleted data
against a real production Vikunja account instead of the disposable local
stack (fully cleaned up automatically by the harness's own teardown, but
the near-miss is exactly why this exists). To make that class of mistake
structurally impossible:

- The target URL is hard-coded to the documented local e2e port and is
  only overridable via the harness-specific `MCP_E2E_VIKUNJA_URL` — never
  the ambient `VIKUNJA_URL` — and is then required to resolve to
  `localhost`/`127.0.0.1`/`::1` or the process aborts immediately, before
  building or spawning anything.
- The API token is always freshly minted against that (now
  guaranteed-local) server; the ambient `VIKUNJA_API_TOKEN` is never
  consulted. `MCP_E2E_VIKUNJA_API_TOKEN` (again, a distinct name) can
  supply one explicitly, but only against the same localhost-checked URL.
- The spawned child process's env is built from a copy of `process.env`
  with `VIKUNJA_URL`/`VIKUNJA_API_TOKEN`/`VIKUNJA_API_TOKEN_FILE` stripped
  before overlaying the harness's own verified-local values, so no ambient
  credential can leak through to the server under test even indirectly.

### Idempotency / re-runnability

All test data is created under projects/labels/saved-filters named with the
`mcp-e2e-` prefix. Every run sweeps for and deletes any leftover
`mcp-e2e-*` data at startup (cleanup-by-name-prefix), so a prior failed or
interrupted run never blocks a fresh one, and also deletes everything it
creates in a `finally` block at the end — so the Vikunja UI is left clean
for a human to inspect between runs.

### Findings categorization

Every mismatch the harness finds is reported as one of:

- **harness** — a problem with the harness script itself (e.g. couldn't
  parse a response it should have been able to).
- **tool-bug** — the MCP tool layer sends or parses something wrong against
  the real server. Fixed inline when trivial and clearly in-scope (with a
  regression test), otherwise documented for follow-up.
- **server-drift** — the real server's behavior differs from the documented
  spec / this repo's implementation is correct but the pinned local Vikunja
  version's behavior isn't (e.g. an endpoint 500s regardless of what's sent
  — reproduced with a raw, tool-independent request to confirm it isn't
  this codebase's fault before filing it here).

A **known, currently-tolerated** instance of the last category:
`GET /tasks/{id}/assignees` returns HTTP 500 unconditionally on Vikunja
2.3.0 (fixed upstream on `go-vikunja/vikunja`'s `main` via PR #2791, not in
a tagged release yet as of this writing). The harness still *runs* this
check on every version — it is never globally skipped — but when it hits
exactly this signature, it's reported as `⚠ list task assignees
(server-drift, tolerated: ...)` instead of `✗ ...`: recorded as a
`server-drift` finding and excluded from the pass/fail counts and exit
code, rather than as a hard failure. See `driftTolerated()` in
`scripts/mcp-e2e.ts` for the implementation. **Remove this tolerance** once
a Vikunja release ships that fix and re-test — if it still 500s on a
newer tagged release, that's a new, real regression, not the same known
gap.

## Version-matrix testing (`npm run test:matrix`)

`scripts/test-matrix.ts` is the one-command runner that ties the two
harnesses above together against a *chosen* Vikunja server version **and**
DB backend, so re-validating this project against a newly-released Vikunja
tag, a different DB backend, or re-confirming it against the current
defaults, is a single command instead of a manual sequence of
stack-recreation and harness-invocation steps. The matrix is version × db
(item F2 / tracking issue #28 added the db dimension — see "DB backend
variant" above).

```bash
npm run test:matrix                                          # 2.3.0 / postgres (defaults)
VIKUNJA_VERSION=2.4.0 npm run test:matrix                     # a different tag, still postgres
VIKUNJA_DB=sqlite npm run test:matrix                         # default version, sqlite backend
VIKUNJA_VERSION=2.4.0 VIKUNJA_DB=sqlite npm run test:matrix   # both dimensions
```

For the chosen `VIKUNJA_VERSION` (default `2.3.0`, matching the compose
file's own default — see "Version pinning and refresh" above) and
`VIKUNJA_DB` (default `postgres` — see "DB backend variant" above), it:

1. **Ensures the stack is up on that version and backend.** If the local
   stack is already running and `GET /api/v1/info` reports the requested
   version *and* `docker compose ps` shows the requested backend's service
   (`vikunja` for postgres, `vikunja-sqlite` for sqlite) is up, it's reused
   as-is (still re-running `npm run e2e:up` to mint a fresh token into
   `docker/e2e/.env`, cheap and idempotent). If it's running a *different*
   version or backend, it's fully recreated (`npm run e2e:down` — which
   drops all three named volumes regardless of which variant was up, so
   there's no stale-schema/stale-backend risk — then `VIKUNJA_VERSION=
   <version> VIKUNJA_DB=<db> npm run e2e:up`). If it's not running at all,
   it's brought up fresh on the requested version/backend.
2. **Runs both harnesses against it**: `npm run test:mcp` (the ~23-check
   direct-REST suite) and `npm run test:e2e:mcp` (the ~50+-check MCP-tool
   -layer suite, including the `bulk-create` stress check labeled
   `sqlite-sensitive` — see "DB backend variant" above), streaming their
   output live and also capturing it.
3. **Reads the actual server version from `GET /api/v1/info`** rather than
   trusting the `VIKUNJA_VERSION` input — if the requested tag doesn't
   exist on Docker Hub (or the server otherwise comes up reporting
   something else), the run fails loudly with that mismatch instead of
   silently mislabeling results.
4. **Writes a verdict file** to `e2e-verdicts/vikunja-<server-version>-<db>.md`
   (gitignored — see "Verdict files aren't committed" below) with a
   `# vikunja-mcp-ng <our-version> vs Vikunja <server-version> (<db>): PASS/FAIL`
   header, the full per-check list from both harnesses (parsed from their
   own `✓`/`✗`/`⊘`/`⚠` stdout lines — see "Findings categorization" above
   for what those mean), and a closing verdict paragraph. The overall
   verdict is `PASS` only if *both* harnesses exit 0 with zero non-tolerated
   (`✗`) failures; `⚠ server-drift` entries don't block a `PASS`. Note that
   until the `bulk-create` write-concurrency fix for #116 lands, a
   `sqlite`-backend run is *expected* to `FAIL` on that one check — see "DB
   backend variant" above — so a `FAIL` verdict on `vikunja-2.3.0-sqlite.md`
   alone is not, by itself, a regression signal the way a `postgres` `FAIL`
   would be; check *which* check failed.
5. **Exits 0 on `PASS`, 1 on `FAIL`** — usable as a plain shell gate even
   without CI (GitHub Actions are disabled repo-wide by explicit owner
   decision; this is why this entire workflow is a local script rather
   than a workflow file).

### Safety

Exactly like `test:e2e:mcp` (see above), this script never reads the
ambient `VIKUNJA_URL` / `VIKUNJA_API_TOKEN` env vars — every child process
it spawns (`npm run e2e:down`, `npm run e2e:up`, `npm run test:mcp`,
`npm run test:e2e:mcp`) gets a copy of `process.env` with those (plus
`VIKUNJA_API_TOKEN_FILE`) stripped first. `test:mcp` needs *some*
credentials (unlike `test:e2e:mcp`, it doesn't mint its own), so this
script reads them explicitly out of `docker/e2e/.env` after bootstrapping
and hands them to that one child process only, asserting the URL resolves
to `localhost`/`127.0.0.1`/`::1` first. This matters concretely in this
repo: this directory has a real, production-pointed `.envrc` that a
developer's shell may already have loaded via direnv — never read `.env`
or `.envrc` directly, and never trust that ambient env vars are safe
defaults.

### Verdict files aren't committed

`e2e-verdicts/` is gitignored, the same convention as `coverage/` — a
verdict file is a point-in-time run artifact tied to whatever commit and
Vikunja version produced it, not something that stays accurate sitting in
the tree. Regenerate with `npm run test:matrix` rather than trusting a
stale committed one; paste or attach the freshly-generated file's contents
in a PR description when a run needs to be shown to a reviewer.

### When a new Vikunja release ships

1. `curl -s https://hub.docker.com/v2/repositories/vikunja/vikunja/tags?page_size=100`
   (or the [releases page](https://github.com/go-vikunja/vikunja/releases))
   to confirm the new tag exists.
2. `VIKUNJA_VERSION=X.Y.Z npm run test:matrix` — inspect the verdict; a
   `FAIL` needs triage (script staleness / real tool bug / new server-drift
   to document and tolerate the same way the assignees case above is
   tolerated) before going further.
3. If it passes (or once triaged failures are addressed), refresh the
   vendored spec if you also want to re-check spec/tool alignment:
   `npm run fetch:api-spec && npm run generate:api-types`.
4. Bump the *default* pin in `docker/e2e/docker-compose.yml` (the
   `${VIKUNJA_VERSION:-2.3.0}` fallback) and re-run `npm run test:matrix`
   with no override to confirm the new default is green.
5. Cut a **minor** release aligned to the new Vikunja version, per
   `docs/RELEASING.md` §7's Docker compatibility-tag scheme (`X.Y.Z`,
   `X.Y.Z-vikunja<A.B.C>`, `latest`) — changing the base Vikunja version
   this project targets is always at least a minor bump (see
   `docs/RELEASING.md` §1).

## Sample-page screenshot capture (`npm run capture:samples`)

`scripts/capture-sample-screenshots.ts` drives the real Vikunja *web UI*
(not just the API) with [Playwright](https://playwright.dev/) to capture
the screenshots embedded in `docs/samples/*.md` — the worked-example pages
linked from the main README. Unlike `test:mcp` / `test:e2e:mcp`, its output
isn't pass/fail assertions; it's PNGs written to `docs/samples/assets/` and
the corresponding `![...]  (assets/...)` embeds spliced into the sample
pages in place of `` `[SCREENSHOT: ...]` `` placeholder lines.

Playwright itself (the `playwright` npm package and its bundled Chromium)
is a devDependency, used only by this script — nothing under `src/` depends
on it, and it's not part of the published package (see `files` in
`package.json`).

Run it against the local stack:

```bash
npm run e2e:up   # if not already running
npx playwright install chromium   # first run only, or after bumping the playwright version
npm run capture:samples
```

It requires no environment variables — like `test:e2e:mcp`, it's hard-coded
to the local stack's fixed port and refuses to run against anything that
doesn't resolve to `localhost`/`127.0.0.1`/`::1`. It logs in as the
bootstrap-created `e2e-test` user via the real login form, and creates a
second CLI user (`sample-alice`, via the container's `vikunja user`
subcommand — there's no `/admin/users` API on the pinned stack version) to
demonstrate multi-user flows (sharing, assignment notifications).

### Idempotency / re-runnability

All seeded data — projects, labels, teams, and saved filters — is named
with a `sample-` prefix. Every run sweeps for and deletes any leftover
`sample-*` data (and the `sample-alice` CLI user) at startup, and deletes
everything it created in a `finally` block at the end, so the Vikunja UI is
left clean for a human to inspect between runs, the same convention
`test:e2e:mcp` uses for `mcp-e2e-*` data.

### When a described shot can't be honestly captured

A couple of the placeholders in `docs/samples/*.md` describe UI states this
script can't produce faithfully:

- **Mid-drag/mid-transition animations** (e.g. kanban-flow.md's card-move
  step) — Playwright can't capture an in-progress CSS transition frame on
  demand. The script performs the real move via the same REST endpoint the
  MCP tool uses, then captures the completed state, with a short note
  appended under the image explaining the substitution.
- **UI elements the pinned Vikunja version doesn't have** (e.g.
  stay-informed.md's "subscribe bell icon in the project header" — this
  version only exposes subscribe state via the project's "..." menu) — the
  script captures the nearest honest equivalent and notes the substitution.
- **The admin panel** (all three placeholders in admin-ops.md) — the pinned
  stack (`vikunja/vikunja:2.3.0`) doesn't implement the `/admin/*` API or
  its frontend at all (`GET /admin/overview` 404s; no `admin` group appears
  in `GET /routes`). This is the same documented spec/pinned-version gap
  described in "Version pinning and refresh" above — the vendored OpenAPI
  spec is captured from an `unstable` build ~1000 commits ahead of the
  pinned stable tag. Rather than fabricate a screenshot of a UI that isn't
  actually running, the script replaces those three placeholders with an
  explanatory note instead of an image. Re-run the script once the pin
  moves to a release that ships the admin panel.

### A note on `POST /notifications/{id}`

While building the "mark one read" capture, sending an empty body (as
`docs/vikunja-openapi.json` documents — "no request body") verifiably did
**not** persist a read state on the pinned server version, even after
repeated calls; sniffing the real frontend's own request showed it sends
`{"read": true}` explicitly, which does persist. The capture script does
the same. This is a capture-script-only workaround, not a change to
`src/tools/notifications.ts` (out of scope for the item that added this
script) — worth checking if `vikunja_notifications`'s `mark-read`
subcommand is ever reported as silently not sticking against a real
server.
