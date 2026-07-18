# Registering vikunja-mcp-ng with Docker Desktop's MCP Toolkit

This is an honest, tested-on-this-machine how-to for running `vikunja-mcp-ng`
through Docker Desktop's MCP Toolkit (`docker mcp` CLI / `docker/mcp-gateway`)
rather than as a bare `docker run -i` wired into your client config. It was
verified against `docker mcp` CLI **v0.43.1** on macOS with Docker Desktop —
commands and flags may drift on other versions; re-check `docker mcp --help`
if something below doesn't match what you see.

## TL;DR feasibility verdict

**Full native catalog integration (`docker mcp catalog create --server
docker://<image>`) does not work for this image**, and won't for any plainly
Dockerfile-built stdio server: it requires what the CLI calls a
"self-describing image" — an image built and published through Docker's own
MCP catalog pipeline that embeds tool/resource metadata Docker can introspect
without running it. A normal `node:20-alpine` image with an `ENTRYPOINT`
(exactly what this project's `Dockerfile` produces) is rejected:

```
$ docker mcp catalog create my-catalog:latest --server docker://ghcr.io/netadvanced/vikunja-mcp-ng:dev
failed to resolve image snapshot: failed to get catalog server from image:
image ghcr.io/netadvanced/vikunja-mcp-ng:dev is not a self-describing image
```

**The workaround that does work, verified end-to-end below: a hand-written
`catalog.yaml` fragment plus `docker mcp gateway run --catalog=...`.** This is
the same mechanism `docker mcp server init` scaffolds for brand-new servers
(see its generated `catalog.yaml`/`compose.yaml`) — it's not a hack, it's the
toolkit's own documented-by-example format for a catalog entry that doesn't
need image introspection. Docker's gateway runs the container itself
(`docker run --rm -i --init ...`), handles env/secret injection, and reports
the real tool list — this was confirmed against the live local Vikunja stack
(18 tools registered for an API-token session, matching a direct `docker run
-i` smoke test exactly).

If neither of those suit your client, the **closest, simplest workaround** is
skipping the Toolkit/gateway layer entirely and pointing your MCP client
straight at `docker run -i` — see [Fallback](#fallback-plain-docker-run-no-toolkit)
below. That's also what the main [README](../README.md#quick-start) leads
with, since it needs no Docker Desktop MCP Toolkit knowledge at all.

## Prerequisites

- Docker Desktop with the MCP Toolkit installed (`docker mcp --help` should
  print a command list, not "unknown command").
- The image built locally (`docker build -t
  ghcr.io/netadvanced/vikunja-mcp-ng:dev .` from the repo root — see the
  [README](../README.md#docker-image)) or pulled from `ghcr.io` once it's
  published.
- A Vikunja API token or JWT (see [CONFIGURATION.md](CONFIGURATION.md)).

## Option A (recommended): custom catalog.yaml + `docker mcp gateway run`

1. **Write a catalog fragment.** `scripts/install-docker-desktop-mcp.sh`
   generates one for you — it only *prints* the fragment and the commands to
   apply it; it does not touch your `~/.docker/mcp` directory on its own:

   ```bash
   scripts/install-docker-desktop-mcp.sh ghcr.io/netadvanced/vikunja-mcp-ng:dev \
     https://your-vikunja-instance.com/api/v1
   ```

   Or write it by hand — this is the exact shape verified working:

   ```yaml
   # ~/.docker/mcp/catalogs/vikunja-mcp-ng.yaml
   registry:
     vikunja-mcp-ng:
       description: MCP server for Vikunja task management (direct-REST, composite-first tools)
       title: Vikunja MCP NG
       type: server
       image: ghcr.io/netadvanced/vikunja-mcp-ng:dev
       secrets:
         - name: vikunja-mcp-ng.api_token
           env: VIKUNJA_API_TOKEN
           example: tk_xxx
           description: Vikunja API token (tk_...) or JWT (eyJ...)
       env:
         - name: VIKUNJA_URL
           value: https://your-vikunja-instance.com/api/v1
   ```

   `--catalog` (and `--additional-catalog`) require the file to resolve under
   `~/.docker/mcp/catalogs/` — that's a hard constraint of the gateway, not a
   suggestion.

2. **Store the token as a Docker Desktop secret** — never in the catalog
   file, which is meant to be shareable/committable:

   ```bash
   echo "tk_your_real_token" | docker mcp secret set vikunja-mcp-ng.api_token
   ```

   This lands in the local OS Keychain (`docker mcp secret ls` to confirm,
   `docker mcp secret rm vikunja-mcp-ng.api_token` to remove it later).

3. **Verify** with a dry run (introspects tools, doesn't open a listener):

   ```bash
   docker mcp gateway run \
     --catalog=vikunja-mcp-ng.yaml \
     --servers=vikunja-mcp-ng \
     --transport=stdio \
     --dry-run
   ```

   Expected tail of output (18 tools for an API-token session — 21 total
   tools exist, but `vikunja_users`/`vikunja_export` need a JWT session and
   `vikunja_admin`/`vikunja_tokens` are deny-by-default modules; see
   [CONFIGURATION.md#module-gating](CONFIGURATION.md#module-gating)):

   ```
   - Listing MCP tools...
     > vikunja-mcp-ng: (18 tools)
   > 18 tools listed in ...
   Dry run mode enabled, not starting the server.
   ```

4. **Run it for real** (drop `--dry-run`) and point your client at the
   gateway process, or use `--port`/`--transport=streaming` if your client
   speaks HTTP/SSE instead of stdio. For a stdio client (Claude Desktop,
   Claude Code, etc.), configure the client to run the gateway command
   itself instead of the raw image:

   ```json
   {
     "mcpServers": {
       "vikunja": {
         "command": "docker",
         "args": [
           "mcp", "gateway", "run",
           "--catalog=vikunja-mcp-ng.yaml",
           "--servers=vikunja-mcp-ng",
           "--transport=stdio"
         ]
       }
     }
   }
   ```

   (Run `docker mcp gateway run` from `~/.docker/mcp/catalogs/` or pass the
   catalog path with an explicit absolute path — the `--catalog` flag
   resolves relative paths against that directory.)

## Fallback: plain `docker run`, no Toolkit

If the catalog-fragment route is more ceremony than you want, skip the
Toolkit entirely — this is exactly what was used for this project's own
Docker smoke test and needs nothing beyond Docker itself:

```json
{
  "mcpServers": {
    "vikunja": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "VIKUNJA_URL",
        "-e", "VIKUNJA_API_TOKEN",
        "ghcr.io/netadvanced/vikunja-mcp-ng:latest"
      ],
      "env": {
        "VIKUNJA_URL": "https://your-vikunja-instance.com/api/v1",
        "VIKUNJA_API_TOKEN": "tk_your_real_token"
      }
    }
  }
}
```

This is the "from source"/Docker quick-start pattern from the main
[README](../README.md#quick-start), just with the client config spelled out
explicitly. No `docker mcp` CLI, no catalog file, no OS Keychain — the
tradeoff is the token lives in your client's config file in plaintext
(mitigate with `VIKUNJA_API_TOKEN_FILE` and a mounted secret file instead of
`VIKUNJA_API_TOKEN`, per [CONFIGURATION.md](CONFIGURATION.md#secrets-management)).

## What we didn't get working (and why)

- **`docker mcp catalog create ... --server docker://<image>`** — rejected
  with "not a self-describing image" (see above). This appears to require
  Docker's own image-build/publish pipeline for the official catalog
  (`mcp/<name>` images on Docker Hub) to embed introspectable metadata;
  nothing in the public `docker mcp --help` surface exposes a way to embed
  that metadata into a third-party `Dockerfile`-built image ourselves.
- **`docker mcp catalog create --server file://...`** — takes a *whole
  catalog* reference (another catalog's server entry), not a way to author
  one server's metadata by hand; the `catalog.yaml` route above (which the
  gateway reads directly via `--catalog`, no `catalog create` step at all)
  is the documented-by-example path for that instead.

If a future `docker mcp` release adds a documented way to mark a
plain-Dockerfile image as catalog-eligible, prefer that over the workaround
above — re-run `docker mcp catalog create --server docker://<image> --help`
periodically (or watch the toolkit's release notes) to check.

## Cleanup

Everything above is additive to your local `~/.docker/mcp` state and fully
reversible:

```bash
rm ~/.docker/mcp/catalogs/vikunja-mcp-ng.yaml
docker mcp secret rm vikunja-mcp-ng.api_token
```
