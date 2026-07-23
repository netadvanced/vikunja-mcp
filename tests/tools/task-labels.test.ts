/**
 * Wrapper-level tests for `vikunja_task_labels` (src/tools/task-labels.ts).
 *
 * The heavy lifting (title resolution, dedupe, idempotent apply/remove) lives
 * in and is covered by tests/tools/tasks/labels.test.ts. This file only
 * exercises the tool registration and the apply-label argument wiring added
 * for `labelTitles` — that `applyLabels` (the handler) receives exactly what
 * the caller passed, with the same `labels`/`labelTitles` defaulting the
 * pre-existing `labels` field already had.
 */

import type { AuthManager } from '../../src/auth/AuthManager';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn().mockResolvedValue(undefined),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockApplyLabels = jest.fn();
const mockRemoveLabels = jest.fn();
const mockListTaskLabels = jest.fn();
jest.mock('../../src/tools/tasks/labels', () => ({
  applyLabels: (...args: unknown[]) => mockApplyLabels(...args),
  removeLabels: (...args: unknown[]) => mockRemoveLabels(...args),
  listTaskLabels: (...args: unknown[]) => mockListTaskLabels(...args),
}));

import { registerTaskLabelsTool } from '../../src/tools/task-labels';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeMockServer(): {
  server: McpServer;
  getHandler: () => ToolHandler;
  getDescription: () => string;
} {
  let handler: ToolHandler | undefined;
  let description: string | undefined;
  const server = {
    tool: jest.fn((...args: unknown[]) => {
      description = args[1] as string;
      handler = args[args.length - 1] as ToolHandler;
    }),
  } as unknown as McpServer;
  return {
    server,
    getHandler: () => {
      if (!handler) throw new Error('tool handler was not captured');
      return handler;
    },
    getDescription: () => {
      if (description === undefined) throw new Error('tool description was not captured');
      return description;
    },
  };
}

function makeAuthenticatedAuthManager(): AuthManager {
  return {
    isAuthenticated: jest.fn().mockReturnValue(true),
  } as unknown as AuthManager;
}

describe('registerTaskLabelsTool', () => {
  const okResult = { content: [{ type: 'text' as const, text: 'ok' }] };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('describes labelTitles as the one-call attach-by-name path, not a two-call ensure-then-apply', () => {
    const { server, getDescription } = makeMockServer();
    registerTaskLabelsTool(server, makeAuthenticatedAuthManager());

    const description = getDescription();
    expect(description).toContain('labelTitles');
    expect(description).not.toContain('vikunja_labels with subcommand "ensure"');
  });

  it('passes both labels and labelTitles through to applyLabels on apply-label', async () => {
    mockApplyLabels.mockResolvedValue(okResult);
    const { server, getHandler } = makeMockServer();
    registerTaskLabelsTool(server, makeAuthenticatedAuthManager());

    const result = await getHandler()({
      operation: 'apply-label',
      id: 5,
      labels: [1],
      labelTitles: ['urgent'],
    });

    expect(mockApplyLabels).toHaveBeenCalledWith(
      { id: 5, labels: [1], labelTitles: ['urgent'] },
      expect.anything(),
    );
    expect(result).toBe(okResult);
  });

  it('defaults labelTitles to [] on apply-label when omitted (labels-only call, unchanged behavior)', async () => {
    mockApplyLabels.mockResolvedValue(okResult);
    const { server, getHandler } = makeMockServer();
    registerTaskLabelsTool(server, makeAuthenticatedAuthManager());

    await getHandler()({ operation: 'apply-label', id: 5, labels: [1] });

    expect(mockApplyLabels).toHaveBeenCalledWith(
      { id: 5, labels: [1], labelTitles: [] },
      expect.anything(),
    );
  });

  it('defaults labels to [] on apply-label when only labelTitles is provided', async () => {
    mockApplyLabels.mockResolvedValue(okResult);
    const { server, getHandler } = makeMockServer();
    registerTaskLabelsTool(server, makeAuthenticatedAuthManager());

    await getHandler()({ operation: 'apply-label', id: 5, labelTitles: ['urgent'] });

    expect(mockApplyLabels).toHaveBeenCalledWith(
      { id: 5, labels: [], labelTitles: ['urgent'] },
      expect.anything(),
    );
  });

  it('does not thread labelTitles through remove-label (title support is apply-only)', async () => {
    mockRemoveLabels.mockResolvedValue(okResult);
    const { server, getHandler } = makeMockServer();
    registerTaskLabelsTool(server, makeAuthenticatedAuthManager());

    await getHandler()({ operation: 'remove-label', id: 5, labels: [1] });

    expect(mockRemoveLabels).toHaveBeenCalledWith({ id: 5, labels: [1] }, expect.anything());
  });
});
