/**
 * Constants for task operations
 */

// Error message constants
export const AUTH_ERROR_MESSAGES = {
  ASSIGNEE_CREATE:
    'Assignee operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation. The task was created but assignees could not be added.',
  ASSIGNEE_UPDATE:
    'Assignee operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation. Other task fields were updated but assignees could not be changed.',
  ASSIGNEE_ASSIGN:
    'Assignee operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation that prevents assigning users to tasks.',
  ASSIGNEE_REMOVE:
    'Assignee removal operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation that prevents removing users from tasks.',
  ASSIGNEE_REMOVE_PARTIAL:
    'Assignee removal operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation. New assignees were added but old assignees could not be removed.',
  ASSIGNEE_BULK_UPDATE:
    'Assignee operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation that prevents bulk updating assignees.',
  LABEL_CREATE:
    'Label operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation. The task was created but labels could not be added.',
  LABEL_UPDATE:
    'Label operations may have authentication issues with certain Vikunja API versions. ' +
    'This is a known limitation. Other task fields were updated but labels could not be changed.',
};

// Bulk operation constants
export const BULK_OPERATION_BATCH_SIZE = 10;
export const MAX_BULK_OPERATION_TASKS = 100;

// Repeat mode mapping for bulk update API
// Maps user-friendly string values to Vikunja API numeric codes
export const REPEAT_MODE_MAP: Record<string, number> = {
  default: 0,
  month: 1,
  from_current: 2,
} as const;

// Valid `sort_by` values for `GET /tasks`/`GET /projects/{id}/tasks`, per the
// vendored OpenAPI spec (docs/vikunja-openapi.json, `sort_by` query param
// description). An unrecognized value is silently ignored server-side rather
// than erroring, so passing e.g. a misspelled or camelCase field name results
// in tasks quietly coming back in default (id) order with no indication
// anything was wrong — the same "free-form string that behaves like an enum"
// class of ergonomics gap the post-#89 sweep's field/enum allowlist item
// targets. Validated explicitly here so the caller gets an agent-friendly
// error instead of a silent no-op.
export const VALID_SORT_FIELDS = [
  'id',
  'title',
  'description',
  'done',
  'done_at',
  'due_date',
  'created_by_id',
  'project_id',
  'repeat_after',
  'priority',
  'start_date',
  'end_date',
  'hex_color',
  'percent_done',
  'uid',
  'created',
  'updated',
  'relevance',
] as const;

// This tool exposes task fields to callers in camelCase (dueDate, startDate,
// etc. — see CreateTaskArgs/UpdateTaskArgs), so `sort` accepts the same
// camelCase spelling and is translated to the API's snake_case field name
// here, mirroring `FILTER_FIELD_TO_API_FIELD` in src/utils/filters.ts (added
// for the exact same reason: sending `dueDate` verbatim as `sort_by` is not a
// field Vikunja recognizes).
export const SORT_FIELD_ALIASES: Record<string, string> = {
  doneAt: 'done_at',
  dueDate: 'due_date',
  createdById: 'created_by_id',
  projectId: 'project_id',
  repeatAfter: 'repeat_after',
  startDate: 'start_date',
  endDate: 'end_date',
  hexColor: 'hex_color',
  percentDone: 'percent_done',
} as const;