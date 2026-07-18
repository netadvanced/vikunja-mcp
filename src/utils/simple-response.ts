/**
 * Simple Response Formatter
 * Replaces the over-engineered 2,925-line AORP system with direct, clean responses
 */

import type { ResponseMetadata } from '../types/responses';
import type { Task, Project, Label, User } from '../types/vikunja';

/**
 * Common data structures that can be passed to response formatters
 */
export interface ResponseData {
  /** Array of items with common identifiers */
  items?: Array<{
    id?: number | string;
    title?: string;
    name?: string;
    [key: string]: unknown;
  }>;
  /** Tasks collection */
  tasks?: Task[];
  /** Projects collection */
  projects?: Project[];
  /** Labels collection */
  labels?: Label[];
  /** Users collection */
  users?: User[];
  /** Generic key-value data */
  [key: string]: unknown;
}

/**
 * Individual data item that can be formatted for display
 */
export interface DataItem {
  id?: number | string;
  title?: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Simple response structure - replaces complex AORP system
 */
export interface SimpleResponse {
  /** Response content */
  content: string;
  /** Response metadata */
  metadata?: ResponseMetadata;
}

/**
 * Create a simple success response
 * Replaces complex AORP factory with direct formatting
 */
export function createSuccessResponse(
  operation: string,
  message: string,
  data?: ResponseData,
  metadata?: ResponseMetadata
): SimpleResponse {
  const content = formatSuccessMessage(operation, message, data, metadata);

  return {
    content,
    metadata: {
      timestamp: new Date().toISOString(),
      success: true,
      operation,
      ...metadata,
    },
  };
}

/**
 * Create a simple error response
 * Replaces complex AORP error handling with direct formatting
 */
export function createErrorResponse(
  operation: string,
  message: string,
  errorCode: string = 'UNKNOWN_ERROR',
  metadata?: ResponseMetadata
): SimpleResponse {
  const content = formatErrorMessage(operation, message, errorCode, metadata);

  return {
    content,
    metadata: {
      timestamp: new Date().toISOString(),
      success: false,
      operation,
      error: {
        code: errorCode,
        message,
      },
      ...metadata,
    },
  };
}

/**
 * Format success message in clean markdown
 * Replaces complex AORP markdown formatting
 */
export function formatSuccessMessage(
  operation: string,
  message: string,
  data?: ResponseData,
  metadata?: Record<string, unknown>
): string {
  let content = `## ✅ Success\n\n${message}\n\n**Operation:** ${operation}\n\n`;

  // Include metadata first if provided
  if (metadata && typeof metadata === 'object') {
    const metadataEntries = Object.entries(metadata).filter(([_, value]) => value !== undefined && value !== null);
    if (metadataEntries.length > 0) {
      content += formatObjectData(metadata);
    }
  }

  if (data) {
    // Detect single resources (id + title|name, not an array) BEFORE the
    // collection extraction. A single Task object has its own `.labels`
    // array (the labels assigned to that task), which collides with the
    // "labels collection" check below and causes get/create responses to
    // silently drop description, project_id, priority, due_date, etc.
    const looksLikeSingleResource =
      !Array.isArray(data) &&
      typeof data === 'object' &&
      (data as DataItem).id !== undefined &&
      ((data as DataItem).title !== undefined || (data as DataItem).name !== undefined);

    // Check for known collection types first (skipped for single resources).
    const collection = looksLikeSingleResource
      ? null
      : (data.tasks || data.projects || data.labels || data.users || data.items);

    if (collection && Array.isArray(collection)) {
      content += `**Results:** ${collection.length} item(s)\n\n`;
      content += formatDataItemsList(collection as DataItem[]);
    } else if (Array.isArray(data)) {
      content += `**Results:** ${data.length} item(s)\n\n`;
      content += formatDataItemsList(data as DataItem[]);
    } else if (looksLikeSingleResource) {
      // Route single resources through formatSingleDataItem, which uses the
      // rich formatTaskItem heading renderer for Task-shaped objects and a
      // compact id/title line for everything else. This is a single-item
      // ("get") response, so the heading layout stays legitimate here — only
      // multi-item list rendering (formatDataItemsList) changes.
      content += formatSingleDataItem(data as DataItem);
    } else if (data && typeof data === 'object') {
      content += formatObjectData(data as Record<string, unknown>);
    }
  }

  return content;
}

/**
 * Format error message in clean markdown
 * Replaces complex AORP error formatting
 */
export function formatErrorMessage(
  operation: string,
  message: string,
  errorCode: string,
  metadata?: ResponseMetadata
): string {
  let output = `## ❌ Error\n\n${message}\n\n**Error Code:** ${errorCode}`;

  // Include important metadata fields in error output
  if (metadata) {
    // Add operation if different from default
    if (metadata.operation && metadata.operation !== operation) {
      output += `\n\n**Operation:** ${metadata.operation}`;
    }

    // Add failed IDs if present
    if (metadata.failedIds && Array.isArray(metadata.failedIds)) {
      output += `\n\n**FailedIds**:\n${JSON.stringify(metadata.failedIds)}`;
    }

    // Add failed count if present
    if (typeof metadata.failedCount === 'number') {
      output += `\n\n**FailedCount**:\n${metadata.failedCount}`;
    }

    // Add failures array if present
    if (metadata.failures && Array.isArray(metadata.failures)) {
      output += `\n\n**Failures**:\n${JSON.stringify(metadata.failures, null, 2)}`;
    }

    // Add count if present
    if (metadata.count !== undefined) {
      output += `\n\n**count:** ${metadata.count}`;
    }
  }

  output += '\n\n';
  return output;
}

/**
 * Format a single Task object with rich details as a markdown heading block.
 *
 * This heading layout (`### N. **Title**` + detail bullets) is used ONLY for
 * single-item ("get"/"create"/"update") responses via formatSingleDataItem,
 * where a lone `###` section header is legitimate document structure. It
 * must NOT be used for multi-item lists (see formatDataItemsList /
 * formatListItemLine below) — mixing heading blocks into a numbered list is
 * issue #86.
 */
function formatTaskItem(task: Task, index: number): string {
  const parts: string[] = [];

  // Header with title and ID
  parts.push(`### ${index + 1}. **${task.title}** (ID: ${task.id})`);
  parts.push(...formatTaskDetailLines(task).map(line => `- ${line}`));

  return parts.join('\n') + '\n';
}

/**
 * Build the optional detail bullet lines (status/priority/due date/progress/
 * project/labels/assignees/description) for a Task-shaped item. Shared by
 * both the single-item heading renderer (formatTaskItem) and the list-item
 * renderer (formatListItemLine) so the *content* of the details stays
 * identical between the two layouts — only their surrounding structure
 * (heading vs. indented sub-bullets) differs.
 */
function formatTaskDetailLines(task: Task): string[] {
  const parts: string[] = [];

  // Status
  const status = task.done ? '✅ Done' : '❌ Not Done';
  parts.push(`**Status:** ${status}`);

  // Priority (if set)
  if (task.priority !== undefined && task.priority > 0) {
    const stars = '⭐'.repeat(Math.min(task.priority, 5));
    parts.push(`**Priority:** ${stars} (${task.priority}/5)`);
  }

  // Due date (if set)
  if (task.due_date) {
    parts.push(`**Due:** ${task.due_date}`);
  }

  // Progress (if set)
  if (task.percent_done !== undefined && task.percent_done > 0) {
    parts.push(`**Progress:** ${task.percent_done}%`);
  }

  // Project ID (if set)
  if (task.project_id) {
    parts.push(`**Project:** ${task.project_id}`);
  }

  // Labels (if any)
  if (task.labels && task.labels.length > 0) {
    const labelTitles = task.labels.map(l => l.title).join(', ');
    parts.push(`**Labels:** ${labelTitles}`);
  }

  // Assignees (if any)
  if (task.assignees && task.assignees.length > 0) {
    const assigneeNames = task.assignees.map(a => {
      const email = a.email ? ` (${a.email})` : '';
      return `${a.username}${email}`;
    }).join(', ');
    parts.push(`**Assignees:** ${assigneeNames}`);
  }

  // Description (if exists)
  if (task.description) {
    parts.push(`**Description:** ${task.description}`);
  }

  return parts;
}

/**
 * True when an item carries enough Task-shaped detail to justify rendering
 * extra fields (status/priority/due date/labels/assignees/description)
 * alongside its title/ID line.
 */
function isRichTaskItem(item: DataItem): boolean {
  const task = item as unknown as Task;
  return Boolean(
    task.title &&
      (task.description ||
        task.priority !== undefined ||
        task.due_date ||
        task.labels ||
        task.assignees ||
        task.done !== undefined)
  );
}

/**
 * Format a single item's list line, uniformly, regardless of how much
 * optional detail it carries (issue #86 fix). Every item — rich or sparse —
 * renders as the SAME plain numbered line:
 *
 *   N. **Title** (ID: id)
 *
 * with any available detail (status/priority/due date/labels/assignees/
 * description) rendered as indented sub-bullets directly underneath, never
 * as a `###` document heading. This keeps consecutive list items visually
 * uniform instead of alternating between heading blocks and plain lines.
 */
function formatListItemLine(item: DataItem, index: number): string {
  if (typeof item !== 'object' || item === null) {
    return `${index + 1}. ${JSON.stringify(item)}`;
  }

  const id = item.id || index + 1;
  const title = item.title || item.name || JSON.stringify(item);
  const header = `${index + 1}. **${title}** (ID: ${id})`;

  if (!isRichTaskItem(item)) {
    return header;
  }

  // formatTaskDetailLines always emits at least a **Status:** line once
  // isRichTaskItem() is true, so `details` is never empty here.
  const details = formatTaskDetailLines(item as unknown as Task);
  return [header, ...details.map(line => `   - ${line}`)].join('\n');
}

/**
 * Format a single ("get"/"create"/"update") resource. This is NOT a list, so
 * the richer `### ` heading layout (formatTaskItem) remains legitimate here
 * — issue #86 only changes how *multiple* items are rendered together (see
 * formatDataItemsList).
 *
 * Callers only reach this function via the `looksLikeSingleResource` gate in
 * formatSuccessMessage, which already guarantees `item` is a non-null object
 * with an `id` and a `title`/`name` — so no primitive/non-object fallback is
 * needed (or reachable) here.
 */
function formatSingleDataItem(item: DataItem): string {
  if (isRichTaskItem(item)) {
    return formatTaskItem(item as unknown as Task, 0) + '\n\n';
  }

  const id = item.id || 1;
  const title = item.title || item.name || JSON.stringify(item);
  return `1. **${title}** (ID: ${id})\n\n`;
}

/**
 * Maximum number of items to render individually in a list response. This
 * keeps responses token-safe: a hard cap protects against unbounded output
 * for very large collections while still being generous enough to cover the
 * vast majority of real Vikunja projects/task lists without truncation.
 * Anything beyond the cap gets an explicit truncation notice instead of
 * being silently dropped (issue #85) — the caller can always page further
 * with `page`/`perPage`.
 */
const LIST_ITEM_RENDER_CAP = 50;

/**
 * Format a list ("list"/bulk) response body. Renders every item up to
 * LIST_ITEM_RENDER_CAP; for larger collections it renders the first
 * LIST_ITEM_RENDER_CAP items followed by an explicit truncation notice, so a
 * non-empty collection NEVER silently renders an empty body (issue #85).
 */
function formatDataItemsList(items: DataItem[], cap: number = LIST_ITEM_RENDER_CAP): string {
  if (items.length === 0) {
    return '';
  }

  const shown = items.slice(0, cap);
  let content = shown.map((item, index) => formatListItemLine(item, index)).join('\n') + '\n\n';

  if (items.length > cap) {
    content += `_Showing ${cap} of ${items.length} — use page/perPage to see more._\n\n`;
  }

  return content;
}

/**
 * Format object data
 */
function formatObjectData(data: Record<string, unknown>): string {
  const entries = Object.entries(data);
  if (entries.length === 0) return '';

  return entries
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const formattedValue = typeof value === 'object' && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value);
      return `**${key}:** ${formattedValue}`;
    })
    .join('\n') + '\n\n';
}

/**
 * Format response as MCP content array
 * Direct replacement for AORP formatting
 */
export function formatMcpResponse(response: SimpleResponse): Array<{ type: 'text'; text: string }> {
  return [{
    type: 'text' as const,
    text: response.content,
  }];
}

// Note: ResponseData and DataItem are exported from types/index.ts