# Vikunja API Implementation Notes

This document captures important implementation details and API quirks discovered during development and testing.

## Known API Issues

### User Endpoint Authentication
The `/user` endpoint fails with authentication errors despite using a valid token that works for all other endpoints. This appears to be a server-side issue with the Vikunja API where the user endpoints have different authentication requirements or middleware.

**Symptoms:**
- Error: "missing, malformed, expired or otherwise invalid token provided"
- Occurs only on user-related endpoints (`/user`, `/users`)
- Same token works perfectly for projects, tasks, teams, etc.

**Current Workaround:**
- The MCP server detects this specific error and provides a helpful message
- Users should contact their Vikunja server administrator to resolve the issue

## API Quirks and Gotchas

### Task Object Properties

1. **Dual ID Properties**: Task objects contain both `project_id` and `projectId`
   - Both refer to the same value
   - API returns both for backwards compatibility
   - Use `project_id` when sending data to API
   - Both properties appear in responses

2. **Priority Range**: Tasks support priority values from 0-5 (inclusive)
   - Not 0-10 as might be expected
   - 0 = lowest priority
   - 5 = highest priority

3. **Recurring Tasks**: Tasks can repeat at regular intervals
   - **API Implementation**: 
     - `repeat_after`: Time in seconds between repetitions (0 = no repeat)
     - `repeat_mode`: Integer enum (0 = default, 1 = monthly, 2 = from current date)
   - **MCP Server Interface**: For ease of use, the MCP server accepts:
     - `repeatAfter`: Number of units (days, weeks, months, years)
     - `repeatMode`: String literals ("day", "week", "month", "year")
     - The server automatically converts these to the correct API format
   - When a recurring task is marked done, Vikunja automatically creates the next occurrence
   - Example: `repeatAfter: 7, repeatMode: "day"` = weekly task (converted to `repeat_after: 604800, repeat_mode: 0`)

### Date Handling

- All date fields must be valid ISO 8601 format
- Example: `2024-05-24T10:00:00Z`
- Invalid dates will cause validation errors
- Timezone information is preserved

### ID Validation

- All IDs must be positive integers
- Zero or negative values are rejected

### Project Operations

1. **Full-Model-Replace Update Endpoint**: `POST /projects/{id}` replaces the
   entire project — any field omitted from the request body is cleared
   server-side. `updateProject`, `archiveProject`, `unarchiveProject`, and
   `moveProject` all build their payload by merging the desired changes onto
   the *current* project (fetched first) via `buildProjectUpdatePayload`
   rather than sending a bare partial object. `moveProject` is the one
   exception to "merge preserves untouched fields": an omitted
   `parentProjectId` means *move to root*, so `parent_project_id` is always
   set explicitly (to the new parent, or `0` for root) rather than left
   untouched like the other fields.

2. **List Pagination Has No Total Count**: `GET /projects` returns a bare
   array — there is no `{data, total}` envelope, and node-vikunja's own
   `getProjects()` type reflects this (`Promise<Project[]>`). Total item and
   page counts are not knowable from the response body, so `vikunja_projects
   list` reports `hasMore` (derived from whether a full page came back)
   instead of a fabricated `totalPages`/`totalItems`.

3. **Kanban "Done" Bucket**: `models.Bucket` has no `is_done_bucket` field —
   the done bucket is designated by `done_bucket_id` on the `ProjectView`
   (`GET /projects/{id}/views`), not on the bucket itself. `list-buckets`
   resolves `isDoneBucket` by comparing each bucket's id against the
   Kanban view's `done_bucket_id`. When an explicit `viewId` is passed
   (skipping view auto-resolution), that view's `done_bucket_id` isn't
   fetched — `isDoneBucket` falls back to `false` in that case rather than
   spending an extra request on it.

4. **`id` vs `projectId` on `vikunja_projects`**: the flat args schema has
   both `id` (used by CRUD/hierarchy/Kanban-bucket/view/duplicate/backgrounds
   subcommands) and `projectId` (used by the sharing-domain subcommands —
   `create-share`, `share-with-user`, `list-project-users`, etc.) as sibling
   fields, which is a first-guess footgun: an agent reaching for `projectId`
   on e.g. `list-buckets` gets `Project ID is required`. `registerProjectsTool`
   (`src/tools/projects/index.ts`) now accepts `projectId` as an alias for
   `id` on every subcommand in the `id`-domain group (`PROJECT_ID_ALIAS_SUBCOMMANDS`),
   applied once up front before the switch dispatch; an explicit `id` always
   wins when both are supplied. The sharing-domain subcommands are
   deliberately excluded from this alias — they already use `projectId` for
   this purpose.

### Project Sharing

Project sharing allows creating public or private links to share projects with external users.

1. **Share Properties (request body, `POST /projects/{id}/shares`)**:
   - `permission`: Permission level (0=Read, 1=Write, 2=Admin) — the tool-level
     `right` argument (`'read'|'write'|'admin'|0|1|2`) is mapped to this field
   - `password`: Optional password protection
   - `name`: User-defined label for managing shares — the tool-level argument
     is also called `name` (not `label`)
   - `project_id` is taken from the URL path, not the body
   - There is **no** `expires`, `password_enabled`, or `shares` field on
     `models.LinkSharing` — node-vikunja's bundled type includes them, but
     the real API (and the tool's `CreateShareRequest`) does not. `expires`
     as a per-share expiration and `shares` as a share count are not
     supported by the API at all. Whether a share is password-protected
     (`sharing_type`) is derived server-side from whether `password` was set.
   - `hash`: Unique identifier for the share link (response-only)
   - `sharing_url`: Full URL for accessing the share (server-generated,
     response-only)

2. **Share Authentication**:
   - Public shares can be accessed without authentication
   - Password-protected shares require calling `auth-share` first
   - Authentication returns a token for accessing the shared project
   - The token should be used for subsequent API calls to the shared project

3. **Limitations**:
   - No update method for shares - must delete and recreate to modify
   - Passwords cannot be retrieved after creation
   - Share permissions are fixed at creation time

### Project Views (Wave D)

1. **Full-Model-Replace Update Endpoint**: `POST /projects/{project}/views/{id}`
   replaces the entire `models.ProjectView`, the same convention as the
   project update endpoint (see "Project Operations" above). `update-view`
   and the `set-done-bucket` composite both fetch the current view first and
   merge requested changes onto it (`buildViewUpdatePayload` in
   `src/tools/projects/views.ts`) rather than sending a bare partial object.

2. **Setting the Done Bucket**: `models.Bucket` has no `is_done_bucket`
   field — the done bucket is `done_bucket_id` on the `ProjectView`
   (see "Kanban 'Done' Bucket" above, which covers *reading* it via
   `list-buckets`). `set-done-bucket` is the only way to *set* it: resolve
   the Kanban view (auto-resolved from the project, or an explicit
   `viewId`), fetch-merge-POST the `done_bucket_id` change, then verify the
   response actually reflects the requested bucket before reporting
   success — a mismatch (e.g. a stale `updated` snapshot on a concurrently
   edited view) raises an `API_ERROR` rather than silently claiming success.

3. **Per-View Task Listing Shape**: `GET /projects/{id}/views/{view}/tasks`
   (`list-view-tasks`) declares a flat `models.Task[]` response schema for
   every view kind, but the endpoint's own spec description says a Kanban
   view instead returns "a list of buckets containing the tasks" — i.e. the
   real response for a Kanban view is bucket-shaped (each item carrying a
   nested `tasks` array), not task-shaped. This can't be confirmed against
   a live server from spec text alone, so `list-view-tasks` passes the
   response through unmodified rather than guessing a shape and silently
   coercing it — callers should check for a `tasks` field on each returned
   item to tell which shape they got back.

### Kanban Buckets (Wave D: create/update/delete)

1. **Full-Model-Replace Update Endpoint**: `POST
   /projects/{projectID}/views/{view}/buckets/{bucketID}` replaces the
   entire `models.Bucket` (title has `minLength: 1` in the spec — an empty
   body would be rejected). `update-bucket` fetches the bucket list first
   (which doubles as `bucketTitle` resolution, see below) and merges
   requested changes onto the matched bucket before POSTing.

2. **Resolve-by-Title**: `update-bucket` and `delete-bucket` accept either a
   numeric `bucketId` or a `bucketTitle` string — the same
   resolve-by-name-internally shape as `setTaskBucket`
   (`src/tools/tasks/buckets.ts`). `bucketId` wins when both are supplied.
   Resolution failure (no bucket with that id/title in the view) raises
   `NOT_FOUND`, not a generic validation error.

3. **`limit` Can Legitimately Be `0`**: Unlike most numeric ids in this
   codebase, a bucket's `limit` field means "unlimited" at `0`, so bucket
   create/update validate it as a non-negative integer rather than using
   the shared `validateId` helper (which rejects `0`).

4. **`vikunja_tasks update`'s `bucketId` Is Not a `models.Task` Field**:
   moving a task into a bucket is a dedicated action endpoint (`POST
   /projects/{project}/views/{view}/buckets/{bucket}/tasks`), not a field on
   the full-model task update payload — `models.Task.bucket_id` exists in the
   spec but is documented as populated only "when the task is accessed via a
   view with buckets", so it can't be diffed the way `due_date`/`priority`
   are. `TaskUpdateService.updateTask` therefore calls the shared
   `moveTaskToBucket` helper (`src/tools/tasks/buckets.ts`, factored out of
   `setTaskBucket`) as a side effect after the core POST, rather than folding
   `bucket_id` into `buildUpdateData`'s merge. It runs after any same-call
   `projectId` move, so bucket resolution (when `projectId`/`viewId` are
   omitted) sees the task's new project, not its old one. `bucketId` is
   reported in `affectedFields` unconditionally like `labels`/`assignees` —
   if the move itself fails, the whole `update` call throws before that
   response is ever returned, so the field list stays honest. Before this
   fix, `update`'s schema accepted `bucketId` but nothing read it, so it was
   silently dropped (battle-tested friction — see tracking issue #28, item
   E1).

## Operation Patterns

### Assignee Management

The update operation uses diff-based logic for efficiency:
1. Get current assignees
2. Calculate additions and removals
3. Remove users no longer assigned
4. Add new users via bulk operation

This minimizes API calls compared to replacing all assignees.

### Multi-Step Operations

**Warning**: Operations are not atomic. For example, when creating a task with labels:
1. Task is created first
2. Labels are assigned in a separate call
3. If label assignment fails, the task already exists

This creates a race condition in task creation.

## MCP-Specific Limitations

1. **File Attachments**: Cannot be implemented due to MCP protocol limitations
   - The `attach` subcommand returns NOT_IMPLEMENTED error
   - This is a permanent limitation of the MCP context

2. **Response Format Inconsistency**: Different operations return data in slightly different formats
   - Future work needed for standardization

## Error Handling Patterns

### Error Types
- `AUTH_REQUIRED`: User needs to authenticate first
- `VALIDATION_ERROR`: Input validation failed
- `API_ERROR`: Vikunja API returned an error
- `NOT_IMPLEMENTED`: Feature not available in MCP context
- `INTERNAL_ERROR`: Unexpected errors

### Network Errors
- Rate limiting returns status 429
- Connection errors have code ECONNREFUSED
- Always wrap in meaningful error messages

## Testing Discoveries

1. **Mock Isolation**: All tests must mock the node-vikunja client completely
2. **Type Safety**: Current tests use `any` for mocks, but typed mocks would be better
3. **Edge Cases**: Empty arrays and undefined fields must be handled gracefully

## Bulk Operations

### Performance Characteristics

1. **Bulk Create**: Creates multiple tasks in a single project
   - Maximum: 100 tasks per operation (enforced)
   - Creates tasks sequentially (not parallel)
   - Handles partial failures gracefully
   - Automatic cleanup if label/assignee assignment fails

2. **Bulk Update**: Updates the same field across multiple tasks
   - Fetches each task to get current state
   - Applies updates individually
   - Returns all updated tasks
   - Performance: O(n) API calls where n = number of tasks

3. **Bulk Delete**: Deletes multiple tasks
   - Fetches task details before deletion for response
   - Deletes tasks individually
   - Handles partial failures
   - Recommended: Process in batches of 20 or fewer

### Implementation Notes

- No native bulk API endpoints in Vikunja
- All bulk operations are client-side implementations
- Consider rate limiting when processing large batches
- Each operation makes individual API calls

## Future Considerations

1. **Transaction Support**: Consider implementing rollback mechanisms for multi-step operations
2. **Native Batch Operations**: Future Vikunja API versions may support native bulk endpoints
3. **Caching**: Authentication tokens could be cached more efficiently
4. **Response Streaming**: Large result sets might benefit from streaming
5. **Parallel Processing**: Bulk operations could be parallelized with rate limiting

## Filter Implementation Notes

### SQL-like Filter Syntax
The Vikunja API supports SQL-like filter syntax as documented. Filters should be passed using the `filter` parameter (not `filter_by`).

**Supported Features:**
- Complex filters with parentheses: `(priority >= 4 && done = false)`
- Boolean operators: `&&`, `||`, `AND`, `OR`
- Comparison operators: `=`, `!=`, `>`, `>=`, `<`, `<=`
- Like operator: `~` or `LIKE`
- In operator: `IN`, `NOT IN`

**Implementation:**
- Filters are passed directly to the API via the `filter` parameter
- No conversion or preprocessing is performed on filter strings
- The API handles all filter parsing and validation

## Related Issues

---

*Last updated: 2025-05-26 - Added filter implementation notes*
