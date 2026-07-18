/**
 * Task Relations Tool
 * Handles task relation operations: relate, unrelate, relations
 * Replaces monolithic tasks tool with focused individual tool
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { getAuthManagerFromContext, setGlobalClientFactory } from '../client';
import { logger } from '../utils/logger';
import { createAuthRequiredError } from '../utils/error-handler';
import { handleRelationSubcommands } from '../tools/tasks-relations';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';

/**
 * Register task relations tool
 */
export function registerTaskRelationsTool(
  server: McpServer,
  authManager: AuthManager,
  clientFactory?: VikunjaClientFactory
): void {
  server.tool(
    'vikunja_task_relations',
    withReadOnlyNote(
      'vikunja_task_relations',
      'Manage task relationships: relate tasks, unrelate tasks, list relations',
    ),
    {
      operation: z.enum(['relate', 'unrelate', 'relations']),
      // Task identification
      id: z.number(),
      otherTaskId: z.number().optional(),
      relationKind: z.enum([
        'unknown',
        'subtask',
        'parenttask',
        'related',
        'duplicateof',
        'duplicates',
        'blocking',
        'blocked',
        'precedes',
        'follows',
        'copiedfrom',
        'copiedto',
      ]).optional(),
    },
    getToolAnnotations('vikunja_task_relations'),
    async (args) => {
      try {
        logger.debug('Executing task relations tool', {
          operation: args.operation,
          taskId: args.id,
          otherTaskId: args.otherTaskId,
          relationKind: args.relationKind
        });

        // Check authentication
        if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access task relation operations');
        }

        assertWriteAllowed('vikunja_task_relations', args.operation);

        // Set the client factory for this request if provided
        if (clientFactory) {
          await setGlobalClientFactory(clientFactory);
        }

        // Test client connection
        await getAuthManagerFromContext();

        // Use the existing relation handler
        return handleRelationSubcommands(
          {
            subcommand: args.operation,
            id: args.id,
            otherTaskId: args.otherTaskId,
            relationKind: args.relationKind,
          },
          authManager,
        );

      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Task relation operation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}