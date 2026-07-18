/**
 * Routing tests for the new Wave D subcommands on `vikunja_projects`
 * (project views, Kanban bucket CRUD + per-view task listing, and
 * duplicate-project).
 *
 * These don't re-verify the REST payloads (that's covered by the
 * function-level tests in buckets.test.ts / views.test.ts /
 * duplicate.test.ts) -- they verify that `registerProjectsTool`'s switch
 * statement routes each new subcommand to the right handler with the args
 * cast correctly, and that the "project id required" guard fires before the
 * handler is ever called.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { AuthManager } from '../../../src/auth/AuthManager';
import { registerProjectsTool } from '../../../src/tools/projects';
import { MCPError, ErrorCode } from '../../../src/types';
import type { MockAuthManager, MockServer, ToolHandler } from '../../types/mocks';

jest.mock('../../../src/tools/projects/views', () => ({
  listViews: jest.fn(),
  getView: jest.fn(),
  createView: jest.fn(),
  updateView: jest.fn(),
  deleteView: jest.fn(),
  setDoneBucket: jest.fn(),
}));

jest.mock('../../../src/tools/projects/buckets', () => ({
  listBuckets: jest.fn(),
  createBucket: jest.fn(),
  updateBucket: jest.fn(),
  deleteBucket: jest.fn(),
  listViewTasks: jest.fn(),
}));

jest.mock('../../../src/tools/projects/duplicate', () => ({
  duplicateProject: jest.fn(),
}));

import {
  listViews,
  getView,
  createView,
  updateView,
  deleteView,
  setDoneBucket,
} from '../../../src/tools/projects/views';
import { listBuckets, createBucket, updateBucket, deleteBucket, listViewTasks } from '../../../src/tools/projects/buckets';
import { duplicateProject } from '../../../src/tools/projects/duplicate';

const okResult = { content: [{ type: 'text' as const, text: 'ok' }] };

describe('vikunja_projects routing: views, buckets, duplicate', () => {
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: ToolHandler;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
      connect: jest.fn(),
      getStatus: jest.fn(),
      isConnected: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as MockAuthManager;

    mockServer = {
      // The handler is always the last argument (server.tool now optionally
      // takes a ToolAnnotations object between the schema and the handler).
      tool: jest.fn((...args: unknown[]) => {
        toolHandler = args[args.length - 1] as ToolHandler;
      }),
    } as unknown as MockServer;

    registerProjectsTool(mockServer as never, mockAuthManager as unknown as AuthManager);

    (listViews as jest.Mock).mockResolvedValue(okResult);
    (getView as jest.Mock).mockResolvedValue(okResult);
    (createView as jest.Mock).mockResolvedValue(okResult);
    (updateView as jest.Mock).mockResolvedValue(okResult);
    (deleteView as jest.Mock).mockResolvedValue(okResult);
    (setDoneBucket as jest.Mock).mockResolvedValue(okResult);
    (listBuckets as jest.Mock).mockResolvedValue(okResult);
    (createBucket as jest.Mock).mockResolvedValue(okResult);
    (updateBucket as jest.Mock).mockResolvedValue(okResult);
    (deleteBucket as jest.Mock).mockResolvedValue(okResult);
    (listViewTasks as jest.Mock).mockResolvedValue(okResult);
    (duplicateProject as jest.Mock).mockResolvedValue(okResult);
  });

  const cases: Array<{
    subcommand: string;
    args: Record<string, unknown>;
    fn: jest.Mock;
    missingIdMessage: string;
  }> = [
    { subcommand: 'list-views', args: { id: 5 }, fn: listViews as jest.Mock, missingIdMessage: 'list-views' },
    {
      subcommand: 'get-view',
      args: { id: 5, viewId: 11 },
      fn: getView as jest.Mock,
      missingIdMessage: 'get-view',
    },
    {
      subcommand: 'create-view',
      args: { id: 5, title: 'New', viewKind: 'list' },
      fn: createView as jest.Mock,
      missingIdMessage: 'create-view',
    },
    {
      subcommand: 'update-view',
      args: { id: 5, viewId: 11, title: 'Renamed' },
      fn: updateView as jest.Mock,
      missingIdMessage: 'update-view',
    },
    {
      subcommand: 'delete-view',
      args: { id: 5, viewId: 11 },
      fn: deleteView as jest.Mock,
      missingIdMessage: 'delete-view',
    },
    {
      subcommand: 'set-done-bucket',
      args: { id: 5, bucketId: 101 },
      fn: setDoneBucket as jest.Mock,
      missingIdMessage: 'set-done-bucket',
    },
    {
      subcommand: 'list-buckets',
      args: { id: 5, viewId: 11 },
      fn: listBuckets as jest.Mock,
      missingIdMessage: 'list-buckets',
    },
    {
      subcommand: 'create-bucket',
      args: { id: 5, title: 'Doing' },
      fn: createBucket as jest.Mock,
      missingIdMessage: 'create-bucket',
    },
    {
      subcommand: 'update-bucket',
      args: { id: 5, bucketId: 100, title: 'x' },
      fn: updateBucket as jest.Mock,
      missingIdMessage: 'update-bucket',
    },
    {
      subcommand: 'delete-bucket',
      args: { id: 5, bucketId: 100 },
      fn: deleteBucket as jest.Mock,
      missingIdMessage: 'delete-bucket',
    },
    {
      subcommand: 'list-view-tasks',
      args: { id: 5 },
      fn: listViewTasks as jest.Mock,
      missingIdMessage: 'list-view-tasks',
    },
    {
      subcommand: 'duplicate',
      args: { id: 5 },
      fn: duplicateProject as jest.Mock,
      missingIdMessage: 'duplicate',
    },
  ];

  for (const { subcommand, args, fn, missingIdMessage } of cases) {
    it(`routes '${subcommand}' to its handler with the auth manager`, async () => {
      const result = await toolHandler({ subcommand, ...args });

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining(args),
        mockAuthManager,
      );
      expect(result).toBe(okResult);
    });

    it(`throws VALIDATION_ERROR for '${subcommand}' when project id is missing`, async () => {
      const { id: _omit, ...rest } = args;
      await expect(toolHandler({ subcommand, ...rest })).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          `Project ID is required for ${missingIdMessage} operation`,
        ),
      );
      expect(fn).not.toHaveBeenCalled();
    });

    // Item E1 (battle-tested friction #3): agents reach for the sibling
    // `projectId` field first on these subcommands (it's a flat field on the
    // same schema, used elsewhere for sharing ops) — `list-buckets` was
    // called with `projectId` and failed before succeeding on retry with
    // `id`. `projectId` is now accepted as an alias for `id` on every
    // subcommand in this table, not just `list-buckets`.
    it(`routes '${subcommand}' when the project id is passed as \`projectId\` instead of \`id\``, async () => {
      const { id, ...rest } = args;
      const result = await toolHandler({ subcommand, projectId: id, ...rest });

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ ...rest, id, projectId: id }),
        mockAuthManager,
      );
      expect(result).toBe(okResult);
    });
  }

  it('prefers an explicit `id` over `projectId` when both are supplied', async () => {
    await toolHandler({ subcommand: 'list-buckets', id: 5, projectId: 999, viewId: 11 });

    expect(listBuckets as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, projectId: 999 }),
      mockAuthManager,
    );
  });
});
