/**
 * Tests the `vikunja_projects` tool's dispatch/wiring for the new direct
 * user/team sharing subcommands: required-argument validation and that each
 * subcommand actually reaches the REST layer with the right args threaded
 * through. Business-logic assertions (payload shape, composite resolution,
 * compensation) live in sharing-access.test.ts / sharing.test.ts — this file
 * is about `registerProjectsTool`'s switch-case wiring itself.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import { registerProjectsTool } from '../../../src/tools/projects';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text?: string;
}): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

describe('vikunja_projects dispatch — direct user/team sharing', () => {
  let authManager: AuthManager;
  let toolHandler: ToolHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    const mockServer = { tool: jest.fn() } as unknown as { tool: jest.Mock };
    registerProjectsTool(mockServer as never, authManager);
    toolHandler = mockServer.tool.mock.calls[0][3] as ToolHandler;
  });

  async function callTool(subcommand: string, args: Record<string, unknown> = {}) {
    return toolHandler({ subcommand, ...args });
  }

  describe('required-argument validation', () => {
    const cases: Array<{ subcommand: string; args: Record<string, unknown>; message: string }> = [
      { subcommand: 'list-project-users', args: {}, message: 'Project ID is required for list-project-users operation' },
      { subcommand: 'search-project-users', args: {}, message: 'Project ID is required for search-project-users operation' },
      { subcommand: 'add-project-user', args: {}, message: 'Project ID is required for add-project-user operation' },
      { subcommand: 'add-project-user', args: { projectId: 1 }, message: 'username is required for add-project-user operation' },
      { subcommand: 'add-project-user', args: { projectId: 1, username: 'alice' }, message: 'Share right is required for add-project-user operation' },
      { subcommand: 'update-project-user-permission', args: {}, message: 'Project ID is required for update-project-user-permission operation' },
      { subcommand: 'update-project-user-permission', args: { projectId: 1 }, message: 'userId is required for update-project-user-permission operation' },
      { subcommand: 'update-project-user-permission', args: { projectId: 1, userId: 2 }, message: 'Share right is required for update-project-user-permission operation' },
      { subcommand: 'remove-project-user', args: {}, message: 'Project ID is required for remove-project-user operation' },
      { subcommand: 'remove-project-user', args: { projectId: 1 }, message: 'userId is required for remove-project-user operation' },
      { subcommand: 'list-project-teams', args: {}, message: 'Project ID is required for list-project-teams operation' },
      { subcommand: 'add-project-team', args: {}, message: 'Project ID is required for add-project-team operation' },
      { subcommand: 'add-project-team', args: { projectId: 1 }, message: 'teamId is required for add-project-team operation' },
      { subcommand: 'add-project-team', args: { projectId: 1, teamId: 2 }, message: 'Share right is required for add-project-team operation' },
      { subcommand: 'update-project-team-permission', args: {}, message: 'Project ID is required for update-project-team-permission operation' },
      { subcommand: 'update-project-team-permission', args: { projectId: 1 }, message: 'teamId is required for update-project-team-permission operation' },
      { subcommand: 'update-project-team-permission', args: { projectId: 1, teamId: 2 }, message: 'Share right is required for update-project-team-permission operation' },
      { subcommand: 'remove-project-team', args: {}, message: 'Project ID is required for remove-project-team operation' },
      { subcommand: 'remove-project-team', args: { projectId: 1 }, message: 'teamId is required for remove-project-team operation' },
      { subcommand: 'share-with-user', args: {}, message: 'Project ID is required for share-with-user operation' },
      { subcommand: 'share-with-user', args: { projectId: 1 }, message: 'username is required for share-with-user operation' },
      { subcommand: 'share-with-user', args: { projectId: 1, username: 'alice' }, message: 'Share right is required for share-with-user operation' },
      { subcommand: 'share-with-team', args: {}, message: 'Project ID is required for share-with-team operation' },
      { subcommand: 'share-with-team', args: { projectId: 1 }, message: 'teamName is required for share-with-team operation' },
      { subcommand: 'share-with-team', args: { projectId: 1, teamName: 'Eng' }, message: 'Share right is required for share-with-team operation' },
      { subcommand: 'list-members', args: {}, message: 'Project ID is required for list-members operation' },
    ];

    it.each(cases)('$subcommand -> "$message"', async ({ subcommand, args, message }) => {
      await expect(callTool(subcommand, args)).rejects.toThrow(message);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('happy paths reach the REST layer with the expected args', () => {
    it('list-project-users', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));
      const result = await callTool('list-project-users', { projectId: 1 });
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/users');
      expect(result.content[0].text).toContain('Found 0 user(s)');
    });

    it('search-project-users', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));
      await callTool('search-project-users', { projectId: 1, search: 'ali' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/projectusers?s=ali');
    });

    it('add-project-user', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ username: 'alice', permission: 0 }) }),
      );
      const result = await callTool('add-project-user', { projectId: 1, username: 'alice', right: 'read' });
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users');
      expect(JSON.parse(init.body as string)).toEqual({ username: 'alice', permission: 0 });
      expect(result.content[0].text).toContain('Granted "alice"');
    });

    it('update-project-user-permission', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ permission: 2 }) }));
      await callTool('update-project-user-permission', { projectId: 1, userId: 5, right: 'admin' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/users/5');
    });

    it('remove-project-user', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'ok' }) }));
      const result = await callTool('remove-project-user', { projectId: 1, userId: 5 });
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users/5');
      expect(init.method).toBe('DELETE');
      expect(result.content[0].text).toContain('Removed user 5');
    });

    it('list-project-teams', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));
      await callTool('list-project-teams', { projectId: 1 });
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/teams');
    });

    it('add-project-team', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ team_id: 3, permission: 1 }) }),
      );
      const result = await callTool('add-project-team', { projectId: 1, teamId: 3, right: 'write' });
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ team_id: 3, permission: 1 });
      expect(result.content[0].text).toContain('Granted team 3');
    });

    it('update-project-team-permission', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ permission: 0 }) }));
      await callTool('update-project-team-permission', { projectId: 1, teamId: 3, right: 'read' });
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/teams/3');
    });

    it('remove-project-team', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'ok' }) }));
      const result = await callTool('remove-project-team', { projectId: 1, teamId: 3 });
      expect(result.content[0].text).toContain('Removed team 3');
    });

    it('share-with-user (composite)', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 1, username: 'alice' }]) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ username: 'alice', permission: 1 }) }))
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 1, username: 'alice', permission: 1 }]) }),
        );

      const result = await callTool('share-with-user', { projectId: 1, username: 'alice', right: 'write' });
      expect(result.content[0].text).toContain('Shared project 1 with user "alice"');
    });

    it('share-with-team (composite)', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 7, name: 'Engineering' }]) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ team_id: 7, permission: 1 }) }))
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 7, name: 'Engineering', permission: 1 }]) }),
        );

      const result = await callTool('share-with-team', {
        projectId: 1,
        teamName: 'Engineering',
        right: 'write',
      });
      expect(result.content[0].text).toContain('Shared project 1 with team "Engineering"');
    });

    it('list-members (read composite)', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/projects/1/users')) return Promise.resolve(mockResponse({ text: '[]' }));
        if (url.endsWith('/projects/1/teams')) return Promise.resolve(mockResponse({ text: '[]' }));
        if (url.includes('/projects/1/shares')) return Promise.resolve(mockResponse({ text: '[]' }));
        if (url.endsWith('/projects/1')) return Promise.resolve(mockResponse({ text: JSON.stringify({ id: 1 }) }));
        throw new Error(`Unexpected fetch call to ${url}`);
      });

      const result = await callTool('list-members', { projectId: 1 });
      expect(result.content[0].text).toContain('Project 1 has 0 direct user(s), 0 direct team(s), and 0 link share(s)');
    });
  });
});
