/**
 * Task Comments Tool
 * Handles task comment operations: comment (create/list legacy), list, get, update, delete
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getClientFromContext, setGlobalClientFactory } from '../client';
import { logger } from '../utils/logger';
import { createAuthRequiredError } from '../utils/error-handler';
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
    'Manage task comments: create, list, get, update, delete comments on tasks',
    {
      operation: z.enum(['comment', 'list', 'get', 'update', 'delete']),
      // Task and comment identification
      id: z.number(),
      comment: z.string().optional(),
      commentId: z.number().optional(),
    },
    async (args) => {
      try {
        logger.debug('Executing task comments tool', { operation: args.operation, taskId: args.id });

        // Check authentication
        if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access task comment operations');
        }

        // Set the client factory for this request if provided
        if (clientFactory) {
          await setGlobalClientFactory(clientFactory);
        }

        // Test client connection
        await getClientFromContext();

        switch (args.operation) {
          case 'comment':
            return handleComment(args);

          case 'list':
            return listComments(args);

          case 'get':
            return getComment(args);

          case 'update':
            return updateComment(args);

          case 'delete':
            return removeComment(args);

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