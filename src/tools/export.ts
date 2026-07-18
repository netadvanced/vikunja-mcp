/**
 * Export Tool
 * Handles exporting project data from Vikunja
 *
 * @warning Memory Usage: The export functionality loads entire project hierarchies
 * into memory. For very large projects with thousands of tasks or deeply nested
 * child projects, this could consume significant memory. Consider implementing
 * pagination or streaming for production use with large datasets.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode, createStandardResponse } from '../types';
import { formatAorpAsMarkdown } from '../utils/response-factory';
import { logger } from '../utils/logger';
import { validateId as validateSharedId } from '../utils/validation';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';
import type { components } from '../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json).
type VikunjaProject = components['schemas']['models.Project'];
type VikunjaTask = components['schemas']['models.Task'];
type VikunjaLabel = components['schemas']['models.Label'];
type VikunjaUser = components['schemas']['user.User'];

/**
 * Shape of the JSON body Vikunja returns from both `POST /user/export/request`
 * and `POST /user/export/download`. Per the OpenAPI spec, both endpoints
 * respond with `models.Message` — a plain `{ message: string }` confirmation
 * — never the export archive itself. There is no documented endpoint that
 * streams the actual export file as JSON, and the MCP protocol has no
 * binary/file-attachment support to deliver one even if there were.
 */
interface VikunjaMessageResponse {
  message?: string;
}

/**
 * Export format for project data
 */
interface ProjectExportData {
  project: VikunjaProject;
  tasks: VikunjaTask[];
  labels: VikunjaLabel[];
  team_members?: VikunjaUser[];
  child_projects?: ProjectExportData[];
  exported_at: string;
  version: string;
}

/**
 * Recursively exports a project and its children.
 *
 * All calls go through the direct-REST helper (`vikunjaRestRequest`). This
 * function deliberately keeps the documented O(depth) refetch shape (one
 * `GET /projects` per recursion level to re-derive that level's children) —
 * that inefficiency is a pre-existing, documented tradeoff, not something
 * this transport migration is meant to fix.
 */
async function exportProjectRecursive(
  authManager: AuthManager,
  projectId: number,
  includeChildren: boolean = false,
  visitedIds: Set<number> = new Set(),
): Promise<ProjectExportData> {
  // Prevent infinite recursion
  if (visitedIds.has(projectId)) {
    throw new MCPError(
      ErrorCode.INTERNAL_ERROR,
      'Circular reference detected in project hierarchy',
    );
  }
  visitedIds.add(projectId);

  // Get project details
  const project = await vikunjaRestRequest<VikunjaProject>(
    authManager,
    'GET',
    `/projects/${projectId}`,
  );
  if (!project) {
    throw new MCPError(ErrorCode.NOT_FOUND, `Project with ID ${projectId} not found`);
  }

  // Get all tasks for the project. NOTE: `GET /projects/{id}/tasks` is not
  // present in the vendored OpenAPI spec (only `PUT` is documented there) —
  // this mirrors the legacy client's own `getProjectTasks`, which calls this same
  // undocumented-but-functional path. Preserved as-is per this migration's
  // "transport only, same behavior" scope.
  const tasks = await vikunjaRestRequest<VikunjaTask[]>(
    authManager,
    'GET',
    `/projects/${projectId}/tasks`,
  );

  // Get all labels used in the project
  const labelIds = new Set<number>();
  tasks.forEach((task: VikunjaTask) => {
    if (task.labels && Array.isArray(task.labels)) {
      task.labels.forEach((label) => {
        if (label.id) {
          labelIds.add(label.id);
        }
      });
    }
  });

  // Fetch full label details. GET /labels/{id} per the OpenAPI spec.
  const labels: VikunjaLabel[] = [];
  for (const labelId of labelIds) {
    try {
      const label = await vikunjaRestRequest<VikunjaLabel>(
        authManager,
        'GET',
        `/labels/${labelId}`,
      );
      if (label) {
        labels.push(label);
      }
    } catch (error) {
      // Label might have been deleted, skip it
      logger.warn(`Failed to fetch label ${labelId}:`, error);
    }
  }

  // Build export data
  const exportData: ProjectExportData = {
    project,
    tasks,
    labels,
    exported_at: new Date().toISOString(),
    version: '1.0.0',
  };

  // Export child projects if requested
  if (includeChildren && project.id) {
    const allProjects = await vikunjaRestRequest<VikunjaProject[]>(authManager, 'GET', '/projects');
    const childProjects = allProjects.filter(
      (p: VikunjaProject) => p.parent_project_id === project.id,
    );

    if (childProjects.length > 0) {
      exportData.child_projects = [];
      for (const child of childProjects) {
        if (child.id) {
          const childExport = await exportProjectRecursive(
            authManager,
            child.id,
            true,
            new Set(visitedIds),
          );
          exportData.child_projects.push(childExport);
        }
      }
    }
  }

  return exportData;
}

// Schema definitions

export function registerExportTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  // Export project data
  server.tool(
    'vikunja_export_project',
    withReadOnlyNote(
      'vikunja_export_project',
      'Export project data including tasks, labels, and metadata in structured format',
    ),
    {
      projectId: z.number().int().positive(),
      includeChildren: z.boolean().optional().default(false),
    },
    getToolAnnotations('vikunja_export_project'),
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      // Export operations require JWT authentication
      if (authManager.getAuthType() !== 'jwt') {
        throw new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'Export operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        );
      }

      // No subcommand field on this single-purpose tool — 'export' is its
      // fixed classification-table key (GET-only, always 'read').
      assertWriteAllowed('vikunja_export_project', 'export');

      try {
        const { projectId, includeChildren } = args;

        validateSharedId(projectId, 'projectId');

        // Export the project data
        const exportData = await exportProjectRecursive(
          authManager,
          projectId,
          includeChildren,
        );

        // Format the output as JSON
        const formattedData = JSON.stringify(exportData, null, 2);

        const response = createStandardResponse('success', 'Project exported successfully', {
          project_id: projectId,
          project_title: exportData.project.title,
          task_count: exportData.tasks.length,
          label_count: exportData.labels.length,
          child_project_count: exportData.child_projects?.length || 0,
          export_size_bytes: Buffer.byteLength(formattedData, 'utf8'),
          exported_at: exportData.exported_at,
          data: exportData,
        });

        return {
          content: [
            {
              type: 'text',
              text: formatAorpAsMarkdown(response),
            },
          ],
        };
      } catch (error) {
        // MCP validates schema before calling handler, so this is unreachable
        /* istanbul ignore if */
        if (error instanceof z.ZodError) {
          /* istanbul ignore next 4 */
          throw new MCPError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          );
        }
        throw error;
      }
    },
  );

  // Request user data export
  server.tool(
    'vikunja_request_user_export',
    withReadOnlyNote(
      'vikunja_request_user_export',
      'Request a complete export of user data for privacy and backup purposes. This calls POST /user/export/request, which asks the Vikunja server to start preparing the export; it returns only a confirmation message, not the export itself. Use vikunja_download_user_export afterwards to confirm the export is ready.',
    ),
    {
      password: z.string().min(1),
    },
    getToolAnnotations('vikunja_request_user_export'),
    async (args) => {
      try {
        const { password } = args;

        if (!authManager.getSession().apiToken) {
          throw new MCPError(ErrorCode.AUTH_REQUIRED, 'No authentication token available');
        }

        // No subcommand field on this single-purpose tool — 'request' is
        // its fixed classification-table key.
        assertWriteAllowed('vikunja_request_user_export', 'request');

        const result = await vikunjaRestRequest<VikunjaMessageResponse>(
          authManager,
          'POST',
          '/user/export/request',
          { password },
        );

        const response = createStandardResponse(
          'success',
          'User data export requested successfully. You will receive an email when the export is ready.',
          { serverMessage: result?.message ?? null },
        );

        return {
          content: [
            {
              type: 'text',
              text: formatAorpAsMarkdown(response),
            },
          ],
        };
      } catch (error) {
        // MCP validates schema before calling handler, so this is unreachable
        /* istanbul ignore if */
        if (error instanceof z.ZodError) {
          /* istanbul ignore next 4 */
          throw new MCPError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          );
        }
        throw error;
      }
    },
  );

  // Confirm delivery of a previously requested user data export
  server.tool(
    'vikunja_download_user_export',
    withReadOnlyNote(
      'vikunja_download_user_export',
      "Confirm that a previously requested user data export is ready on the server. IMPORTANT: per the Vikunja API spec, POST /user/export/download returns only a confirmation message (models.Message: { message }) — it does NOT return the export archive's contents, and there is no separate JSON endpoint that does. The MCP protocol also has no binary/file-attachment support, so the exported .zip cannot be retrieved through this tool under any circumstances. To obtain the actual file, download it directly from the Vikunja web UI (Settings > Export Data) or with a direct HTTP client using the same credentials.",
    ),
    {
      password: z.string().min(1),
    },
    getToolAnnotations('vikunja_download_user_export'),
    async (args) => {
      try {
        const { password } = args;

        if (!authManager.getSession().apiToken) {
          throw new MCPError(ErrorCode.AUTH_REQUIRED, 'No authentication token available');
        }

        // No subcommand field on this single-purpose tool — 'download' is
        // its fixed classification-table key (confirmation-only, no new
        // state created — see DOWNLOAD_USER_EXPORT's rationale comment in
        // src/utils/read-only.ts).
        assertWriteAllowed('vikunja_download_user_export', 'download');

        const result = await vikunjaRestRequest<VikunjaMessageResponse>(
          authManager,
          'POST',
          '/user/export/download',
          { password },
        );

        const response = createStandardResponse(
          'success',
          'The server confirmed the export download request. The Vikunja API does not return the export file itself through this endpoint, and the MCP protocol cannot deliver binary attachments — retrieve the exported archive from the Vikunja web UI or a direct API client instead.',
          {
            serverMessage: result?.message ?? null,
            fileDeliveredThroughThisTool: false,
          },
        );

        return {
          content: [
            {
              type: 'text',
              text: formatAorpAsMarkdown(response),
            },
          ],
        };
      } catch (error) {
        // MCP validates schema before calling handler, so this is unreachable
        /* istanbul ignore if */
        if (error instanceof z.ZodError) {
          /* istanbul ignore next 4 */
          throw new MCPError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          );
        }
        throw error;
      }
    },
  );
}
