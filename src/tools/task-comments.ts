/**
 * Task Comments Tool
 * Handles task comment operations: comment (create/list legacy), list, get, update, delete
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getAuthManagerFromContext, hasRequestContext, setGlobalClientFactory } from '../client';
import { logger } from '../utils/logger';
import { createAuthRequiredError } from '../utils/error-handler';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';
import {
  handleComment,
  listComments,
  getComment,
  updateComment,
  removeComment,
} from '../tools/tasks/comments/index';

/**
 * Register task comments tool
 */
export function registerTaskCommentsTool(
  server: McpServer,
  authManager: AuthManager,
  clientFactory?: VikunjaClientFactory
): void {
  server.tool(
    'vikunja_task_comments',
    withReadOnlyNote(
      'vikunja_task_comments',
      'Manage task comments: create, list, get, update, delete comments on tasks',
    ),
    {
      operation: z.enum(['comment', 'list', 'get', 'update', 'delete']),
      // Task and comment identification
      id: z.number(),
      comment: z.string().optional(),
      commentId: z.number().optional(),
    },
    getToolAnnotations('vikunja_task_comments'),
    async (args) => {
      try {
        logger.debug('Executing task comments tool', { operation: args.operation, taskId: args.id });

        // Check authentication (closure-gate precedence fix: defer to the
        // per-request context when bound — see hasRequestContext's doc
        // comment, src/client.ts)
        if (hasRequestContext()) {
          await getAuthManagerFromContext();
        } else if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access task comment operations');
        }

        // 'comment' is dual-purpose (creates when text is supplied,
        // otherwise lists — see handleComment), so its effective
        // classification depends on whether `comment` text was provided.
        assertWriteAllowed(
          'vikunja_task_comments',
          args.operation,
          args.operation === 'comment' ? (args.comment ? 'write' : 'read') : undefined,
        );

        // Set the client factory for this request if provided
        if (clientFactory) {
          await setGlobalClientFactory(clientFactory);
        }

        // Ensure the session is initialized
        await getAuthManagerFromContext();

        switch (args.operation) {
          case 'comment':
            return handleComment(args, authManager);

          case 'list':
            return listComments(args, authManager);

          case 'get':
            return getComment(args, authManager);

          case 'update':
            return updateComment(args, authManager);

          case 'delete':
            return removeComment(args, authManager);

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown operation: ${String(args.operation)}`,
            );
        }
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Task comment operation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}