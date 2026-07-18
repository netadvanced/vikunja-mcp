# Sample: Power moves

Scenario from the [README](../../README.md#power-moves): bulk operations done safely — importing a batch of tasks with validation up front, then bulk-editing a subset of them, without either step risking a half-broken project or wiping fields Vikunja's own native bulk endpoint would silently clear.

**Setup for this walkthrough:** project "Backlog Intake" (`id: 1`) is empty. `csvData` is a 40-row CSV with a header row (`title,description,priority,dueDate,labels,assignees`); several rows are tagged with a label named `urgent`.

---

### 1. Import in bulk, safely

**User says:**
> "Import this CSV of 40 tasks."

**Tool call:**
```typescript
vikunja_batch_import({ projectId: 1, format: "csv", data: csvData, skipErrors: true })
```
Validates every row before creating anything (dry-run it first with `dryRun: true` to preview without touching the project at all). Labels and assignees are semicolon-separated within a CSV field (commas are already used by CSV itself); label and username values are resolved by lookup, not required to be numeric ids. `skipErrors: true` means one malformed row doesn't abort the other 39 — it's reported, not fatal. Capped at 100 tasks per call.

**Resulting Vikunja UI state:**
Opening "Backlog Intake"'s list view shows all successfully-imported tasks (up to 40, fewer if any rows were skipped), each with its title, description, priority, due date, and resolved labels/assignees exactly as the CSV specified. The assistant's reply lists which rows (if any) failed and why.

`[SCREENSHOT: "Backlog Intake" list view populated with ~40 tasks, varying priority badges and label chips visible]`

---

### 2. Bulk-edit a filtered subset

**User says:**
> "Bump anything tagged urgent to top priority."

**Tool call:**
```typescript
// Filter query strings reference labels by numeric id, not name, so resolve
// "urgent" to its label id first:
vikunja_labels({ subcommand: "list", search: "urgent" })
// -> label id 17
vikunja_tasks({ subcommand: "list", projectId: 1, filter: "labels in 17" })
// then, with the returned ids:
vikunja_tasks({ subcommand: "bulk-update", taskIds: [123, 124, 125], field: "priority", value: 5 })
```
`bulk-update` does **not** call Vikunja's native bulk-edit endpoint, which replaces each task's full model and silently wipes any field you didn't include in the payload. Instead it fetches each task, merges in just the changed field, and writes it back — one get+update pair per task id. That's O(n) HTTP calls where the native endpoint would be one, traded deliberately for correctness: none of the other 39 tasks' fields (description, due date, assignees, ...) are at risk of being cleared.

**Resulting Vikunja UI state:**
Every task that had the `urgent` label now shows a priority-5 ("DO NOW") badge in the list view; nothing else about those tasks changed. The assistant's reply confirms which task ids were updated and reports any that failed individually (partial success, not an all-or-nothing transaction — see [ENDPOINT-PLAYBOOK.md §5](../ENDPOINT-PLAYBOOK.md)).

`[SCREENSHOT: "Backlog Intake" list view, the previously "urgent"-labeled tasks now showing a red "DO NOW" priority badge]`

---

### 3. Save that filter for next time

**User says:**
> "Save that as a filter called 'Urgent backlog' so I don't have to retype it."

**Tool call:**
```typescript
vikunja_filters({ action: "create", parameters: { title: "Urgent backlog", filter: "labels in 17", isFavorite: true } })
```
Calls Vikunja's real server-side saved-filter API (`PUT /filters`) — this persists on the server and shows up in the Vikunja UI's project sidebar as a pseudo-project (saved filters aren't project-scoped; `isFavorite` additionally surfaces it under Favorites).

**Resulting Vikunja UI state:**
"Urgent backlog" appears in the sidebar under Favorites (and in the full saved-filters list), clicking it shows the same live-filtered task set the `labels in 17` query would return at any given moment — not a frozen snapshot.

`[SCREENSHOT: Vikunja sidebar Favorites section showing "Urgent backlog" as a saved filter entry]`

---

## Try it on the local stack

See [docs/LOCAL-TESTING.md](../LOCAL-TESTING.md) to bring up `docker/e2e/docker-compose.yml`, create a project, and try importing a small CSV and bulk-updating a subset yourself.
