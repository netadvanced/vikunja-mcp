# Vikunja MCP Server

**Give your AI assistant real hands on your Vikunja instance** — create and triage tasks, manage projects and Kanban boards, assign teammates, and more, through natural conversation.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node: 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-server-purple.svg)](https://modelcontextprotocol.io)

> 👋 **Why this fork exists:** we rely on this project and noticed the [upstream repo](https://github.com/democratize-technology/vikunja-mcp) had gone quiet, with a growing backlog of open PRs and issues. So we've taken over active maintenance here — triaging and resolving most of that backlog (tracked in [this issue](https://github.com/netadvanced/vikunja-mcp/issues/19)). Full credit to the original authors for the foundation. If they'd like to pick it back up, we'll gladly hand the reins back — or work together.

---

## What this gives your AI assistant

This server exposes Vikunja as **21 tools**, each covering one entity (tasks, projects, labels, teams…) with a consistent `subcommand` pattern — not a 1:1 REST proxy, but composite operations built for how an AI actually works: resolve a username instead of demanding a user ID, create-a-label-if-it-doesn't-exist-yet, verify-then-apply for anything destructive. Your assistant reasons in natural language; the server turns that into correct, idempotent Vikunja API calls.

## See it in action

> **You:** "Move 'Fix login redirect bug' to In Review and show me the board."

```typescript
vikunja_tasks({ subcommand: "set-bucket", id: 342, bucketId: 43 })
```

`projectId`/`viewId` auto-resolve from the task — no need to know which view is the Kanban one. The task card slides from *Backlog* into *In Review* on the Kanban board, instantly visible to anyone else looking at the board.

More end-to-end scenarios — daily triage, team sharing, project planning, staying informed, bulk imports, admin ops — each paired with the exact tool call and the resulting Vikunja UI state, live in [`docs/samples/`](docs/samples/).

## Quick Start

### From source

```bash
git clone https://github.com/netadvanced/vikunja-mcp.git
cd vikunja-mcp
npm ci
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

### Docker

There's no published image yet — build it locally:

```bash
git clone https://github.com/netadvanced/vikunja-mcp.git
cd vikunja-mcp
docker build -t ghcr.io/netadvanced/vikunja-mcp-ng:latest .
```

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

Using Docker Desktop's MCP Toolkit instead of a bare `docker run`? See [docs/DOCKER-DESKTOP-MCP.md](docs/DOCKER-DESKTOP-MCP.md) for the tested, step-by-step path.

Full install options, JWT vs. API-token auth, module gating, and every environment variable live in the [Configuration guide](docs/CONFIGURATION.md).

## Capabilities

| Group | Tools | Covers |
|---|---|---|
| **Tasks** | `vikunja_tasks`, `vikunja_task_bulk`, `vikunja_task_assignees`, `vikunja_task_comments`, `vikunja_task_labels`, `vikunja_task_relations`, `vikunja_task_reminders` | CRUD, filtering, bulk ops, Kanban placement, subtasks, comments, relations |
| **Projects** | `vikunja_projects` | CRUD, hierarchy, views, Kanban buckets, sharing, duplication |
| **Organize** | `vikunja_labels`, `vikunja_filters`, `vikunja_templates` | Labels, saved filters, reusable task templates |
| **Collaborate** | `vikunja_teams`, `vikunja_users`\*, `vikunja_notifications`, `vikunja_subscriptions`, `vikunja_reactions` | Team membership, notifications, watch/react |
| **Automate & move data** | `vikunja_webhooks`, `vikunja_batch_import`, `vikunja_export_project`\* | Webhooks (per-project and account-wide), CSV/JSON import, project export |

\* JWT authentication only. User data export also has request/status/download tools (`vikunja_request_user_export`, `vikunja_user_export_status`, `vikunja_download_user_export`), all JWT-only. (`vikunja_webhooks`' account-wide `scope: 'user'` is JWT-only too; its default `scope: 'project'` works with either auth type.)

Four more tools — `vikunja_tokens`, `vikunja_caldav_tokens`, `vikunja_admin`, and `vikunja_user_deletion` — exist for API-token management, CalDAV-token management, instance administration, and self account deletion. All are **disabled by default**; an operator opts in explicitly (see Configuration). `vikunja_user_deletion` is the most sensitive of the four — it can delete the connected account — so read its [Configuration guide entry](docs/CONFIGURATION.md#known-modules) before enabling it.

Full subcommand-by-subcommand reference: [`docs/TOOLS.md`](docs/TOOLS.md).

## Safety by design

Every entity is a toggle you can disable in config, `vikunja_admin`/`vikunja_tokens`/`vikunja_caldav_tokens`/`vikunja_user_deletion` ship off until an operator opts in (and `vikunja_admin`/`vikunja_caldav_tokens`/`vikunja_user_deletion` additionally require an active JWT session), and a global read-only mode can reject every write/destructive subcommand while reads keep working. Full details: [Configuration guide](docs/CONFIGURATION.md#module-gating).

## Links

- [Sample walkthroughs](docs/samples/) — real conversations paired with the tool calls and UI results behind them
- [Full tool reference](docs/TOOLS.md) — every tool, subcommand, and argument
- [Configuration guide](docs/CONFIGURATION.md) — auth, secrets, module gating, rate limits
- [Roadmap](docs/ROADMAP.md) — where the project is headed and why
- [Contributing / endpoint playbook](docs/ENDPOINT-PLAYBOOK.md) — conventions for adding new coverage
- [Local test stack](docs/LOCAL-TESTING.md) — disposable Vikunja+Postgres via Docker for trying this out safely
- [Agent battle-testing harness](docs/BATTLE-TESTING.md) — spawns a real AI agent against the tool surface and grades it on correctness and ergonomics (manual, costs real money — see the doc before running)
- [Docker Desktop MCP Toolkit how-to](docs/DOCKER-DESKTOP-MCP.md) — registering this server with `docker mcp`
- [Releasing](docs/RELEASING.md) — versioning policy and the release checklist · [CHANGELOG](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
