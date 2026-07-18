/**
 * Project Link Sharing Module
 *
 * Handles link sharing operations for projects: `create-share`,
 * `list-shares`, `get-share`, `delete-share`, `auth-share`.
 *
 * Migrated off the legacy client (Wave D domain migration, tracking issue #28)
 * onto `vikunjaRestRequest` + types generated from the vendored OpenAPI
 * spec. the legacy client's `LinkSharing` type is stale — it models
 * `right`/`label`/`password_enabled`/`expires`, none of which the real API
 * accepts or returns; the spec's `models.LinkSharing` uses `permission` and
 * `name`, and has no `expires`/`password_enabled`/`shares` field at all. See
 * docs/API_NOTES.md "Project Sharing" and docs/API-COVERAGE.md.
 *
 * Endpoints (verified against docs/vikunja-openapi.json):
 *   - PUT    /projects/{project}/shares         create
 *   - GET    /projects/{project}/shares         list
 *   - GET    /projects/{project}/shares/{share} get
 *   - DELETE /projects/{project}/shares/{share} delete
 *   - POST   /shares/{share}/auth               auth
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';
import { transformApiError } from '../../utils/error-handler';
import { validateId } from './validation';
import { resolvePermission, type PermissionInput } from './permission';
import { createProjectResponse } from './response-formatter';
import { formatAorpAsMarkdown } from '../../utils/response-factory';
import type { components } from '../../types/generated/vikunja-openapi';

type VikunjaLinkShare = components['schemas']['models.LinkSharing'];
type VikunjaMessage = components['schemas']['models.Message'];
type VikunjaAuthToken = components['schemas']['auth.Token'];
type VikunjaProject = components['schemas']['models.Project'];

// MCP response type
type McpResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

/**
 * Arguments for creating a project share
 */
export interface CreateShareArgs {
  projectId: number;
  right: PermissionInput;
  name?: string;
  password?: string;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for listing project shares
 */
export interface ListSharesArgs {
  projectId: number;
  page?: number;
  perPage?: number;
  /** Search shares by hash — the OpenAPI spec's `s` query param for
   *  `GET /projects/{project}/shares`. */
  search?: string;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for getting a project share
 */
export interface GetShareArgs {
  shareId: string;
  projectId: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for deleting a project share
 */
export interface DeleteShareArgs {
  shareId: string;
  projectId: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for authenticating a project share
 */
export interface AuthShareArgs {
  shareHash: string;
  projectId?: number;
  password?: string;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Re-throws a REST-layer 404 as a friendlier "project not found" message;
 * everything else is re-thrown unchanged (MCPError as-is, anything else
 * through `transformApiError`).
 */
function rethrowProjectNotFound(error: unknown, projectId: number, context: string): never {
  if (error instanceof MCPError) {
    if (error.details?.statusCode === 404) {
      throw new MCPError(ErrorCode.NOT_FOUND, `Project with ID ${projectId} not found`);
    }
    throw error;
  }
  throw transformApiError(error, context);
}

/**
 * Creates a new link share for a project
 */
export async function createProjectShare(
  args: CreateShareArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const {
    projectId,
    right,
    name,
    password,
    verbosity,
    useOptimizedFormat,
    useAorp
  } = args;

  try {
    validateId(projectId, 'project id');
    const numericRight = resolvePermission(right);

    // Verify the project exists before writing (verify-then-apply) so a
    // missing project produces a friendly NOT_FOUND rather than whatever
    // the shares endpoint itself happens to return for an absent project.
    await vikunjaRestRequest<VikunjaProject>(authManager, 'GET', `/projects/${projectId}`);

    // models.LinkSharing's request shape is {permission, name, password}.
    const body: { permission: number; name?: string; password?: string } = {
      permission: numericRight,
    };
    if (name !== undefined) {
      body.name = name.trim();
    }
    if (password !== undefined) {
      body.password = password;
    }

    const createdShare = await vikunjaRestRequest<VikunjaLinkShare>(
      authManager,
      'PUT',
      `/projects/${projectId}/shares`,
      body,
    );

    const result = createProjectResponse(
      'create_project_share',
      `Share created successfully for project ID ${projectId}`,
      { share: createdShare },
      {
        projectId,
        shareRight: right,
        hasPassword: !!password
      },
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError && error.code === ErrorCode.VALIDATION_ERROR) {
      throw error;
    }
    rethrowProjectNotFound(error, projectId, 'Failed to create share');
  }
}

/**
 * Lists all link shares for a project
 */
export async function listProjectShares(
  args: ListSharesArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const {
    projectId,
    page = 1,
    perPage = 50,
    search,
    verbosity,
    useOptimizedFormat,
    useAorp
  } = args;

  try {
    validateId(projectId, 'project id');

    // Verify the project exists first (same verify-then-apply shape as create).
    await vikunjaRestRequest<VikunjaProject>(authManager, 'GET', `/projects/${projectId}`);

    const params = new URLSearchParams();
    if (page !== 1) params.set('page', String(page));
    if (perPage !== 50) params.set('per_page', String(perPage));
    // `s` (search-by-hash) — the OpenAPI spec's third documented query param
    // for this endpoint, previously never exposed by this tool (see
    // docs/API-COVERAGE.md's Issues table).
    if (search !== undefined) params.set('s', search);
    const query = params.toString();

    const shares = await vikunjaRestRequest<VikunjaLinkShare[]>(
      authManager,
      'GET',
      `/projects/${projectId}/shares${query ? `?${query}` : ''}`,
    );
    const shareList = Array.isArray(shares) ? shares : [];

    const result = createProjectResponse(
      'list_project_shares',
      `Retrieved ${shareList.length} shares for project ${projectId}`,
      { shares: shareList },
      {
        projectId,
        page,
        perPage,
        ...(search !== undefined && { search }),
        count: shareList.length,
        totalShares: shareList.length
      },
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError && error.code === ErrorCode.VALIDATION_ERROR) {
      throw error;
    }
    rethrowProjectNotFound(error, projectId, 'Failed to list shares');
  }
}

/**
 * Gets a specific link share by ID
 */
export async function getProjectShare(
  args: GetShareArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { shareId, projectId, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    if (!shareId || typeof shareId !== 'string' || shareId.trim().length === 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Share ID must be a non-empty string'
      );
    }

    if (!projectId || typeof projectId !== 'number' || projectId <= 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Project ID is required'
      );
    }

    const share = await vikunjaRestRequest<VikunjaLinkShare>(
      authManager,
      'GET',
      `/projects/${projectId}/shares/${Number(shareId)}`,
    );

    const shareDisplayName = share.name || `Share #${shareId}`;
    const result = createProjectResponse(
      'get_project_share',
      `Retrieved link share: ${shareDisplayName}`,
      { share },
      { shareId },
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      if (error.details?.statusCode === 404) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Share with ID ${shareId} not found for project ${projectId}`);
      }
      throw error;
    }
    throw transformApiError(error, 'Failed to get share');
  }
}

/**
 * Deletes a link share
 */
export async function deleteProjectShare(
  args: DeleteShareArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { shareId, projectId, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    if (!shareId || typeof shareId !== 'string' || shareId.trim().length === 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Share ID must be a non-empty string'
      );
    }

    if (!projectId || typeof projectId !== 'number' || projectId <= 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Project ID is required'
      );
    }

    // Get share details before deletion so the response can report the
    // share's name and project id.
    const share = await vikunjaRestRequest<VikunjaLinkShare>(
      authManager,
      'GET',
      `/projects/${projectId}/shares/${Number(shareId)}`,
    );

    await vikunjaRestRequest<VikunjaMessage>(
      authManager,
      'DELETE',
      `/projects/${projectId}/shares/${Number(shareId)}`,
    );

    const result = createProjectResponse(
      'delete_project_share',
      `Share with ID ${shareId} deleted successfully`,
      {
        deleted: true,
        shareId,
        shareName: share.name,
        projectId,
      },
      {
        projectId,
        shareId,
        shareName: share.name
      },
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      if (error.details?.statusCode === 404) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Share with ID ${shareId} not found for project ${projectId}`);
      }
      throw error;
    }
    throw transformApiError(error, 'Failed to delete share');
  }
}

/**
 * Authenticates access to a shared project
 */
export async function authProjectShare(
  args: AuthShareArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { shareHash, password, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    if (!shareHash || typeof shareHash !== 'string' || shareHash.trim().length === 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Share hash must be a non-empty string'
      );
    }

    // v1.LinkShareAuth: {password}. Unauthenticated endpoint (no share-scoped
    // JWT needed yet — this call obtains one), but vikunjaRestRequest is
    // still used since it uses the same host/breaker/retry plumbing as every
    // other authenticated call; the session's Authorization header is simply
    // unused server-side for this specific route.
    const authResult = await vikunjaRestRequest<VikunjaAuthToken>(
      authManager,
      'POST',
      `/shares/${shareHash}/auth`,
      { password: password || '' },
    );

    const result = createProjectResponse(
      'auth_project_share',
      `Successfully authenticated to share`,
      { auth: authResult },
      {
        shareHash,
        hasPassword: !!password,
        authenticated: true
      },
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      if (error.code === ErrorCode.VALIDATION_ERROR) {
        throw error;
      }
      if (error.details?.statusCode === 401) {
        throw new MCPError(ErrorCode.VALIDATION_ERROR, `Invalid password for share`);
      }
      if (error.details?.statusCode === 404) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Share with hash ${shareHash} not found`);
      }
      throw error;
    }

    throw transformApiError(error, 'Failed to authenticate to share');
  }
}
