/**
 * Task Read Service
 * Handles task retrieval operations with comprehensive error handling
 */

import { MCPError, ErrorCode, transformApiError, handleFetchError, handleStatusCodeError } from '../../../index';
import type { AuthManager } from '../../../auth/AuthManager';
import { vikunjaRestRequest } from '../../../utils/vikunja-rest';
import { validateId } from '../validation';
import { createTaskResponse } from './TaskResponseFormatter';
import { formatAorpAsMarkdown } from '../../../utils/response-factory';
import type { components } from '../../../types/generated/vikunja-openapi';

/** `models.Task` per the OpenAPI spec — GET /tasks/{id}'s response shape. */
type VikunjaTask = components['schemas']['models.Task'];

export interface GetTaskArgs {
  id?: number;
  sessionId?: string;
}

/**
 * Retrieves a task by ID with comprehensive error handling
 */
export async function getTask(
  args: GetTaskArgs,
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (!args.id) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for get operation');
    }
    validateId(args.id, 'id');

    const task = await vikunjaRestRequest<VikunjaTask>(authManager, 'GET', `/tasks/${args.id}`);

    const response = createTaskResponse(
      'get-task',
      `Retrieved task "${task.title}"`,
      { task } as unknown as Parameters<typeof createTaskResponse>[2],
      {
        timestamp: new Date().toISOString(),
        taskId: args.id,
      },
      undefined, // verbosity (ignored)
      undefined, // useOptimizedFormat (ignored)
      undefined, // useAorp (ignored)
      undefined, // aorpConfig (using auto-generated)
      args.sessionId
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response.response),
        },
      ],
    };
  } catch (error) {
    // A REST 404 is translated to the same friendly "not found" message the
    // pre-migration node-vikunja error path produced via handleStatusCodeError
    // (which keys off a bare `.statusCode` property). vikunjaRestRequest
    // always throws MCPError with the status nested under `.details`, so that
    // 404 case is intercepted here, before the generic MCPError passthrough
    // below would otherwise re-throw the raw REST error message unchanged.
    if (error instanceof MCPError) {
      if (error.details?.statusCode === 404 && args.id) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Task with ID ${args.id} not found`);
      }
      throw error;
    }

    // Handle fetch/connection errors with helpful guidance
    if (error instanceof Error && (
      error.message.includes('fetch failed') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    )) {
      throw handleFetchError(error, 'get task');
    }

    // Use standardized error transformation for all other errors
    if (args.id) {
      throw handleStatusCodeError(error, 'get task', args.id, `Task with ID ${args.id} not found`);
    }
    throw transformApiError(error, 'Failed to get task');
  }
}
