/**
 * Global Read-Only Safety Mode + MCP Tool Annotations
 *
 * Single source of truth for two related things, per
 * docs/ENDPOINT-PLAYBOOK.md's "one classification table per tool" guidance:
 *
 *  1. **Read-only gating.** When the server's `readOnly` config flag is
 *     active (`vikunja-mcp.config.json`'s `readOnly`, or the
 *     `VIKUNJA_MCP_READ_ONLY` env var — env always wins, see
 *     docs/CONFIGURATION.md), every write/destructive subcommand across
 *     every tool is rejected at dispatch with a clear, consistent error.
 *     Read subcommands continue to work normally. Each tool dispatcher
 *     calls `assertWriteAllowed(toolName, subcommand)` exactly once, right
 *     after its existing auth check — a single shared guard, not 24
 *     copy-pasted `if (readOnly) throw` checks.
 *
 *  2. **MCP tool annotations.** `readOnlyHint` / `destructiveHint` /
 *     `idempotentHint` (see the SDK's `ToolAnnotations`) are derived from
 *     the same per-subcommand classification tables via
 *     `getToolAnnotations(toolName)`, so the two features can never drift
 *     out of sync with each other.
 *
 * Classification rubric (`SubcommandClassification`):
 *  - 'read':        never mutates Vikunja server state. Always allowed;
 *                    never contributes to `destructiveHint`.
 *  - 'write':        creates or updates state (create, update, set-*,
 *                    archive, move, duplicate, subscribe, ...). Rejected
 *                    when `readOnly` is active.
 *  - 'destructive':  removes/deletes a resource or relationship (delete,
 *                    remove-*, unassign, unrelate, unsubscribe,
 *                    bulk-delete, ...). Rejected when `readOnly` is
 *                    active; any 'destructive' entry makes the whole tool's
 *                    `destructiveHint` true.
 *
 * Annotation mapping rationale: annotations are per-TOOL, but our tools
 * mix read/write/destructive subcommands behind one MCP tool name, so:
 *  - `readOnlyHint` is true only for a tool whose *entire* subcommand
 *    surface is 'read'.
 *  - `destructiveHint` is true if *any* subcommand is 'destructive'.
 *  - `idempotentHint` is only ever set true via the explicit
 *    `IDEMPOTENT_TOOLS` allowlist below, and only when every write
 *    subcommand on that tool is genuinely idempotent — see its comment.
 *
 * `vikunja_auth` special case: connect/status/refresh/disconnect/info only
 * manage the MCP server's local in-memory session — none of them mutate a
 * Vikunja resource — so those five are classified 'read' and read-only mode
 * never blocks them. `provision`/`deprovision` (oidc-http mode only,
 * docs/OIDC-RESOURCE-SERVER.md §3c) are the exception: they create/delete a
 * persisted credential-vault record, a real account-level mutation, so they
 * are classified 'write'/'destructive' respectively and DO get rejected by
 * global read-only mode — `vikunja_auth` as a whole is therefore no longer
 * `readOnlyHint: true` (see tests/utils/read-only.test.ts).
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { MCPError, ErrorCode } from '../types';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { logger } from './logger';

export type SubcommandClassification = 'read' | 'write' | 'destructive';

type ClassificationTable = Record<string, SubcommandClassification>;

// ---------------------------------------------------------------------------
// Per-tool classification tables
// ---------------------------------------------------------------------------

const AUTH: ClassificationTable = {
  connect: 'read',
  status: 'read',
  refresh: 'read',
  disconnect: 'read',
  info: 'read',
  // oidc-http mode only (docs/OIDC-RESOURCE-SERVER.md §3c, D7): these two
  // mutate the server's persisted credential vault — a real account-level
  // write/delete, analogous to vikunja_tokens/vikunja_caldav_tokens's own
  // create='write'/delete='destructive' pairing — so, unlike every other
  // vikunja_auth subcommand, they ARE rejected by global read-only mode.
  provision: 'write',
  deprovision: 'destructive',
};

const TASKS: ClassificationTable = {
  create: 'write',
  get: 'read',
  update: 'write',
  delete: 'destructive',
  list: 'read',
  assign: 'write',
  unassign: 'destructive',
  'list-assignees': 'read',
  attach: 'write',
  'list-attachments': 'read',
  'get-attachment-info': 'read',
  'delete-attachment': 'destructive',
  'download-attachment': 'read',
  // Dual-purpose: creates a comment when `comment` text is supplied,
  // otherwise falls back to listing comments (see
  // src/tools/tasks/comments/index.ts handleComment). Dispatchers pass a
  // dynamic override computed from `args.comment` instead of relying on
  // this static default.
  comment: 'write',
  'bulk-create': 'write',
  'bulk-update': 'write',
  'bulk-delete': 'destructive',
  relate: 'write',
  unrelate: 'destructive',
  relations: 'read',
  'add-reminder': 'write',
  'remove-reminder': 'destructive',
  'list-reminders': 'read',
  'apply-label': 'write',
  'remove-label': 'destructive',
  'list-labels': 'read',
  'set-bucket': 'write',
  // bulk-set-bucket (E3, battle-campaign friction #4): moves several tasks
  // into a Kanban bucket in one call — same write classification as
  // 'set-bucket', just batched.
  'bulk-set-bucket': 'write',
  'set-position': 'write',
  'get-by-index': 'read',
  // Subtask composites (PR #77). create-subtask performs a real task
  // creation + relation write; list-subtasks is a pure read.
  'create-subtask': 'write',
  // bulk-create-subtasks (E3, battle-campaign friction #4): creates and
  // relates several subtasks under the same parent in one call — same write
  // classification as 'create-subtask', just batched.
  'bulk-create-subtasks': 'write',
  'list-subtasks': 'read',
  // duplicate copies a task (labels, assignees, attachments, reminders)
  // into a brand-new task — a genuine write, direct parallel to
  // vikunja_projects' duplicate below.
  duplicate: 'write',
  // mark-read mutates state (deletes the unread-status row for the current
  // user) even though the task's own fields are unchanged — a write-ish
  // state change, not a pure read. Classified 'write' (not 'destructive':
  // no resource/relationship is removed from the caller's perspective).
  'mark-read': 'write',
};

const TASK_BULK: ClassificationTable = {
  'bulk-create': 'write',
  'bulk-update': 'write',
  'bulk-delete': 'destructive',
  // bulk-set-bucket (E3): mirrors vikunja_tasks' bulk-set-bucket
  // classification above — a batched Kanban bucket move, never destructive.
  'bulk-set-bucket': 'write',
};

const TASK_ASSIGNEES: ClassificationTable = {
  assign: 'write',
  unassign: 'destructive',
  'list-assignees': 'read',
};

const TASK_COMMENTS: ClassificationTable = {
  // See TASKS.comment above — same dual-purpose create-or-list behavior.
  comment: 'write',
  list: 'read',
  get: 'read',
  update: 'write',
  delete: 'destructive',
};

const TASK_REMINDERS: ClassificationTable = {
  'add-reminder': 'write',
  'remove-reminder': 'destructive',
  'list-reminders': 'read',
};

const TASK_LABELS: ClassificationTable = {
  'apply-label': 'write',
  'remove-label': 'destructive',
  'list-labels': 'read',
};

const TASK_RELATIONS: ClassificationTable = {
  relate: 'write',
  unrelate: 'destructive',
  relations: 'read',
};

const PROJECTS: ClassificationTable = {
  list: 'read',
  get: 'read',
  create: 'write',
  update: 'write',
  delete: 'destructive',
  archive: 'write',
  unarchive: 'write',
  'get-children': 'read',
  'get-tree': 'read',
  'get-breadcrumb': 'read',
  move: 'write',
  'create-share': 'write',
  'list-shares': 'read',
  'get-share': 'read',
  'delete-share': 'destructive',
  // Authenticates against a share link/password — reads project data
  // through the share, does not mutate it.
  'auth-share': 'read',
  'list-project-users': 'read',
  'search-project-users': 'read',
  'add-project-user': 'write',
  'update-project-user-permission': 'write',
  'remove-project-user': 'destructive',
  'list-project-teams': 'read',
  'add-project-team': 'write',
  'update-project-team-permission': 'write',
  'remove-project-team': 'destructive',
  'share-with-user': 'write',
  'share-with-team': 'write',
  'list-members': 'read',
  'list-buckets': 'read',
  'create-bucket': 'write',
  'update-bucket': 'write',
  'delete-bucket': 'destructive',
  'list-view-tasks': 'read',
  'list-views': 'read',
  'get-view': 'read',
  'create-view': 'write',
  'update-view': 'write',
  'delete-view': 'destructive',
  'set-done-bucket': 'write',
  duplicate: 'write',
  // Project backgrounds (G7, opt-in `backgrounds` module — see
  // src/tools/projects/backgrounds.ts). remove-background deletes the
  // currently-set background (destructive); set-unsplash-background writes
  // a new one; search-unsplash is a pure read (queries unsplash, never
  // touches a project).
  'remove-background': 'destructive',
  'set-unsplash-background': 'write',
  'search-unsplash': 'read',
};

const LABELS: ClassificationTable = {
  list: 'read',
  get: 'read',
  create: 'write',
  update: 'write',
  delete: 'destructive',
};

// vikunja_teams' 'members' subcommand fans out to a second enum
// (`memberSubcommand`). Dispatchers pass a composite key
// (`members:${memberSubcommand}`) to `assertWriteAllowed` for that case.
const TEAMS: ClassificationTable = {
  list: 'read',
  create: 'write',
  get: 'read',
  update: 'write',
  delete: 'destructive',
  'members:list': 'read',
  'members:add': 'write',
  'members:remove': 'destructive',
  // Flips the member's admin flag (POST .../admin takes no body) rather
  // than setting it to a caller-supplied value — explicitly NOT idempotent
  // (calling it twice toggles back). Still a 'write' (not 'destructive'):
  // no resource or relationship is removed.
  'members:toggleAdmin': 'write',
};

const USERS: ClassificationTable = {
  current: 'read',
  search: 'read',
  settings: 'read',
  'update-settings': 'write',
  timezones: 'read',
  'get-avatar': 'read',
  'set-avatar': 'write',
  'upload-avatar': 'write',
};

const FILTERS: ClassificationTable = {
  list: 'read',
  get: 'read',
  create: 'write',
  update: 'write',
  delete: 'destructive',
  // Pure local utilities — construct/check a filter query string without
  // contacting the server or touching any saved filter.
  build: 'read',
  validate: 'read',
};

const TEMPLATES: ClassificationTable = {
  create: 'write',
  list: 'read',
  get: 'read',
  update: 'write',
  delete: 'destructive',
  // Creates a new project/tasks from the template.
  instantiate: 'write',
};

// G4 (docs/ENDPOINT-TAIL-RETRIAGE.md): vikunja_webhooks also takes a
// `scope: 'user' | 'project'` argument selecting /user/settings/webhooks*
// vs /projects/{id}/webhooks*. Scope never changes a subcommand's
// read/write/destructive nature (both scopes' `list`/`get`/`list-events`
// are pure reads, `create`/`update` are writes, `delete` is destructive),
// so one table covers every subcommand x scope combination - no
// scope-suffixed keys needed here.
const WEBHOOKS: ClassificationTable = {
  list: 'read',
  get: 'read',
  create: 'write',
  update: 'write',
  delete: 'destructive',
  'list-events': 'read',
};

// vikunja_batch_import has no subcommand field (single-purpose tool).
// Dispatchers use the fixed key 'import' and pass a dynamic override:
// `dryRun: true` never writes, so it is classified 'read' for that call.
const BATCH_IMPORT: ClassificationTable = {
  import: 'write',
};

// vikunja_export_project / vikunja_request_user_export /
// vikunja_download_user_export / vikunja_user_export_status have no
// subcommand field either — each is registered as its own single-purpose
// tool. Fixed keys below.
const EXPORT_PROJECT: ClassificationTable = {
  // GET-only recursive walk of project/task/label data — never mutates.
  export: 'read',
};

const REQUEST_USER_EXPORT: ClassificationTable = {
  // POST /user/export/request asks the server to start preparing an
  // export — a genuine write (triggers server-side work), even though the
  // response is just a confirmation message.
  request: 'write',
};

const DOWNLOAD_USER_EXPORT: ClassificationTable = {
  // POST /user/export/download only confirms readiness (returns
  // models.Message, never the archive) — no new state is created by this
  // call, so it is classified as a read for read-only-mode purposes.
  download: 'read',
};

const USER_EXPORT_STATUS: ClassificationTable = {
  // GET /user/export returns models.UserExportStatus (id/created/expires/
  // size) — a pure read, never mutates server state.
  status: 'read',
};

const NOTIFICATIONS: ClassificationTable = {
  list: 'read',
  'mark-read': 'write',
  'mark-all-read': 'write',
};

const SUBSCRIPTIONS: ClassificationTable = {
  subscribe: 'write',
  unsubscribe: 'destructive',
};

const REACTIONS: ClassificationTable = {
  list: 'read',
  add: 'write',
  remove: 'destructive',
};

const TOKENS: ClassificationTable = {
  list: 'read',
  create: 'write',
  delete: 'destructive',
};

const CALDAV_TOKENS: ClassificationTable = {
  list: 'read',
  create: 'write',
  delete: 'destructive',
};

const ADMIN: ClassificationTable = {
  overview: 'read',
  'list-projects': 'read',
  'set-project-owner': 'write',
  'list-users': 'read',
  'create-user': 'write',
  'delete-user': 'destructive',
  'set-user-admin': 'write',
  'set-user-status': 'write',
};

// vikunja_user_deletion: request/confirm move the current account
// irreversibly closer to deletion (destructiveHint applies to both, per the
// tool's design). cancel is the safe "undo" leg — classified 'write' (it
// mutates server state by aborting the pending request) but deliberately
// NOT 'destructive', since it removes nothing.
const USER_DELETION: ClassificationTable = {
  request: 'destructive',
  confirm: 'destructive',
  cancel: 'write',
};

/** Tool name -> subcommand classification table. */
export const TOOL_CLASSIFICATIONS: Record<string, ClassificationTable> = {
  vikunja_auth: AUTH,
  vikunja_tasks: TASKS,
  vikunja_task_bulk: TASK_BULK,
  vikunja_task_assignees: TASK_ASSIGNEES,
  vikunja_task_comments: TASK_COMMENTS,
  vikunja_task_reminders: TASK_REMINDERS,
  vikunja_task_labels: TASK_LABELS,
  vikunja_task_relations: TASK_RELATIONS,
  vikunja_projects: PROJECTS,
  vikunja_labels: LABELS,
  vikunja_teams: TEAMS,
  vikunja_users: USERS,
  vikunja_filters: FILTERS,
  vikunja_templates: TEMPLATES,
  vikunja_webhooks: WEBHOOKS,
  vikunja_batch_import: BATCH_IMPORT,
  vikunja_export_project: EXPORT_PROJECT,
  vikunja_request_user_export: REQUEST_USER_EXPORT,
  vikunja_download_user_export: DOWNLOAD_USER_EXPORT,
  vikunja_user_export_status: USER_EXPORT_STATUS,
  vikunja_notifications: NOTIFICATIONS,
  vikunja_subscriptions: SUBSCRIPTIONS,
  vikunja_reactions: REACTIONS,
  vikunja_tokens: TOKENS,
  vikunja_caldav_tokens: CALDAV_TOKENS,
  vikunja_admin: ADMIN,
  vikunja_user_deletion: USER_DELETION,
};

// ---------------------------------------------------------------------------
// Classification lookups
// ---------------------------------------------------------------------------

/**
 * Classify a subcommand for a given tool. Unrecognized tool/subcommand
 * pairs fail closed as 'write' (rather than 'read') so an entry missing
 * from the table above is blocked while read-only mode is active instead
 * of silently slipping through — a table-maintenance bug should surface as
 * an over-eager rejection, never as a read-only bypass.
 */
export function classifySubcommand(toolName: string, subcommand: string): SubcommandClassification {
  return TOOL_CLASSIFICATIONS[toolName]?.[subcommand] ?? 'write';
}

/** True if every subcommand on this tool is classified 'read'. */
export function isToolReadOnly(toolName: string): boolean {
  const table = TOOL_CLASSIFICATIONS[toolName];
  if (!table) {
    return false;
  }
  return Object.values(table).every((classification) => classification === 'read');
}

/** True if any subcommand on this tool is classified 'destructive'. */
export function isToolDestructive(toolName: string): boolean {
  const table = TOOL_CLASSIFICATIONS[toolName];
  if (!table) {
    // Unknown tool: no recorded opinion, assume the worst for the hint too.
    return true;
  }
  return Object.values(table).some((classification) => classification === 'destructive');
}

// Tools whose entire non-read subcommand surface is genuinely idempotent
// (repeating the same call has no additional effect after the first). This
// is an explicit opt-in allowlist rather than something inferred from the
// read/write/destructive table, since idempotency is a per-operation
// semantic judgment call that the three-way classification above doesn't
// capture on its own.
const IDEMPOTENT_TOOLS = new Set<string>([
  // mark-read / mark-all-read: marking an already-read notification as
  // read again is a no-op server-side. `list` is the only other
  // subcommand and is read-only.
  'vikunja_notifications',
]);

/**
 * Derive this tool's MCP `ToolAnnotations` from its classification table —
 * see the module doc comment for the readOnlyHint/destructiveHint/
 * idempotentHint mapping rationale.
 */
export function getToolAnnotations(toolName: string): ToolAnnotations {
  const annotations: ToolAnnotations = {
    readOnlyHint: isToolReadOnly(toolName),
    destructiveHint: isToolDestructive(toolName),
  };
  if (IDEMPOTENT_TOOLS.has(toolName)) {
    annotations.idempotentHint = true;
  }
  return annotations;
}

// ---------------------------------------------------------------------------
// Read-only mode guard
// ---------------------------------------------------------------------------

/**
 * Whether the server's global read-only safety mode is currently active.
 *
 * Fails safe the same way `resolveModulesConfig` (src/tools/index.ts) does:
 * a broken/unreadable config file must not crash tool registration or
 * dispatch, so a `loadConfiguration()` failure here falls back to the
 * schema default (`readOnly: false`) rather than propagating. This mirrors
 * module gating's fail-safe precedent, not a "fail closed on ambiguity"
 * choice — a config-loading error is an operator misconfiguration to
 * surface via logs, not a signal about write intent.
 */
export function isReadOnlyModeActive(): boolean {
  try {
    return ConfigurationManager.getInstance().loadConfiguration().readOnly;
  } catch (error) {
    logger.error(
      'Failed to load configuration while checking read-only mode; falling back to readOnly=false:',
      error,
    );
    return false;
  }
}

/**
 * The single shared guard every tool dispatcher calls once — right after
 * its existing auth check, before routing to a subcommand handler — instead
 * of duplicating a read-only check per subcommand.
 *
 * @param toolName - the registered MCP tool name (e.g. `vikunja_tasks`).
 * @param subcommand - the dispatch key for this call. For tools without a
 *   `subcommand`/`operation`/`action` field (batch-import, the three export
 *   tools), dispatchers pass the tool's single fixed key from its
 *   classification table above (e.g. `'import'`).
 * @param classificationOverride - for the handful of subcommands whose
 *   classification depends on the call's arguments rather than being
 *   static (the comment-or-list dual-purpose `comment` subcommand;
 *   batch-import's `dryRun`), dispatchers compute and pass the effective
 *   classification directly instead of relying on the static table lookup.
 */
export function assertWriteAllowed(
  toolName: string,
  subcommand: string,
  classificationOverride?: SubcommandClassification,
): void {
  const classification = classificationOverride ?? classifySubcommand(toolName, subcommand);
  if (classification === 'read') {
    return;
  }
  if (isReadOnlyModeActive()) {
    throw new MCPError(
      ErrorCode.PERMISSION_DENIED,
      `server is in read-only mode: '${toolName}' subcommand '${subcommand}' is a ` +
        `${classification} operation and is rejected. Set 'readOnly' to false in ` +
        `vikunja-mcp.config.json (or unset VIKUNJA_MCP_READ_ONLY) to allow writes.`,
    );
  }
}

/**
 * Appends a short read-only note to a tool's description, but only when
 * read-only mode is active AND the tool actually has write/destructive
 * subcommands to warn about (a fully-exempt tool like `vikunja_export_project`
 * never gets the note — it would be noise, not information). Called once at
 * registration time — cheap, since `isReadOnlyModeActive()` just reads the
 * already-loaded, cached configuration.
 */
export function withReadOnlyNote(toolName: string, description: string): string {
  if (!isReadOnlyModeActive() || isToolReadOnly(toolName)) {
    return description;
  }
  return (
    `${description} NOTE: the server is currently in read-only mode — ` +
    `write/destructive subcommands on this tool will be rejected.`
  );
}
