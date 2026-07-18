# vikunja-mcp-ng

A Model Context Protocol (MCP) server that lets an AI assistant drive a real [Vikunja](https://vikunja.io) instance — task management, projects, Kanban boards, teams, and notifications — as a set of reliable, subcommand-based tools instead of a raw REST proxy.

> 👋 **Why this fork exists:** we rely on this project and noticed the [upstream repo](https://github.com/democratize-technology/vikunja-mcp) had gone quiet, with a growing backlog of open PRs and issues. So we've taken over active maintenance here — triaging and resolving most of that backlog (tracked in [this issue](https://github.com/netadvanced/vikunja-mcp/issues/19)) and repackaging as **vikunja-mcp-ng**. Full credit to the original authors for the foundation. If they'd like to pick it back up, we'll gladly hand the reins back — or work together.

## Requirements

- Docker, **or** Node.js 20+ (LTS only) if running from source
- A Vikunja instance with API access
- An API token (`tk_...`, standard) or a JWT (`eyJ...`, unlocks `users`/`export`/`admin`)

## Quick start

### Docker (recommended)

There's no published image yet — build it locally until the first `ghcr.io` publish (see [Docker image](#docker-image) below):

```bash
git clone https://github.com/netadvanced/vikunja-mcp.git
cd vikunja-mcp
docker build -t ghcr.io/netadvanced/vikunja-mcp-ng:latest .
```

Then point your MCP client at `docker run`:

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
        "VIKUNJA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Using Docker Desktop's MCP Toolkit instead of a bare `docker run`? See
[docs/DOCKER-DESKTOP-MCP.md](docs/DOCKER-DESKTOP-MCP.md) for the tested,
step-by-step registration path (and its honest limitations).

### From source

```bash
git clone https://github.com/netadvanced/vikunja-mcp.git
cd vikunja-mcp
npm install
npm run build
```

```json
{
  "mcpServers": {
    "vikunja": {
      "command": "node",
      "args": ["/path/to/vikunja-mcp/dist/index.js"],
      "env": {
        "VIKUNJA_URL": "https://your-vikunja-instance.com/api/v1",
        "VIKUNJA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Full install options, JWT vs. API-token auth, module gating, and every
environment variable live in the [Configuration guide](docs/CONFIGURATION.md).

## What your assistant can do

Each card below is one real conversation turn: what you'd say, the single
tool call it maps to, and a link to the full worked example (with the
matching Vikunja UI state) under `docs/samples/`. Every call shown is
verified against the current tool schemas in `src/tools/` — not guessed.

### Daily triage
> "What should I focus on today?"

```typescript
vikunja_tasks({ subcommand: "list", allProjects: true, filter: "done = false && priority >= 3", orderBy: "desc" })
```

Cross-project, priority-ranked, in one call — no per-project loop. → [docs/samples/daily-triage.md](docs/samples/daily-triage.md)

### Kanban flow
> "Move 'Fix login redirect bug' to In Review and show me the board."

```typescript
vikunja_tasks({ subcommand: "set-bucket", id: 342, bucketId: 43 })
```

`projectId`/`viewId` auto-resolve from the task — no need to know which view is the Kanban one. → [docs/samples/kanban-flow.md](docs/samples/kanban-flow.md)

### Team collaboration
> "Give Alice write access to the Website Relaunch project."

```typescript
vikunja_projects({ subcommand: "share-with-user", projectId: 12, username: "alice", right: "write" })
```

A composite: resolves `"alice"` to a user id, grants access, then verifies the grant landed — no numeric IDs required from you. → [docs/samples/team-sharing.md](docs/samples/team-sharing.md)

### Planning
> "Duplicate last quarter's launch project as the starting point for Q3."

```typescript
vikunja_projects({ subcommand: "duplicate", id: 8, parentProjectId: 5, duplicateShares: true })
```

Tasks, labels, comments, attachments, relations, and Kanban layout all come with it. → [docs/samples/project-planning.md](docs/samples/project-planning.md)

### Stay informed
> "Subscribe me to the Infra project and tell me if I'm missing anything."

```typescript
vikunja_subscriptions({ subcommand: "subscribe", entity: "project", entityId: 4 })
vikunja_notifications({ subcommand: "list", unreadOnly: true })
```

Reactions and subscriptions live alongside notifications, so "what changed" is one conversation, not three tools. → [docs/samples/stay-informed.md](docs/samples/stay-informed.md)

### Power moves
> "Import this CSV of 40 tasks, then bump anything tagged urgent to top priority."

```typescript
vikunja_batch_import({ projectId: 1, format: "csv", data: csvData, skipErrors: true })
vikunja_tasks({ subcommand: "bulk-update", taskIds: [123, 124, 125], field: "priority", value: 5 })
```

Batch import validates before creating; bulk-update fetches and merges per task rather than trusting Vikunja's field-wiping native bulk endpoint. → [docs/samples/power-moves.md](docs/samples/power-moves.md)

### Admin & ops
> "How many users and projects does this instance actually have?"

```typescript
vikunja_admin({ subcommand: "overview" })
```

`vikunja_admin` is **deny-by-default** — this call only exists if an operator explicitly turned it on. → [docs/samples/admin-ops.md](docs/samples/admin-ops.md)

## Safety & honesty by design

This isn't just a tool wrapper — it's built to fail loudly instead of quietly:

- **Module gating.** Every entity (`tasks`, `projects`, `notifications`, ...) is a toggle in `vikunja-mcp.config.json` or an env var. A disabled module's tools are never registered — invisible to the AI client, not merely rejected at call time. See [Module Gating](docs/CONFIGURATION.md#module-gating).
- **Deny-by-default for dangerous surfaces.** `vikunja_admin` (instance administration) and `vikunja_tokens` (API token management) ship **OFF**. `vikunja_admin` additionally requires an active JWT session — config can only *narrow* what auth already allows, never expand it. `delete-user` further requires an explicit `confirm: true` argument.
- **No fake atomicity.** Vikunja has no transactions. Composite operations like `share-with-user` are resolve → apply → verify; by default a failed verification is reported for manual follow-up, not silently rolled back. Opt in to best-effort rollback with `atomic: true` where it's offered.
- **Secrets never touch the config file.** `vikunja-mcp.config.json` is safe to commit and safe to mount as a Docker/Swarm `config`. Tokens live in env vars, with a `VIKUNJA_API_TOKEN_FILE` variant for Swarm/Kubernetes secret mounts — setting both the plain var and the `_FILE` var is a hard startup error, never a silent precedence choice.
- **Limitations are stated, not hidden.** `download-attachment` can't deliver file bytes (MCP has no binary channel) — it returns a signed URL instead. `vikunja_templates` is session-only (lost on restart). `vikunja_filters` talks to Vikunja's real server-side `/filters` API, not a local shadow copy.

## Docker image

There is no published `ghcr.io/netadvanced/vikunja-mcp-ng` image yet — build
locally from the `Dockerfile` at the repo root until the first publish:

```bash
docker build -t ghcr.io/netadvanced/vikunja-mcp-ng:latest .
```

The image is a multi-stage build (compile in `node:20-alpine`, ship only
`dist/` + production deps in a slim non-root runtime image) and speaks MCP
over stdio — run it with `docker run -i`, not as a network service. It
honors the same `VIKUNJA_MCP_CONFIG` and `VIKUNJA_API_TOKEN_FILE`
conventions as running from source; see
[docker-compose.example.yml](docker-compose.example.yml) for a
config-file-mounted example, and
[CONFIGURATION.md#docker-swarm-example](docs/CONFIGURATION.md#docker-swarm-example)
for the Swarm/`configs`+`secrets` variant. Publishing is a manual
`docker login ghcr.io && docker push` once the maintainers cut a release —
see [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the full flow.

## Links

- [Full tool reference](docs/TOOLS.md) — every subcommand, parameter, and edge case
- [Configuration guide](docs/CONFIGURATION.md) — auth, module gating, secrets, Docker Swarm
- [Docker Desktop MCP Toolkit how-to](docs/DOCKER-DESKTOP-MCP.md) — registering this server with `docker mcp`
- [Roadmap & status](docs/ROADMAP.md) — what's implemented, what's planned, what won't be
- [Sample pages index](docs/samples/) — full walkthroughs for every scenario above
- [Local testing against a real Vikunja stack](docs/LOCAL-TESTING.md)
- [Contributing](docs/ROADMAP.md#7-contributing--how-work-lands) · [Tracking issue #28](https://github.com/netadvanced/vikunja-mcp/issues/28)

## License

MIT — see [LICENSE](LICENSE).
