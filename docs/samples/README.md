# Sample pages

Full worked examples for each scenario card in the main [README](../../README.md#what-your-assistant-can-do): what you'd say, the exact tool call (verified against `src/tools/`), and the resulting Vikunja UI state.

| Page | Scenario | Tools covered |
|---|---|---|
| [daily-triage.md](daily-triage.md) | Daily triage | `vikunja_tasks.list` (cross-project filter, `orderBy`) |
| [kanban-flow.md](kanban-flow.md) | Kanban flow | `vikunja_projects.list-buckets` / `list-view-tasks` / `create-bucket` / `set-done-bucket`, `vikunja_tasks.set-bucket` |
| [team-sharing.md](team-sharing.md) | Team collaboration | `vikunja_projects.share-with-user` / `share-with-team` / `list-members` / `remove-project-team` |
| [project-planning.md](project-planning.md) | Planning | `vikunja_projects.create` (hierarchy), `get-tree`, `duplicate` |
| [stay-informed.md](stay-informed.md) | Stay informed | `vikunja_subscriptions.subscribe`, `vikunja_notifications.list` / `mark-read`, `vikunja_reactions.add` |
| [power-moves.md](power-moves.md) | Power moves | `vikunja_batch_import`, `vikunja_tasks.list` / `bulk-update`, `vikunja_labels.list`, `vikunja_filters` (`create`) |
| [admin-ops.md](admin-ops.md) | Admin & ops | `vikunja_admin.overview` / `list-users` / `delete-user`, module config, Docker Swarm `_FILE` secrets |

Every page ends with a "try it on the local stack" pointer to
[docs/LOCAL-TESTING.md](../LOCAL-TESTING.md) — a disposable, dockerized
Vikunja + Postgres instance you can run these exact calls against without
touching a production server.
