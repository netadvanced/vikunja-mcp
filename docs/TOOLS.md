# Tool Reference

The complete subcommand-and-parameter reference for every tool
`vikunja-mcp-ng` registers, moved here from the README to keep that page
scannable. For narrated, verified end-to-end examples (what you'd say, the
exact tool call, what changes in the Vikunja UI), see
[docs/samples/](samples/) instead — this page is the flat parameter
reference.

Every entry below is checked against the current `src/tools/**` source, not
against memory or `node-vikunja`'s (removed) types — see
[ROADMAP.md §1](ROADMAP.md) pillar 2 and [ENDPOINT-PLAYBOOK.md §2](ENDPOINT-PLAYBOOK.md)
for why that distinction matters here. If code and this page ever disagree,
trust the code and file an issue.

Module gating, auth-type restrictions (JWT vs. API token), and deny-by-default
tools are explained in [CONFIGURATION.md#module-gating](CONFIGURATION.md#module-gating) —
this page notes *which* tools are affected, not the mechanism itself.

## Response format

Every tool returns a standardized envelope:

```typescript
interface StandardResponse {
  success: boolean;
  operation: string;      // The operation performed (e.g., 'create', 'update', 'list')
  message?: string;       // Human-readable description of the result
  data?: any;             // The primary data returned (task, project, label, etc.)
  metadata?: {
    timestamp: string;    // ISO 8601 timestamp of the operation
    [key: string]: any;   // Additional operation-specific metadata
  };
}
```

**Success:**
```json
{
  "success": true,
  "operation": "create",
  "message": "Task created successfully",
  "data": { "id": 123, "title": "Complete documentation" },
  "metadata": { "timestamp": "2025-05-25T12:00:00Z" }
}
```

**Error:**
```json
{
  "success": false,
  "operation": "update",
  "message": "Task not found",
  "error": { "code": "TASK_NOT_FOUND", "details": "No task exists with ID 999" }
}
```

## Authentication

- `vikunja_auth` - Authentication management
  - `connect` - Initialize connection with API token. Performs a verification round trip before reporting success: an unauthenticated `GET /info` call validates the URL is reachable and returns the server version (surfaced as `serverVersion` in the response), then a cheap authenticated call validates the credential itself (`GET /user` for JWT sessions, `GET /projects?per_page=1` for API-token sessions, since `tk_*` tokens cannot use `/user` — see docs/VIKUNJA_API_ISSUES.md #2). If either step fails, the session is rolled back and a clear error is thrown instead of silently "succeeding" with a bad URL or token.
  - `status` - Check authentication status
  - `refresh` - Report token-refresh status: API tokens (`tk_*`) are long-lived and need no refresh; JWTs expire and must be replaced by reconnecting with a new token (Vikunja's token-refresh endpoint relies on a login cookie this server does not hold)
  - `info` - Fetch the connected Vikunja server's `GET /info` payload (version, frontend URL, motd, enabled features, ...). Requires an active session.

## Task Management

- `vikunja_tasks` - Task operations
  - `list` - List tasks with filters
    - Filter by project or get all tasks
    - Support for pagination, search, sorting
    - Filter by completion status
    - Apply saved filters with `filterId` parameter
    - Cross-project listing (no `projectId`, or `allProjects: true`) calls the
      documented `GET /tasks` endpoint directly (one call), falling back to
      per-project aggregation only if that call fails
    - `orderBy` (`'asc' | 'desc'`), `filterTimezone`, `filterIncludeNulls`,
      and `expand` (`'subtasks' | 'buckets' | 'reactions' | 'comments'`, can
      be repeated) are forwarded to `GET /tasks` for cross-project listing
  - `create` - Create a new task
    - Required: title, projectId
    - Optional: description, dueDate, priority, labels, assignees
    - Validates date format (ISO 8601) and IDs
  - `get` - Get task details by ID
  - `update` - Update existing task
    - Supports partial updates (GET + merge before POST — Vikunja replaces the full model)
    - Can update title, description, dueDate, priority, done status
    - Can move tasks between projects with `projectId` (verified after update)
    - Can update labels and assignees (uses efficient diff-based approach)
  - `delete` - Delete a task by ID
  - `assign` - Bulk assign users to tasks
  - `unassign` - Remove users from tasks
  - `list-assignees` - List a task's assignees via the dedicated `GET /tasks/{taskID}/assignees` endpoint
    - Optional: `search` (username search, `s` query param), `page`, `perPage`
  - `comment` - List or add comments to tasks
  - `bulk-create` / `bulk-update` / `bulk-delete` - Bulk task operations (same underlying handlers as the standalone `vikunja_task_bulk` tool below)
    - `bulk-update` required: taskIds array, field name, value. Supported fields: done, priority, due_date, project_id, assignees, labels. Uses per-task fetch+merge+update (does not call Vikunja's native bulk API, which can wipe omitted fields). ⚠️ O(n) get+update calls.
    - `bulk-delete` required: taskIds array. Returns deleted task details for confirmation; handles partial failures gracefully. ⚠️ Makes individual delete calls per task — batch in groups of 20 or fewer.
  - `attach` - Upload a file attachment to a task (`filePath` or base64 `fileContent`)
  - `list-attachments` - List a task's attachments (file name, size, mime, created, author), with optional `page`/`perPage`
  - `get-attachment-info` - Get metadata for one attachment by `attachmentId` (derived from the list response — there is no dedicated single-attachment metadata endpoint)
  - `delete-attachment` - Delete an attachment by `attachmentId`
  - `download-attachment` - **Cannot deliver the file itself** — MCP has no binary content channel. Returns the direct download URL (optionally with a `previewSize` of `sm`/`md`/`lg`/`xl`) plus the `Authorization: Bearer <token>` header guidance needed to fetch it yourself.
  - `relate` / `unrelate` / `relations` - Manage task-to-task relations (subtask, blocking, duplicateof, ...) — same underlying handlers as the standalone `vikunja_task_relations` tool below
  - `add-reminder` / `remove-reminder` / `list-reminders` - Manage task reminders — same underlying handlers as the standalone `vikunja_task_reminders` tool below
  - `apply-label` / `remove-label` / `list-labels` - Apply/remove/list a task's labels — same underlying handlers as the standalone `vikunja_task_labels` tool below
  - `set-bucket` - Move a task into a Kanban bucket; `projectId`/`viewId` auto-resolve when omitted
  - `set-position` - Update a task's ordering within a project view (`position` is a float — see the Vikunja docs on inserting between two existing positions)
    - `projectId` auto-resolves from the task, `projectViewId` auto-resolves to the project's first view of `viewKind` (default `'list'`) when omitted
  - `get-by-index` - Look up a task by its human-facing per-project index (e.g. the `42` in `PROJ-42`)
    - Required: `projectId`, `index`
    - Task indexes are reassigned when a task moves between projects — use the returned task's `id` for long-lived references
  - `create-subtask` - Composite: create a new task as a subtask of an existing task (`parentTaskId`, `title`, optional `description`/`dueDate`/`priority`/`labels`/`assignees`/`bucketId`). Resolves the parent to inherit its project, creates the task, optionally attaches labels/assignees and places it in a Kanban bucket (reuses the `set-bucket` path), relates it to the parent (Vikunja's `subtask`/`parenttask` relation kinds — the parent is always the "base" task of the relation), then re-reads the parent to verify the relation landed. Best-effort by default: a failure after the task was created is reported honestly (including the orphaned task id) rather than silently rolled back; `atomic: true` opts into best-effort rollback (deletes the created task) per `CompositeOperation`'s design — see [ENDPOINT-PLAYBOOK.md §5](ENDPOINT-PLAYBOOK.md)
  - `list-subtasks` - Read composite: summarizes a task's subtasks (id/title/done/assignees) from the `"subtask"` slice of its `related_tasks`, in one call (`id`)

Several task sub-resources also register as their own standalone tools (same
handlers, `operation` field instead of `subcommand`, useful when you want a
narrower tool surface exposed to a client): `vikunja_task_bulk` (`operation`:
`bulk-create`/`bulk-update`/`bulk-delete`), `vikunja_task_assignees`
(`operation`: `assign`/`unassign`/`list-assignees`), `vikunja_task_comments`
(`operation`: `comment`/`list`/`get`/`update`/`delete`),
`vikunja_task_reminders` (`operation`: `add-reminder`/`remove-reminder`/`list-reminders`),
`vikunja_task_labels` (`operation`: `apply-label`/`remove-label`/`list-labels`),
`vikunja_task_relations` (`operation`: `relate`/`unrelate`/`relations`, plus
`relationKind`: one of `subtask`, `parenttask`, `related`, `duplicateof`,
`duplicates`, `blocking`, `blocked`, `precedes`, `follows`, `copiedfrom`,
`copiedto`, `unknown`).

## Batch Import

- `vikunja_batch_import` - Import multiple tasks from CSV or JSON
  - Required: projectId, format ('csv' or 'json'), data
  - Optional: skipErrors (continue on errors), dryRun (validate only)
  - **Batch Size Limit**: Maximum 100 tasks per import
  - **CSV Format**:
    - Requires header row with field names
    - Supports quoted values and escaped quotes
    - Fields: title, description, priority, dueDate, labels, assignees
    - Labels and assignees as semicolon-separated values (semicolons used to avoid conflicts with CSV commas)
  - **JSON Format**:
    - Array of task objects
    - Same fields as CSV, plus direct support for arrays
  - **Features**:
    - Automatic label lookup by name
    - Automatic user lookup by username
    - Validation before creation
    - Detailed error reporting
    - Dry run mode for testing
    - Skip errors option for partial imports

## Project Management

- `vikunja_projects` - Project operations
  - `list` - List all projects with filters (pagination, search, archived status)
  - `get` - Get project details by ID
  - `create` - Create new project
    - Required: title
    - Optional: description, parentProjectId, isArchived, hexColor (format: #RRGGBB)
    - Validates parent project hierarchy depth (max 10 levels)
  - `update` - Update existing project
    - Supports partial updates (fetches current project and merges; omitted fields are preserved)
    - Can update all project fields including hexColor (format: #RRGGBB)
    - Omitting `parentProjectId` leaves the current parent unchanged (use `move` to reparent or detach)
    - Validates parent project hierarchy depth when changing parent
  - `delete` - Delete a project by ID
  - `archive` / `unarchive` - Archive or unarchive a project
  - **Hierarchy**
    - `get-children` - List direct children of a project
    - `get-tree` - Get complete project hierarchy as a tree
    - `get-breadcrumb` - Get path from root to a project
    - `move` - Move a project to a new parent (validates against circular references, enforces max depth of 10 levels)
  - **Sharing — link shares** (anonymous/password links)
    - `create-share` / `list-shares` / `get-share` / `delete-share` / `auth-share`
  - **Project Views**
    - `list-views` / `get-view` / `create-view` / `update-view` / `delete-view`
    - `set-done-bucket` - Composite: set a Kanban view's done bucket (resolves the view, updates it, and verifies the change took effect)
  - **Kanban Buckets**
    - `list-buckets` - List the Kanban buckets (columns) of a project (`id` is the project id)
    - `create-bucket` - Create a new bucket (`id`, `title`, optional `limit`)
    - `update-bucket` - Rename/reconfigure a bucket, referenced by `bucketId` or `bucketTitle`
    - `delete-bucket` - Delete a bucket (dissociates its tasks, does not delete them), referenced by `bucketId` or `bucketTitle`
    - `list-view-tasks` - List a view's tasks in real server-side (Kanban card) order, with pagination
    - All Kanban operations auto-resolve `viewId` to the project's Kanban view when omitted
  - **Duplicate**
    - `duplicate` - Duplicate a project (`id`, optional `parentProjectId`, optional `duplicateShares`). Tasks, files, Kanban data, assignees, comments, attachments, labels, relations, and backgrounds are copied; shares only when `duplicateShares: true` (Vikunja's own default is `false` — shares are access grants, so copying them silently would be a security-relevant surprise)
  - **Sharing — direct user & team access**
    - `share-with-user` - Composite: share with a user by **username** (`projectId`, `username`, `right`) — resolves to an id, adds, then verifies the grant landed. Optional `atomic: true` removes the grant if verification fails (default best-effort; not a real transaction, see [ENDPOINT-PLAYBOOK.md §5](ENDPOINT-PLAYBOOK.md))
    - `share-with-team` - Composite: share with a team by **name** (`projectId`, `teamName`, `right`) — same resolve → add → verify shape
    - `list-members` - Read composite: direct users + direct teams + link shares for a project, in one call (`projectId`)
    - `list-project-users` / `search-project-users` - List users with direct access, or search for one to share with
    - `add-project-user` / `update-project-user-permission` / `remove-project-user` - Primitives for fine-grained control (`projectId`, `username` or `userId`, `right`)
    - `list-project-teams` - List teams with direct access
    - `add-project-team` / `update-project-team-permission` / `remove-project-team` - Primitives for fine-grained control (`projectId`, `teamId`, `right`)
    - `right` accepts `'read' | 'write' | 'admin'` or the numeric `0 | 1 | 2`

## Label Management

- `vikunja_labels` - Label operations
  - `list` - List all labels with filters (pagination, search)
  - `get` - Get label details by ID
  - `create` - Create new label (required: title; optional: description, hexColor)
  - `update` - Update existing label (partial updates)
  - `delete` - Delete a label by ID
  - `apply-label` / `remove-label` - Apply or remove one or more labels on a task (task id + labels array; bulk supported)
  - `list-labels` - List all labels assigned to a task

## Project Templates

> **⚠️ Never persisted to Vikunja itself; session-only by default:**
> Templates are stored in memory on the MCP server process by default and
> are lost when the server restarts. Set the `templates.persistPath` config
> key (or `VIKUNJA_MCP_TEMPLATES_FILE` env var, which wins) to make them
> durable across restarts via a JSON file — see
> [docs/CONFIGURATION.md#templates-persistence](CONFIGURATION.md#templates-persistence).

- `vikunja_templates` - Template operations (session-only by default, opt-in file persistence — see note above)
  - `create` - Create a template from an existing project (required: projectId, name; optional: description, tags)
  - `list` - List all available templates (name, tags, author)
  - `get` - Get template details by ID
  - `update` - Update template metadata (name, description, tags)
  - `delete` - Delete a template
  - `instantiate` - Create new project from template (required: id, projectName; optional: parentProjectId, variables)
    - Supports variable substitution: `{{PROJECT_NAME}}`, `{{TODAY}}` (YYYY-MM-DD), `{{NOW}}`, plus custom variables
    - Creates all tasks with labels from the template

## Team Management

- `vikunja_teams` - Team operations, fully via direct REST calls
  - `list` - List all teams with filters (pagination, search)
  - `create` - Create new team (required: name; optional: description)
  - `get` - Get a team by ID
  - `update` - Update a team's name/description (required: id; at least one of name/description)
  - `delete` - Delete a team by ID
  - `members` - Manage team membership (keyed by **username**, not numeric user id — this is deliberate on Vikunja's part to prevent automated/enumerated user-id entry). Use `memberSubcommand`:
    - `list` - List a team's members (read from the team's embedded `members` array; there is no standalone list-members endpoint)
    - `add` - Add a member by username (required: username; optional: admin)
    - `remove` - Remove a member by username (required: username)
    - `toggleAdmin` - **Toggles** a member's admin status (the API endpoint takes no body and always flips the current value; it cannot set an explicit true/false)

## User Management

- `vikunja_users` - User operations **[Requires JWT authentication]**
  - `current` - Get current authenticated user info
  - `search` - Search for users (optional: search query, pagination)
  - `settings` - Get current user settings
  - `update-settings` - Update user settings (optional: name, language, timezone, weekStart, frontendSettings)
  - `timezones` - List the Vikunja instance's valid IANA time zone names (`GET /user/timezones`). Call this before `update-settings` with a `timezone` value — the valid set is instance-dependent (it depends on the OS Vikunja runs on) and the server rejects unrecognized zone names.
  - **Note:** User operations require JWT authentication. When using API token authentication, this tool is not registered at all.

## Webhook Management

- `vikunja_webhooks` - Webhook operations for project automation
  - `list-events` - Get all available webhook event types
  - `list` - List webhooks for a project (required: projectId)
  - `get` - Get a specific webhook (required: projectId, webhookId)
  - `create` - Create a new webhook (required: projectId, targetUrl, events array; optional: secret for HMAC signing) — events are validated against available event types
  - `update` - Update webhook events (required: projectId, webhookId, events array) — validated the same way
  - `delete` - Delete a webhook (required: projectId, webhookId)
  - Valid events are cached for 5 minutes to improve performance; invalid events in `create`/`update` produce a clear error listing all valid options.

## Notifications

- `vikunja_notifications` - Manage the current user's Vikunja notifications
  - `list` - List notifications (optional: `unreadOnly` — client-side filter, the API has no server-side unread filter — `page`, `perPage`). Each notification may include a best-effort `relatedTask` field (`{id, title}`) when the API's payload happens to embed one.
  - `mark-read` - Mark a single notification as read (required: `notificationId`). **Idempotent**: the underlying `POST /notifications/{id}` endpoint is a pure toggle (no request body to pick read vs. unread); this tool checks the result and toggles a second time if needed so calling it repeatedly always leaves the notification read.
  - `mark-all-read` - Mark every notification as read in one call
  - **Note**: link shares cannot have notifications (per the API); this tool requires a full user session

## Subscriptions

- `vikunja_subscriptions` - Subscribe/unsubscribe the current user to/from notifications for a project or task
  - `subscribe` - Subscribe to an entity (required: `entity` — `'project'` or `'task'` — and `entityId`)
  - `unsubscribe` - Unsubscribe from an entity (required: `entity`, `entityId`). **Idempotent**: unsubscribing from something you're not subscribed to succeeds as a no-op (the API's 404 "subscription does not exist" is treated as success, not an error).

## Reactions

- `vikunja_reactions` - Add, remove, or list emoji/text reactions on a task or task comment
  - `list` - List all reactions for an entity (required: `kind` — `'tasks'` or `'comments'` — and `entityId`)
  - `add` - Add a reaction (required: `kind`, `entityId`, `value` — any UTF character or short text, up to 20 characters)
  - `remove` - Remove your own reaction (required: `kind`, `entityId`, `value`)

## Filter Management

> **Real, server-side saved filters:** `create`/`get`/`update`/`delete` call
> Vikunja's actual `/filters` API (`PUT /filters`, `GET`/`POST`/`DELETE
> /filters/{id}`) — filters persist on the server, survive an MCP restart,
> and are visible in the Vikunja UI and to other clients. Saved filters are
> **not** project-scoped (the API has no `project_id` field on a saved
> filter); Vikunja instead exposes each one as a *pseudo-project* with a
> negative id, and `isFavorite` controls whether it also shows in the
> favorites parent alongside favorite projects. There is no dedicated
> list-all-saved-filters endpoint, so `list` derives its results from `GET
> /projects`' pseudo-project entries and verifies each one against `GET
> /filters/{id}`; entries it could not verify are still returned (title
> only) with `hydrated: false` rather than silently dropped. `build` and
> `validate` remain pure local utilities — they construct or check a filter
> query string without contacting the server.

- `vikunja_filters` - Advanced filtering for tasks, backed by Vikunja's real saved filters. Uses `action` instead of `subcommand`.
  - `list` - Derive the list of saved filters from `GET /projects`' pseudo-project entries (optional: page, perPage, favorite)
  - `get` - Get a specific saved filter by its numeric id (required: id)
  - `create` - Create a new saved filter (`PUT /filters`) (required: title, and one of filter (query string) or conditions (array); optional: description, groupOperator (`&&`/`||`), isFavorite)
  - `update` - Update an existing saved filter (`POST /filters/{id}`, a full-resource replace — omitted fields are carried forward from the current filter, not cleared) (required: id)
  - `delete` - Delete a saved filter (`DELETE /filters/{id}`) (required: id)
  - `build` - Build a filter string from conditions (local utility, no server call) (required: conditions array; optional: groupOperator)
  - `validate` - Validate a filter string (local utility, no server call)

## Data Export

> **⚠️ Memory usage:** Export operations load entire project hierarchies
> into memory. For very large projects with thousands of tasks or deeply
> nested structures, this may consume significant memory. Consider
> exporting smaller projects individually.

- `vikunja_export_project` - Export project data **[Requires JWT authentication]**
  - Required: `projectId`. Optional: `includeChildren` (recursive, default false)
  - Exports all tasks with full details, all labels used in the project, and (optionally) the full child-project hierarchy with circular-reference detection
  - **Note:** requires JWT authentication; not registered for API-token sessions.
- `vikunja_request_user_export` - Request a full user data export (required: `password` for security verification). You'll receive an email when the export is ready.
- `vikunja_download_user_export` - Confirm a previously requested user data export is ready on the server (required: `password`). Returns the server's confirmation message, not the export file itself — per the Vikunja API spec, this endpoint never returns the archive's contents, and MCP has no binary-attachment support. Retrieve the actual file from the Vikunja web UI or a direct API client using the same credentials.

## API Token Management — deny-by-default

> **Reserved/disabled by default.** `vikunja_tokens` is only registered when
> the `tokenManagement` module config key is explicitly set to `true` (see
> [CONFIGURATION.md#module-gating](CONFIGURATION.md#module-gating)) — it
> does not appear to the AI client out of the box, since it is
> credential-adjacent.

- `vikunja_tokens` - Manage the current user's Vikunja API tokens
  - `list` - List existing tokens (`GET /tokens`) (optional: page, perPage, search)
  - `create` - Create a new API token (`PUT /tokens`) (required: title, permissions — a map of resource group → allowed actions, e.g. `{"tasks":["read_all","update"]}`, valid keys/values come from the server's `GET /routes`; optional: expiresAt (ISO 8601), ownerId). The token's secret value is only ever returned in this response — it cannot be retrieved again afterwards.
  - `delete` - Delete a token by id (`DELETE /tokens/{tokenID}`) (required: tokenId)
  - **Note:** `/tokens` shares its authentication scheme with other user-scoped endpoints that have historically rejected `tk_*` API tokens (see docs/VIKUNJA_API_ISSUES.md #2) — a call made with an API-token session may be rejected server-side even though the tool itself is registered for both session types.

## Instance Admin — deny-by-default + JWT-only

> **Reserved/disabled by default, and JWT-only.** `vikunja_admin` requires
> BOTH the `admin` module config key to be explicitly set to `true` AND an
> active JWT session — module config can only narrow what authentication
> already allows, never expand it, so API-token sessions never see this
> tool regardless of config.

- `vikunja_admin` - Instance-administrator operations **[Requires JWT authentication]**
  - `overview` - Instance-wide counts (users, projects, tasks, teams, shares) plus license info (`GET /admin/overview`)
  - `list-projects` - List every project on the instance regardless of ownership (`GET /admin/projects`) (optional: page, perPage, search)
  - `set-project-owner` - Reassign a project's owner (`PATCH /admin/projects/{id}/owner`) (required: projectId, ownerId)
  - `list-users` - List every user on the instance, including admin-only fields (`is_admin`, `status`) (`GET /admin/users`) (optional: search, page, perPage)
  - `create-user` - Create a local user account, bypassing public registration (`POST /admin/users`) (required: username, email, password; optional: name, language, isAdmin, skipEmailConfirm)
  - `set-user-admin` - Promote or demote a user's instance-admin flag (`PATCH /admin/users/{id}/admin`) (required: userId, isAdmin) — the server refuses to demote the last remaining admin
  - `set-user-status` - Change a user's status without requiring login (`PATCH /admin/users/{id}/status`) (required: userId, status: `active` | `email-confirmation-required` | `disabled` | `account-locked`)
  - `delete-user` - Delete a user (`DELETE /admin/users/{id}`) (required: userId, **`confirm: true`**; optional: mode — `now` for immediate deletion, `scheduled` (default) to trigger the email-confirmation self-deletion flow). **Irreversible in `now` mode** — the tool refuses to run without an explicit `confirm: true` argument.

## Known limitations

1. **File attachments**: upload (`attach`), list (`list-attachments`), metadata (`get-attachment-info`), and delete (`delete-attachment`) are implemented. `download-attachment` cannot deliver the file's bytes — the Vikunja API returns raw `application/octet-stream` for downloads, and MCP has no binary content channel — so it returns the direct download URL and auth guidance for the caller to fetch it themselves instead.
2. **Team operations**: `get`/`update`/`members` go through direct REST calls (`src/utils/vikunja-rest.ts`) rather than a generic client method, since the underlying API doesn't offer them as a single convenient call. The admin-toggle member operation is a true toggle server-side — it cannot set an explicit admin value in one call.
3. **Pagination**: some endpoints may not fully support pagination parameters due to upstream API limitations.
4. **Authentication quirks**: a handful of Vikunja API endpoints have known auth-related rough edges (user endpoints rejecting valid `tk_*` tokens on some server versions, bulk/label/assignee operations occasionally erroring on certain server configurations) — see [docs/VIKUNJA_API_ISSUES.md](VIKUNJA_API_ISSUES.md) for the full, current list. Tools surface a clear error message when these occur.

## Security & performance

- **Zod schema validation**: enterprise-grade input validation with comprehensive type checking
- **DoS protection**: input sanitization, length limits, and character allowlisting
- **Credential protection**: automatic masking of sensitive tokens and URLs in logs and error messages
- **Entity resolution**: robust label/user name-to-id mapping with defensive error handling for malformed API responses
- **Rate limiting**: configurable request rate limits and payload size restrictions (see [CONFIGURATION.md](CONFIGURATION.md#rate-limiting-variables))
- **Memory protection**: pagination limits and memory usage monitoring (`src/utils/memory.ts`)
- **Circuit breaker**: opossum-backed retry/circuit-breaking for outbound Vikunja calls (`src/utils/retry.ts`)
