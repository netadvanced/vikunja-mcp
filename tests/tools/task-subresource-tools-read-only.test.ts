/**
 * Global read-only safety mode: dispatcher wiring for the six standalone
 * task sub-resource tools (task-bulk, task-assignees, task-comments,
 * task-reminders, task-labels, task-relations). Each of these calls
 * `assertWriteAllowed` once, right after its auth check — this suite
 * confirms that call is actually wired up with the right tool name and
 * dispatch key, for both read-only modes.
 *
 * These tools have no other dedicated test file (see docs note: they are
 * thin wrappers around the same handlers `vikunja_tasks` exposes), so this
 * file also exercises `registerXTool` itself rather than assuming coverage
 * comes from elsewhere.
 */

import { ConfigurationManager } from '../../src/config';
import { MCPError } from '../../src/types';
import type { AuthManager } from '../../src/auth/AuthManager';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn().mockRejectedValue(new Error('no client context in this test')),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { registerTaskBulkTool } from '../../src/tools/task-bulk';
import { registerTaskAssigneesTool } from '../../src/tools/task-assignees';
import { registerTaskCommentsTool } from '../../src/tools/task-comments';
import { registerTaskRemindersTool } from '../../src/tools/task-reminders';
import { registerTaskLabelsTool } from '../../src/tools/task-labels';
import { registerTaskRelationsTool } from '../../src/tools/task-relations';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeMockServer(): { server: McpServer; getHandler: () => ToolHandler } {
  let handler: ToolHandler | undefined;
  const server = {
    tool: jest.fn((...args: unknown[]) => {
      handler = args[args.length - 1] as ToolHandler;
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: () => {
      if (!handler) {
        throw new Error('tool handler was not captured');
      }
      return handler;
    },
  };
}

function makeAuthenticatedAuthManager(): AuthManager {
  return {
    isAuthenticated: jest.fn().mockReturnValue(true),
    getAuthType: jest.fn().mockReturnValue('api-token'),
    getSession: jest.fn().mockReturnValue({ apiUrl: 'https://vikunja.test', apiToken: 'tk_test' }),
  } as unknown as AuthManager;
}

function setReadOnly(value: boolean): void {
  ConfigurationManager.reset();
  ConfigurationManager.getInstance({ sources: { readOnly: value } });
}

/** Runs a handler call and returns the error, if any, without failing the test. */
async function safeCall(handler: ToolHandler, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await handler(args);
  } catch (error) {
    return error;
  }
}

function isReadOnlyRejection(result: unknown): boolean {
  return (
    result instanceof MCPError &&
    typeof result.message === 'string' &&
    result.message.includes('server is in read-only mode')
  );
}

describe('task sub-resource tools — global read-only mode wiring', () => {
  afterEach(() => {
    ConfigurationManager.reset();
    jest.clearAllMocks();
  });

  const cases: Array<{
    label: string;
    register: (server: McpServer, authManager: AuthManager) => void;
    // vikunja_task_bulk has no read subcommand at all (bulk-create/
    // bulk-update/bulk-delete are all write/destructive) — omit to skip
    // the "read op passes" assertion for it.
    readArgs?: Record<string, unknown>;
    writeArgs: Record<string, unknown>;
    destructiveArgs: Record<string, unknown>;
  }> = [
    {
      label: 'vikunja_task_bulk',
      register: registerTaskBulkTool,
      writeArgs: { operation: 'bulk-create', projectId: 1, tasks: [] },
      destructiveArgs: { operation: 'bulk-delete', taskIds: [1] },
    },
    {
      label: 'vikunja_task_assignees',
      register: registerTaskAssigneesTool,
      readArgs: { operation: 'list-assignees', id: 1 },
      writeArgs: { operation: 'assign', id: 1, assignees: [1] },
      destructiveArgs: { operation: 'unassign', id: 1, assignees: [1] },
    },
    {
      label: 'vikunja_task_comments (list)',
      register: registerTaskCommentsTool,
      readArgs: { operation: 'list', id: 1 },
      writeArgs: { operation: 'update', id: 1, commentId: 1, comment: 'hi' },
      destructiveArgs: { operation: 'delete', id: 1, commentId: 1 },
    },
    {
      label: 'vikunja_task_reminders',
      register: registerTaskRemindersTool,
      readArgs: { operation: 'list-reminders', id: 1 },
      writeArgs: { operation: 'add-reminder', id: 1, reminderDate: '2025-01-01T00:00:00Z' },
      destructiveArgs: { operation: 'remove-reminder', id: 1, reminderIndex: 0 },
    },
    {
      label: 'vikunja_task_labels',
      register: registerTaskLabelsTool,
      readArgs: { operation: 'list-labels', id: 1 },
      writeArgs: { operation: 'apply-label', id: 1, labels: [1] },
      destructiveArgs: { operation: 'remove-label', id: 1, labels: [1] },
    },
    {
      label: 'vikunja_task_relations',
      register: registerTaskRelationsTool,
      readArgs: { operation: 'relations', id: 1 },
      writeArgs: { operation: 'relate', id: 1, otherTaskId: 2, relationKind: 'related' },
      destructiveArgs: { operation: 'unrelate', id: 1, otherTaskId: 2, relationKind: 'related' },
    },
  ];

  for (const { label, register, readArgs, writeArgs, destructiveArgs } of cases) {
    describe(label, () => {
      it('rejects the write op with the read-only error when readOnly is on', async () => {
        setReadOnly(true);
        const { server, getHandler } = makeMockServer();
        register(server, makeAuthenticatedAuthManager());
        const result = await safeCall(getHandler(), writeArgs);
        expect(isReadOnlyRejection(result)).toBe(true);
      });

      it('rejects the destructive op with the read-only error when readOnly is on', async () => {
        setReadOnly(true);
        const { server, getHandler } = makeMockServer();
        register(server, makeAuthenticatedAuthManager());
        const result = await safeCall(getHandler(), destructiveArgs);
        expect(isReadOnlyRejection(result)).toBe(true);
      });

      if (readArgs) {
        it('does not raise the read-only error for the read op when readOnly is on', async () => {
          setReadOnly(true);
          const { server, getHandler } = makeMockServer();
          register(server, makeAuthenticatedAuthManager());
          const result = await safeCall(getHandler(), readArgs);
          expect(isReadOnlyRejection(result)).toBe(false);
        });
      }

      it('does not raise the read-only error for the write op when readOnly is off', async () => {
        setReadOnly(false);
        const { server, getHandler } = makeMockServer();
        register(server, makeAuthenticatedAuthManager());
        const result = await safeCall(getHandler(), writeArgs);
        expect(isReadOnlyRejection(result)).toBe(false);
      });
    });
  }
});
