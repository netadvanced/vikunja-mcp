/**
 * Project duplication
 *
 * Implements `duplicate` (`PUT /projects/{projectID}/duplicate`), which
 * copies a project along with its tasks, files, kanban data, assignees,
 * comments, attachments, labels, relations, and backgrounds into a new
 * project. legacy client exposes `duplicateProject`, but per
 * docs/ENDPOINT-PLAYBOOK.md §3 this domain's new HTTP calls go through the
 * direct-REST helper rather than adding a legacy client call site.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { validateId } from '../../utils/validation';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';
import type { components } from '../../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json).
type VikunjaProjectDuplicate = components['schemas']['models.ProjectDuplicate'];

export interface DuplicateProjectArgs {
  /** Id of the project to duplicate. */
  id?: number;
  /**
   * Target parent project for the copy. Omitted (or `0`) duplicates to the
   * root level, matching the API's own "0 = root" convention (see
   * `moveProject` in `hierarchy.ts` for the same convention on the sibling
   * move endpoint).
   */
  parentProjectId?: number;
  /**
   * Whether to also copy the project's user/team shares and link shares to
   * the duplicate. Defaults to `false` (Vikunja's own default) — shares are
   * access grants, so copying them silently would be a security-relevant
   * surprise.
   */
  duplicateShares?: boolean;
  /** Session id for response tracking. */
  sessionId?: string;
}

/**
 * Duplicates a project.
 */
export async function duplicateProject(
  args: DuplicateProjectArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!args.id) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project id is required for duplicate operation');
  }
  validateId(args.id, 'id');
  if (args.parentProjectId !== undefined && args.parentProjectId !== 0) {
    validateId(args.parentProjectId, 'parentProjectId');
  }

  const body: VikunjaProjectDuplicate = {
    parent_project_id: args.parentProjectId ?? 0,
    duplicate_shares: args.duplicateShares ?? false,
  };

  const result = await vikunjaRestRequest<VikunjaProjectDuplicate>(
    authManager,
    'PUT',
    `/projects/${args.id}/duplicate`,
    body,
  );

  const duplicated = result?.duplicated_project;

  const response = createStandardResponse(
    'duplicate',
    duplicated?.id !== undefined
      ? `Project ${args.id} duplicated as project ${duplicated.id}`
      : `Project ${args.id} duplicated`,
    {
      sourceProjectId: args.id,
      parentProjectId: body.parent_project_id,
      duplicateShares: body.duplicate_shares,
      duplicatedProject: duplicated,
    },
    {
      timestamp: new Date().toISOString(),
    },
    args.sessionId,
  );

  return {
    content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
  };
}
