/**
 * Dispatch-level tests for the `set-position` and `get-by-index`
 * `vikunja_tasks` subcommands — verifies the tool's Zod schema accepts the
 * new fields and the switch statement routes to the right handler with
 * `authManager` threaded through, end to end via `registerTasksTool`.
 * Handler-level behavior (validation, resolution, payloads) is covered in
 * tests/tools/tasks/position.test.ts and tests/tools/tasks/by-index.test.ts.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { registerTasksTool } from '../../src/tools/tasks';
import { getAuthManagerFromContext } from '../../src/client';
import { createMockTestableAuthManager } from '../utils/test-utils';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { circuitBreakerRegistry } from '../../src/utils/retry';

jest.mock('../../src/client');
jest.mock('../../src/auth/AuthManager');
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const mockGetAuthManagerFromContext = getAuthManagerFromContext as jest.MockedFunction<
  typeof getAuthManagerFromContext
>;

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object for the REST helper. */
function mockResponse(opts: { ok?: boolean; status?: number; statusText?: string; text?: string }): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('vikunja_tasks dispatch — set-position / get-by-index', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockClient: MockVikunjaClient;
  let toolHandler: (args: any) => Promise<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

    mockClient = { getToken: jest.fn().mockReturnValue('test-token') } as unknown as MockVikunjaClient;

    mockAuthManager = createMockTestableAuthManager();
    mockAuthManager.isAuthenticated.mockReturnValue(true);
    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-token',
      authType: 'api-token' as const,
      userId: 'test-user-123',
    });
    mockAuthManager.getAuthType.mockReturnValue('api-token');

    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    mockGetAuthManagerFromContext.mockResolvedValue(mockAuthManager as any);
    registerTasksTool(mockServer as any, mockAuthManager as any);

    const calls = mockServer.tool.mock.calls;
    if (calls.length > 0 && calls[0] && calls[0].length > 3) {
      toolHandler = calls[0][calls[0].length - 1];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  it('routes set-position through the switch statement to setTaskPosition', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

    const result = await toolHandler({
      subcommand: 'set-position',
      id: 1,
      position: 100,
      projectId: 5,
      projectViewId: 10,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('https://api.vikunja.test/api/v1/tasks/1/position');
    expect(result.content[0].text).toContain('Task 1 repositioned to 100');
  });

  it('routes get-by-index through the switch statement to getTaskByIndex', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ text: JSON.stringify({ id: 42, title: 'Found task' }) }),
    );

    const result = await toolHandler({
      subcommand: 'get-by-index',
      projectId: 5,
      index: 7,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('https://api.vikunja.test/api/v1/projects/5/tasks/by-index/7');
    expect(result.content[0].text).toContain('Resolved task at index 7 in project 5');
  });
});
