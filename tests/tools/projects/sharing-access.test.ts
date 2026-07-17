/**
 * Tests for direct project sharing with users & teams: primitives
 * (list/add/update-permission/remove for both users and teams) and the
 * composite subcommands (`share-with-user`, `share-with-team`,
 * `list-members`).
 *
 * All-new coverage (see docs/API-COVERAGE.md HIGH finding) — mocks are
 * built directly from the vendored OpenAPI spec's response shapes
 * (models.ProjectUser / models.TeamProject use `permission`, not
 * node-vikunja's stale `right`), and every write asserts the actual
 * outgoing request body per docs/ENDPOINT-PLAYBOOK.md §6.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import {
  listProjectUsers,
  searchProjectUsers,
  addProjectUser,
  updateProjectUserPermission,
  removeProjectUser,
  listProjectTeams,
  addProjectTeam,
  updateProjectTeamPermission,
  removeProjectTeam,
  shareProjectWithUser,
  shareProjectWithTeam,
  listProjectMembers,
} from '../../../src/tools/projects/sharing-access';
import { MCPError } from '../../../src/types';
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

describe('direct project sharing (users & teams)', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  // ---------------------------------------------------------------------
  // Primitives — users
  // ---------------------------------------------------------------------

  describe('list-project-users', () => {
    it('lists users with their permission', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify([
            { id: 1, username: 'alice', permission: 2 },
            { id: 2, username: 'bob', permission: 0 },
          ]),
        }),
      );

      const result = await listProjectUsers({ projectId: 1 }, authManager);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users');
      expect(result.content[0].text).toContain('Found 2 user(s) with direct access to project 1');
      expect(result.content[0].text).toContain('alice');
    });

    it('includes s/page/per_page query params when supplied', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await listProjectUsers({ projectId: 1, search: 'ali', page: 2, perPage: 10 }, authManager);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users?s=ali&page=2&per_page=10');
    });

    it('rejects an invalid project id', async () => {
      await expect(listProjectUsers({ projectId: 0 }, authManager)).rejects.toThrow(
        'projectId must be a positive integer',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces a friendly NOT_FOUND for a missing project', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: '' }));

      await expect(listProjectUsers({ projectId: 999 }, authManager)).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });
  });

  describe('search-project-users', () => {
    it('searches via /projects/{id}/projectusers', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 3, username: 'carol' }]) }),
      );

      const result = await searchProjectUsers({ projectId: 1, search: 'car' }, authManager);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/projectusers?s=car');
      expect(result.content[0].text).toContain('Found 1 user(s) matching "car" for project 1');
    });
  });

  describe('add-project-user', () => {
    it('PUTs {username, permission} to /projects/{id}/users', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 10, username: 'alice', permission: 1 }) }),
      );

      const result = await addProjectUser(
        { projectId: 1, username: 'alice', right: 'write' },
        authManager,
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ username: 'alice', permission: 1 });
      expect(result.content[0].text).toContain('Granted "alice" permission 1 on project 1');
    });

    it('requires a non-empty username', async () => {
      await expect(
        addProjectUser({ projectId: 1, username: '  ', right: 'read' }, authManager),
      ).rejects.toThrow('username is required');
    });

    it('validates permission before making any request', async () => {
      await expect(
        addProjectUser({ projectId: 1, username: 'alice', right: 'owner' as never }, authManager),
      ).rejects.toThrow('Share right must be one of: read, write, admin');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces a friendly not-found when the project or user does not exist', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: '' }));

      await expect(
        addProjectUser({ projectId: 1, username: 'ghost', right: 'read' }, authManager),
      ).rejects.toThrow('Project with ID 1 not found, or user "ghost" does not exist');
    });
  });

  describe('update-project-user-permission', () => {
    it('POSTs {permission} to /projects/{id}/users/{userId}', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 1, username: 'alice', permission: 2 }) }),
      );

      const result = await updateProjectUserPermission(
        { projectId: 1, userId: 10, right: 'admin' },
        authManager,
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users/10');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ permission: 2 });
      expect(result.content[0].text).toContain("Updated user 10's permission on project 1 to 2");
    });

    it('surfaces a friendly not-found', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: '' }));

      await expect(
        updateProjectUserPermission({ projectId: 1, userId: 999, right: 'read' }, authManager),
      ).rejects.toThrow('User 999 does not have access to project 1');
    });
  });

  describe('remove-project-user', () => {
    it('DELETEs /projects/{id}/users/{userId}', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'removed' }) }));

      const result = await removeProjectUser({ projectId: 1, userId: 10 }, authManager);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/users/10');
      expect(init.method).toBe('DELETE');
      expect(result.content[0].text).toContain("Removed user 10's access to project 1");
    });

    it('rejects an invalid userId', async () => {
      await expect(removeProjectUser({ projectId: 1, userId: 0 }, authManager)).rejects.toThrow(
        'userId must be a positive integer',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Primitives — teams
  // ---------------------------------------------------------------------

  describe('list-project-teams', () => {
    it('lists teams with their permission', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 1, name: 'Engineering', permission: 1 }]) }),
      );

      const result = await listProjectTeams({ projectId: 1 }, authManager);

      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/teams');
      expect(result.content[0].text).toContain('Found 1 team(s) with direct access to project 1');
    });
  });

  describe('add-project-team', () => {
    it('PUTs {team_id, permission} to /projects/{id}/teams', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 20, team_id: 3, permission: 1 }) }),
      );

      const result = await addProjectTeam({ projectId: 1, teamId: 3, right: 'write' }, authManager);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/teams');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ team_id: 3, permission: 1 });
      expect(result.content[0].text).toContain('Granted team 3 permission 1 on project 1');
    });

    it('surfaces a friendly not-found', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: '' }));

      await expect(
        addProjectTeam({ projectId: 1, teamId: 999, right: 'read' }, authManager),
      ).rejects.toThrow('Project with ID 1 not found, or team 999 does not exist');
    });
  });

  describe('update-project-team-permission', () => {
    it('POSTs {permission} to /projects/{id}/teams/{teamId}', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 1, team_id: 3, permission: 0 }) }),
      );

      await updateProjectTeamPermission({ projectId: 1, teamId: 3, right: 'read' }, authManager);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/teams/3');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ permission: 0 });
    });
  });

  describe('remove-project-team', () => {
    it('DELETEs /projects/{id}/teams/{teamId}', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'removed' }) }));

      const result = await removeProjectTeam({ projectId: 1, teamId: 3 }, authManager);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/teams/3');
      expect(init.method).toBe('DELETE');
      expect(result.content[0].text).toContain("Removed team 3's access to project 1");
    });
  });

  // ---------------------------------------------------------------------
  // Composite — share-with-user
  // ---------------------------------------------------------------------

  describe('share-with-user (composite)', () => {
    it('resolves username -> adds -> verifies, in that order', async () => {
      mockFetch
        // 1) resolve-user: GET /users?s=alice
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify([
              { id: 42, username: 'alice', name: 'Alice' },
              { id: 43, username: 'alice2', name: 'Alice Two' },
            ]),
          }),
        )
        // 2) add-user: PUT /projects/1/users
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ username: 'alice', permission: 1 }) }))
        // 3) verify-membership: GET /projects/1/users
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 42, username: 'alice', permission: 1 }]) }),
        );

      const result = await shareProjectWithUser(
        { projectId: 1, username: 'alice', right: 'write' },
        authManager,
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const calls = mockFetch.mock.calls as [string, RequestInit?][];
      expect(calls[0][0]).toBe('https://vikunja.test/api/v1/users?s=alice');
      expect(calls[1][0]).toBe('https://vikunja.test/api/v1/projects/1/users');
      expect(calls[1][1]?.method).toBe('PUT');
      // Exact-match resolution: username "alice" must not be confused with "alice2".
      expect(JSON.parse(calls[1][1]?.body as string)).toEqual({ username: 'alice', permission: 1 });
      expect(calls[2][0]).toBe('https://vikunja.test/api/v1/projects/1/users');
      expect(calls[2][1]?.method ?? 'GET').toBe('GET');

      expect(result.content[0].text).toContain('Shared project 1 with user "alice" (permission 1)');
    });

    it('matches the username case-insensitively', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 1, username: 'Alice' }]) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ username: 'Alice', permission: 0 }) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 1, username: 'Alice' }]) }));

      await expect(
        shareProjectWithUser({ projectId: 1, username: 'alice', right: 'read' }, authManager),
      ).resolves.toBeDefined();
    });

    it('throws NOT_FOUND when no exact username match exists, without ever calling add', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 1, username: 'alice-somebody-else' }]) }),
      );

      await expect(
        shareProjectWithUser({ projectId: 1, username: 'alice', right: 'read' }, authManager),
      ).rejects.toThrow('share-with-user failed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('best-effort (default): leaves the grant in place when verification fails, and reports it in guidance', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 42, username: 'alice' }]) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ username: 'alice', permission: 1 }) }))
        // verify-membership finds nobody -> triggers failure
        .mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await expect(
        shareProjectWithUser({ projectId: 1, username: 'alice', right: 'write' }, authManager),
      ).rejects.toThrow(MCPError);

      // best-effort: exactly 3 calls made (resolve, add, verify) — no DELETE compensation call.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls[2][1]?.method ?? 'GET').toBe('GET');
    });

    it('atomic:true removes the grant when verification fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 42, username: 'alice' }]) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ username: 'alice', permission: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: '[]' }))
        // compensation: DELETE /projects/1/users/42
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'removed' }) }));

      await expect(
        shareProjectWithUser({ projectId: 1, username: 'alice', right: 'write', atomic: true }, authManager),
      ).rejects.toThrow(MCPError);

      expect(mockFetch).toHaveBeenCalledTimes(4);
      const compensateCall = mockFetch.mock.calls[3] as [string, RequestInit];
      expect(compensateCall[0]).toBe('https://vikunja.test/api/v1/projects/1/users/42');
      expect(compensateCall[1].method).toBe('DELETE');
    });

    it('requires a non-empty username and a permission level', async () => {
      await expect(
        shareProjectWithUser({ projectId: 1, username: '', right: 'read' }, authManager),
      ).rejects.toThrow('username is required');

      await expect(
        shareProjectWithUser({ projectId: 1, username: 'alice', right: undefined as never }, authManager),
      ).rejects.toThrow('Share right is required');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Composite — share-with-team
  // ---------------------------------------------------------------------

  describe('share-with-team (composite)', () => {
    it('resolves team name -> adds by id -> verifies', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 7, name: 'Engineering' }]) }),
        )
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ team_id: 7, permission: 2 }) }))
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 7, name: 'Engineering', permission: 2 }]) }),
        );

      const result = await shareProjectWithTeam(
        { projectId: 1, teamName: 'Engineering', right: 'admin' },
        authManager,
      );

      const calls = mockFetch.mock.calls as [string, RequestInit?][];
      expect(calls[0][0]).toBe('https://vikunja.test/api/v1/teams?s=Engineering');
      expect(calls[1][0]).toBe('https://vikunja.test/api/v1/projects/1/teams');
      expect(JSON.parse(calls[1][1]?.body as string)).toEqual({ team_id: 7, permission: 2 });
      expect(calls[2][0]).toBe('https://vikunja.test/api/v1/projects/1/teams');

      expect(result.content[0].text).toContain('Shared project 1 with team "Engineering" (permission 2)');
    });

    it('throws NOT_FOUND when no exact team name match exists', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 1, name: 'Marketing' }]) }));

      await expect(
        shareProjectWithTeam({ projectId: 1, teamName: 'Engineering', right: 'read' }, authManager),
      ).rejects.toThrow('share-with-team failed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('atomic:true removes the grant when verification fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 7, name: 'Engineering' }]) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ team_id: 7, permission: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: '[]' }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'removed' }) }));

      await expect(
        shareProjectWithTeam(
          { projectId: 1, teamName: 'Engineering', right: 'write', atomic: true },
          authManager,
        ),
      ).rejects.toThrow(MCPError);

      const compensateCall = mockFetch.mock.calls[3] as [string, RequestInit];
      expect(compensateCall[0]).toBe('https://vikunja.test/api/v1/projects/1/teams/7');
      expect(compensateCall[1].method).toBe('DELETE');
    });

    it('requires a non-empty team name', async () => {
      await expect(
        shareProjectWithTeam({ projectId: 1, teamName: '  ', right: 'read' }, authManager),
      ).rejects.toThrow('teamName is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // Composite — list-members
  // ---------------------------------------------------------------------

  describe('list-members (composite read)', () => {
    it('combines direct users, direct teams, and link shares in one response', async () => {
      // Promise.allSettled fires the three reads concurrently, so call order
      // isn't guaranteed — route by URL instead of by call sequence.
      // listProjectShares() itself makes two calls: a plain project-existence
      // GET and the shares list GET, both containing "/projects/1" — match
      // the more specific patterns (endsWith) before the general one.
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/projects/1/users')) {
          return Promise.resolve(
            mockResponse({ text: JSON.stringify([{ id: 1, username: 'alice', permission: 2 }]) }),
          );
        }
        if (url.endsWith('/projects/1/teams')) {
          return Promise.resolve(
            mockResponse({ text: JSON.stringify([{ id: 7, name: 'Engineering', permission: 1 }]) }),
          );
        }
        if (url.includes('/projects/1/shares')) {
          return Promise.resolve(
            mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc', permission: 0 }]) }),
          );
        }
        if (url.endsWith('/projects/1')) {
          return Promise.resolve(mockResponse({ text: JSON.stringify({ id: 1 }) }));
        }
        throw new Error(`Unexpected fetch call to ${url}`);
      });

      const result = await listProjectMembers({ projectId: 1 }, authManager);

      expect(result.content[0].text).toContain(
        'Project 1 has 1 direct user(s), 1 direct team(s), and 1 link share(s)',
      );
    });

    it('propagates a project-not-found failure from the users list', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/projects/1/users')) {
          return Promise.resolve(mockResponse({ ok: false, status: 404, text: '' }));
        }
        return Promise.resolve(mockResponse({ text: '[]' }));
      });

      await expect(listProjectMembers({ projectId: 1 }, authManager)).rejects.toThrow(
        'Project with ID 1 not found',
      );
    });

    it('degrades gracefully when the link-share sub-call fails, still reporting users/teams', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/projects/1/users')) {
          return Promise.resolve(mockResponse({ text: JSON.stringify([{ id: 1, username: 'alice' }]) }));
        }
        if (url.endsWith('/projects/1/teams')) {
          return Promise.resolve(mockResponse({ text: '[]' }));
        }
        // Both the project-existence check and the shares list fail.
        return Promise.resolve(mockResponse({ ok: false, status: 500, text: 'boom' }));
      });

      const result = await listProjectMembers({ projectId: 1 }, authManager);
      expect(result.content[0].text).toContain('Project 1 has 1 direct user(s), 0 direct team(s)');
    });

    it('rejects an invalid project id', async () => {
      await expect(listProjectMembers({ projectId: -1 }, authManager)).rejects.toThrow(
        'projectId must be a positive integer',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
