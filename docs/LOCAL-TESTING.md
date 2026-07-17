# Local End-to-End Testing

This document describes the disposable local Vikunja + Postgres stack in
`docker/e2e/`, used to run `scripts/test-mcp.ts` (`npm run test:mcp`) against
a real Vikunja server instead of mocks.

> **Production safety.** This stack — and `npm run test:mcp` in general — is
> for a throwaway local Vikunja instance only. Never point `VIKUNJA_URL` /
> `VIKUNJA_API_TOKEN` at a production Vikunja instance, and never run this
> (or any automated test run) against one. `test:mcp` creates and deletes
> projects, tasks, and labels, and the bootstrap script creates a
> known-password test user — none of that is safe against real data.

## What's in `docker/e2e/`

- `docker-compose.yml` — a three-service stack (`db`, `files-init`,
  `vikunja`), namespaced under the compose project name `vikunja-mcp-e2e`
  so it can't collide with anything else running on the machine. Uses
  non-default host ports: **33456** for Vikunja (`VIKUNJA_URL` points here)
  and 33457 for Postgres (optional, for ad-hoc `psql` debugging only).
  Both services have healthchecks and their data lives in named volumes
  (`vikunja-mcp-e2e-db`, `vikunja-mcp-e2e-files`) so the stack survives a
  restart.
- `bootstrap.sh` — waits for the stack to become healthy, creates a test
  user via the Vikunja container CLI, logs in to get a JWT, and uses that
  JWT to mint a long-lived `tk_*` API token (falling back to the JWT itself
  if token creation fails). Writes `docker/e2e/.env` (gitignored) and
  prints `export VIKUNJA_URL=...` / `export VIKUNJA_API_TOKEN=...` lines.
  Safe to re-run against an already-bootstrapped stack (idempotent: it logs
  in with the existing test user instead of re-creating it, and mints a
  fresh token each time).

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
sufficient evidence that the MCP tools themselves are correct.
