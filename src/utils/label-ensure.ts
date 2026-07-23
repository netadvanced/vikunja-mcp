/**
 * Shared get-or-create-by-title helper for Vikunja labels.
 *
 * Extracted from the `ensure` subcommand of `vikunja_labels` (src/tools/labels.ts,
 * added by PR #159) so `vikunja_task_labels apply-label` can resolve label
 * titles to ids using the exact same match/create semantics: GET
 * /labels?s=<title> narrows candidates server-side, then a client-side
 * case-insensitive exact-title match decides reuse vs. create (PUT /labels).
 *
 * Why this got pulled out of labels.ts: a battle re-check after #159 showed
 * weak agents (haiku) still didn't adopt the standalone `ensure` subcommand —
 * it required discovering `ensure` on `vikunja_labels`, calling it, then
 * threading the returned id into a *second* call to `vikunja_task_labels
 * apply-label`. Too many hops to discover. Folding get-or-create directly
 * into `apply-label` via a `labelTitles` field collapses "attach a label by
 * name" back to the one call agents already reach for — see
 * netadvanced/vikunja-mcp#28 friction #4 (existing-label-reuse cost weak
 * agents 2x the optimal call count with no create-or-reuse primitive).
 */

import type { AuthManager } from '../auth/AuthManager';
import { MCPError, ErrorCode } from '../types/errors';
import { vikunjaRestRequest } from './vikunja-rest';
import type { components } from '../types/generated/vikunja-openapi';

/** `models.Label` per the OpenAPI spec. */
type VikunjaLabel = components['schemas']['models.Label'];

export interface EnsureLabelByTitleOptions {
  description?: string;
  hexColor?: string;
}

export interface EnsureLabelByTitleResult {
  /** Numeric id of the reused-or-created label. */
  id: number;
  /** Title as returned by the API (may differ in case from the request). */
  title: string;
  /** `true` when no exact match existed and a new label was created. */
  created: boolean;
  /** The full label object as returned by the API. */
  label: VikunjaLabel;
}

/**
 * Get-or-create a label by title: reuse an existing label whose title
 * matches case-insensitively, or create a new one when none does.
 *
 * Idempotent — calling this twice with the same title returns the same id
 * both times (the second call reuses instead of creating a duplicate).
 */
export async function ensureLabelByTitle(
  authManager: AuthManager,
  title: string,
  opts: EnsureLabelByTitleOptions = {},
): Promise<EnsureLabelByTitleResult> {
  const normalizedTitle = title.toLowerCase();

  // Narrow via the server's own search first (mirrors the `list` subcommand's
  // `s` param) — the authoritative match is still done client-side below
  // since `s` is a substring search, not guaranteed to be an exact
  // (case-insensitive) title match.
  const searchParams = new URLSearchParams();
  searchParams.set('s', title);
  const candidates = await vikunjaRestRequest<VikunjaLabel[]>(
    authManager,
    'GET',
    `/labels?${searchParams.toString()}`,
  );
  // Multiple candidates can share a case-insensitive title (e.g. "Bug" and
  // "bug" both created previously); dedupe by picking the first exact match
  // deterministically instead of creating a second duplicate.
  const existing = (Array.isArray(candidates) ? candidates : []).find(
    (label) => typeof label.title === 'string' && label.title.toLowerCase() === normalizedTitle,
  );

  if (existing) {
    if (typeof existing.id !== 'number' || typeof existing.title !== 'string') {
      throw new MCPError(
        ErrorCode.API_ERROR,
        `Label "${title}" matched an existing label with no numeric id`,
      );
    }
    return { id: existing.id, title: existing.title, created: false, label: existing };
  }

  // No existing label matched: create it.
  const labelData: VikunjaLabel = { title };
  if (opts.description) labelData.description = opts.description;
  if (opts.hexColor) labelData.hex_color = opts.hexColor;

  const created = await vikunjaRestRequest<VikunjaLabel>(authManager, 'PUT', '/labels', labelData);

  if (typeof created.id !== 'number' || typeof created.title !== 'string') {
    throw new MCPError(ErrorCode.API_ERROR, `Label "${title}" was created but returned no numeric id`);
  }

  return { id: created.id, title: created.title, created: true, label: created };
}
