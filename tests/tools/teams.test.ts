import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerTeamsTool } from '../../src/tools/teams';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

interface Team {
  id?: number;
  name?: string;
  description?: string;
  created?: string;
  updated?: string;
}

/** Minimal Response-like object for the vikunjaRestRequest helper. */
function mockFetchResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  text?: string;
}): Response {
  const { ok = true, status = 200, statusText = 'OK' } = opts;
  const text = opts.text !== undefined ? opts.text : JSON.stringify(opts.body ?? {});
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('Teams Tool', () => {
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;

  // Helper function to call a tool
  async function callTool(subcommand?: string, args: Record<string, any> = {}) {
    return toolHandler({
      subcommand,
      ...args,
    });
  }

  // Mock data
  const mockTeam: Team = {
    id: 1,
    name: 'Test Team',
    description: 'Test team description',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats between tests so a
    // deliberately failing scenario doesn't trip the breaker for a later
    // test sharing the same auto-derived breaker name.
    circuitBreakerRegistry.clear();
    (global.fetch as jest.Mock | undefined)?.mockReset?.();

    // Setup mock auth manager
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn().mockReturnValue({
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'test-token',
      }),
      setSession: jest.fn(),
      clearSession: jest.fn(),
      connect: jest.fn(),
      getStatus: jest.fn(),
      isConnected: jest.fn(),
      disconnect: jest.fn(),
    } as MockAuthManager;

    // Setup mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    // Register the tool
    registerTeamsTool(mockServer, mockAuthManager);

    // Get the tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_teams',
      expect.any(String),
      expect.any(Object),
      expect.any(Object), // ToolAnnotations
      expect.any(Function),
    );
    const calls = mockServer.tool.mock.calls;
    if (calls.length > 0 && calls[0] && calls[0].length > 3) {
      toolHandler = calls[0][calls[0].length - 1];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('Authentication', () => {
    it('should require authentication for all operations', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(callTool('list')).rejects.toThrow(
        'Authentication required. Please use vikunja_auth.connect first.',
      );
    });
  });

  describe('list subcommand', () => {
    it('should list all teams', async () => {
      const mockTeams = [mockTeam, { ...mockTeam, id: 2, name: 'Team 2' }];
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: mockTeams })) as any;

      const result = await callTool('list');

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** list-teams");
      expect(markdown).toContain('Retrieved 2 teams');
    });

    it('should support pagination parameters', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: [mockTeam] })) as any;

      await callTool('list', { page: 2, perPage: 10 });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/teams?page=2&per_page=10',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should support search parameter', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: [mockTeam] })) as any;

      await callTool('list', { search: 'test' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/teams?s=test',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should handle API errors', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      ) as any;

      await expect(callTool('list')).rejects.toThrow('HTTP 500');
    });
  });

  describe('create subcommand', () => {
    it('should create a team', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: mockTeam })) as any;

      const result = await callTool('create', {
        name: 'Test Team',
        description: 'Test team description',
      });

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Test Team', description: 'Test team description' }),
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** create-team");
      expect(markdown).toContain('Team "Test Team" created successfully');
    });

    it('should require team name', async () => {
      await expect(callTool('create')).rejects.toThrow('Team name is required');
    });

    it('should handle API errors', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'Creation failed' }),
      ) as any;

      await expect(callTool('create', { name: 'New Team' })).rejects.toThrow('HTTP 500');
    });
  });

  describe('get subcommand', () => {
    it('should require team ID', async () => {
      await expect(callTool('get')).rejects.toThrow('Team ID is required');
    });

    it('should validate team ID', async () => {
      await expect(callTool('get', { id: -1 })).rejects.toThrow('id must be a positive integer');
      await expect(callTool('get', { id: 0 })).rejects.toThrow('id must be a positive integer');
      await expect(callTool('get', { id: 1.5 })).rejects.toThrow('id must be a positive integer');
      await expect(callTool('get', { id: 'invalid' })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should get a team by ID', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: mockTeam })) as any;

      const result = await callTool('get', { id: 1 });

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** get-team");
      expect(markdown).toContain('Retrieved team "Test Team"');
    });

    it('should handle API errors when getting team', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Team not found' }),
      ) as any;

      await expect(callTool('get', { id: 999 })).rejects.toThrow(
        'Vikunja REST request failed (GET /teams/999): HTTP 404 Not Found — Team not found',
      );
    });
  });

  describe('update subcommand', () => {
    it('should require team ID', async () => {
      await expect(callTool('update')).rejects.toThrow('Team ID is required');
    });

    it('should validate team ID', async () => {
      await expect(callTool('update', { id: -1, name: 'New Name' })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should require at least one field to update', async () => {
      await expect(callTool('update', { id: 1 })).rejects.toThrow(
        'At least one field to update is required',
      );
    });

    it('should update a team name using POST (the API only routes team updates through POST)', async () => {
      const updatedTeam = { ...mockTeam, name: 'Updated Team Name' };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: updatedTeam })) as any;

      const result = await callTool('update', { id: 1, name: 'Updated Team Name' });

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Updated Team Name' }),
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** update-team");
      expect(markdown).toContain('Team "Updated Team Name" updated successfully');
    });

    it('should update team description', async () => {
      const updatedTeam = { ...mockTeam, description: 'New description' };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: updatedTeam })) as any;

      const result = await callTool('update', { id: 1, description: 'New description' });

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: 'New description' }),
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** update-team");
    });

    it('should update both name and description', async () => {
      const updatedTeam = { ...mockTeam, name: 'Updated', description: 'Updated desc' };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: updatedTeam })) as any;

      await callTool('update', { id: 1, name: 'Updated', description: 'Updated desc' });

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Updated', description: 'Updated desc' }),
      });
    });

    it('should handle API errors when updating team', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Team not found' }),
      ) as any;

      await expect(callTool('update', { id: 999, name: 'New Name' })).rejects.toThrow(
        'Vikunja REST request failed (POST /teams/999): HTTP 404 Not Found — Team not found',
      );
    });
  });

  describe('delete subcommand', () => {
    it('should require team ID', async () => {
      await expect(callTool('delete')).rejects.toThrow('Team ID is required');
    });

    it('should validate team ID', async () => {
      await expect(callTool('delete', { id: -1 })).rejects.toThrow('id must be a positive integer');
    });

    it('should delete a team successfully', async () => {
      const mockResponse = { message: 'The team was successfully deleted.' };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: mockResponse })) as any;

      const result = await callTool('delete', { id: 1 });

      expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1', {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** delete-team");
      expect(markdown).toContain('Team deleted successfully');
    });

    it('should handle string ID', async () => {
      const mockResponse = { message: 'The team was successfully deleted.' };
      global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: mockResponse })) as any;

      const result = await callTool('delete', { id: '5' });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/teams/5',
        expect.objectContaining({ method: 'DELETE' }),
      );
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** delete-team");
    });

    it('should handle team not found error', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Team not found' }),
      ) as any;

      await expect(callTool('delete', { id: 999 })).rejects.toThrow('HTTP 404');
    });
  });

  describe('members subcommand', () => {
    const mockMembers = [
      { id: 1, username: 'user1', admin: true, email: 'user1@example.com', created: '2025-01-01T00:00:00Z' },
      { id: 2, username: 'user2', admin: false, email: 'user2@example.com', created: '2025-01-01T00:00:00Z' },
    ];

    it('should require team ID', async () => {
      await expect(callTool('members')).rejects.toThrow('Team ID is required');
    });

    it('should validate team ID', async () => {
      await expect(callTool('members', { id: 'invalid' })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    describe('members list subcommand', () => {
      // Vikunja has no GET /teams/{id}/members endpoint - members are
      // embedded in the team resource itself.
      it('should list team members by default by fetching the team', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ body: { ...mockTeam, members: mockMembers } }),
        ) as any;

        const result = await callTool('members', { id: 1 });

        expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        });

        const markdown = result.content[0].text;
        expect(markdown).toContain("## ✅ Success");
        expect(markdown).toContain("**Operation:** list-team-members");
        expect(markdown).toContain('Retrieved 2 members');
      });

      it('should list team members explicitly', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ body: { ...mockTeam, members: mockMembers } }),
        ) as any;

        const result = await callTool('members', { id: 1, memberSubcommand: 'list' });

        const markdown = result.content[0].text;
        expect(markdown).toContain('Retrieved 2 members');
      });

      it('should handle a team with no members', async () => {
        global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: mockTeam })) as any;

        const result = await callTool('members', { id: 1, memberSubcommand: 'list' });

        const markdown = result.content[0].text;
        expect(markdown).toContain('Retrieved 0 members');
      });

      it('should handle a single member', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ body: { ...mockTeam, members: [mockMembers[0]] } }),
        ) as any;

        const result = await callTool('members', { id: 1, memberSubcommand: 'list' });

        const markdown = result.content[0].text;
        expect(markdown).toContain('Retrieved 1 member');
      });

      it('should handle API errors when listing members', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Team not found' }),
        ) as any;

        await expect(callTool('members', { id: 999, memberSubcommand: 'list' })).rejects.toThrow(
          'Vikunja REST request failed (GET /teams/999): HTTP 404 Not Found — Team not found',
        );
      });
    });

    describe('members add subcommand', () => {
      it('should require username', async () => {
        await expect(callTool('members', { id: 1, memberSubcommand: 'add' })).rejects.toThrow(
          'Username is required',
        );
      });

      it('should add a member to team by username', async () => {
        const newMember = { id: 3, username: 'newuser', admin: false, created: '2025-01-01T00:00:00Z' };
        global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: newMember })) as any;

        const result = await callTool('members', { id: 1, memberSubcommand: 'add', username: 'newuser' });

        expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1/members', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username: 'newuser' }),
        });

        const markdown = result.content[0].text;
        expect(markdown).toContain("## ✅ Success");
        expect(markdown).toContain("**Operation:** add-team-member");
        expect(markdown).toContain('User "newuser" added to team successfully');
      });

      it('should add a member as admin', async () => {
        const newMember = { id: 3, username: 'newuser', admin: true, created: '2025-01-01T00:00:00Z' };
        global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: newMember })) as any;

        const result = await callTool('members', {
          id: 1,
          memberSubcommand: 'add',
          username: 'newuser',
          admin: true,
        });

        expect(global.fetch).toHaveBeenCalledWith('https://vikunja.example.com/api/v1/teams/1/members', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username: 'newuser', admin: true }),
        });

        const markdown = result.content[0].text;
        expect(markdown).toContain('User "newuser" added to team successfully');
      });

      it('should handle API errors when adding member', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'User not found' }),
        ) as any;

        await expect(
          callTool('members', { id: 1, memberSubcommand: 'add', username: 'ghost' }),
        ).rejects.toThrow(
          'Vikunja REST request failed (PUT /teams/1/members): HTTP 404 Not Found — User not found',
        );
      });
    });

    describe('members remove subcommand', () => {
      it('should require username', async () => {
        await expect(callTool('members', { id: 1, memberSubcommand: 'remove' })).rejects.toThrow(
          'Username is required',
        );
      });

      it('should remove a member from team by username', async () => {
        const deleteResult = { message: 'The team member was successfully deleted.' };
        global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: deleteResult })) as any;

        const result = await callTool('members', { id: 1, memberSubcommand: 'remove', username: 'user2' });

        expect(global.fetch).toHaveBeenCalledWith(
          'https://vikunja.example.com/api/v1/teams/1/members/user2',
          {
            method: 'DELETE',
            headers: {
              Authorization: 'Bearer test-token',
              'Content-Type': 'application/json',
            },
          },
        );

        const markdown = result.content[0].text;
        expect(markdown).toContain("## ✅ Success");
        expect(markdown).toContain("**Operation:** remove-team-member");
        expect(markdown).toContain('User "user2" removed from team successfully');
      });

      it('should handle API errors when removing member', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Member not found' }),
        ) as any;

        await expect(
          callTool('members', { id: 1, memberSubcommand: 'remove', username: 'ghost' }),
        ).rejects.toThrow(
          'Vikunja REST request failed (DELETE /teams/1/members/ghost): HTTP 404 Not Found — Member not found',
        );
      });
    });

    describe('members toggleAdmin subcommand', () => {
      it('should require username', async () => {
        await expect(callTool('members', { id: 1, memberSubcommand: 'toggleAdmin' })).rejects.toThrow(
          'Username is required',
        );
      });

      it('should toggle a member admin status via the dedicated /admin endpoint with no body', async () => {
        const toggledMember = { id: 2, username: 'user2', admin: true, created: '2025-01-01T00:00:00Z' };
        global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: toggledMember })) as any;

        const result = await callTool('members', {
          id: 1,
          memberSubcommand: 'toggleAdmin',
          username: 'user2',
        });

        expect(global.fetch).toHaveBeenCalledWith(
          'https://vikunja.example.com/api/v1/teams/1/members/user2/admin',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-token',
              'Content-Type': 'application/json',
            },
          },
        );

        const markdown = result.content[0].text;
        expect(markdown).toContain("## ✅ Success");
        expect(markdown).toContain("**Operation:** toggle-team-member-admin");
        expect(markdown).toContain('Admin status toggled for user "user2"');
      });

      it('should ignore a supplied admin flag (the endpoint always toggles)', async () => {
        const toggledMember = { id: 1, username: 'user1', admin: false, created: '2025-01-01T00:00:00Z' };
        global.fetch = jest.fn().mockResolvedValue(mockFetchResponse({ body: toggledMember })) as any;

        await callTool('members', {
          id: 1,
          memberSubcommand: 'toggleAdmin',
          username: 'user1',
          admin: true,
        });

        // No body is ever sent for the toggle-admin endpoint, regardless of
        // whether the caller passed an `admin` value.
        const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
        expect(init.body).toBeUndefined();
      });

      it('should handle API errors when toggling admin status', async () => {
        global.fetch = jest.fn().mockResolvedValue(
          mockFetchResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Member not found' }),
        ) as any;

        await expect(
          callTool('members', { id: 1, memberSubcommand: 'toggleAdmin', username: 'ghost' }),
        ).rejects.toThrow(
          'Vikunja REST request failed (POST /teams/1/members/ghost/admin): HTTP 404 Not Found — Member not found',
        );
      });
    });

    describe('members invalid subcommand', () => {
      it('should reject invalid member subcommands', async () => {
        await expect(
          callTool('members', { id: 1, memberSubcommand: 'invalid' }),
        ).rejects.toThrow('Invalid member subcommand: invalid');
      });
    });
  });

  describe('invalid subcommand', () => {
    it('should reject invalid subcommands', async () => {
      await expect(callTool('invalid')).rejects.toThrow('Invalid subcommand: invalid');
    });
  });

  describe('error handling', () => {
    it('should pass through MCPError instances', async () => {
      // vikunjaRestRequest always throws MCPError, so a fetch-level failure
      // ends up here as an MCPError already — wrapToolError returns it
      // unchanged (see src/utils/error-handler.ts's `wrap()`).
      global.fetch = jest.fn().mockRejectedValue(new MCPError(ErrorCode.API_ERROR, 'Custom error')) as any;

      await expect(callTool('list')).rejects.toThrow('Custom error');
    });

    it('should handle non-MCPError objects in catch block', async () => {
      // A raw Error thrown by fetch is wrapped by vikunjaRestRequestRaw into
      // an MCPError carrying the original message.
      global.fetch = jest.fn().mockRejectedValue(new Error('Unexpected error')) as any;

      await expect(callTool('list')).rejects.toThrow('Unexpected error');
    });

    it('should handle non-Error thrown values in main handler', async () => {
      // A non-Error rejection is stringified by vikunjaRestRequestRaw rather
      // than becoming "Unknown error" (that fallback lives in wrapToolError,
      // which never sees this — the REST layer already wrapped it as an
      // MCPError by the time it gets there).
      global.fetch = jest.fn().mockRejectedValue('String error thrown') as any;

      await expect(callTool('list')).rejects.toThrow('String error thrown');
    });
  });

  describe('default subcommand', () => {
    it('should throw validation error when no subcommand provided', async () => {
      // subcommand is a required field (see src/tools/teams.ts) - the MCP SDK's
      // Zod validation rejects calls with a missing subcommand before the handler
      // ever runs. This test exercises the handler's own defensive default case
      // for the same scenario (e.g. if invoked directly bypassing SDK validation).
      await expect(callTool()).rejects.toThrow('Invalid subcommand: undefined');
    });
  });

  describe('tool registration', () => {
    it('should register the vikunja_teams tool', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_teams',
        'Manage teams and team memberships for collaborative project management',
        expect.any(Object), // Zod schema
        expect.any(Object), // ToolAnnotations
        expect.any(Function), // Handler function
      );
    });

    it('should have the correct tool handler', () => {
      expect(toolHandler).toBeDefined();
      expect(typeof toolHandler).toBe('function');
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects create/delete and the members:add/remove composite keys when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'create', name: 'x' }))).toBe(true);
      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'delete', id: 1 }))).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'members', id: 1, memberSubcommand: 'add', username: 'bob' }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'members', id: 1, memberSubcommand: 'remove', username: 'bob' }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for list/get and members:list when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'list' }))).toBe(false);
      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'get', id: 1 }))).toBe(false);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'members', id: 1, memberSubcommand: 'list' }),
        ),
      ).toBe(false);
    });

    it('does not raise the read-only error for create when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'create', name: 'x' })),
      ).toBe(false);
    });
  });
});
