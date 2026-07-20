/**
 * Tests for project link sharing (`create-share`, `list-shares`,
 * `get-share`, `delete-share`, `auth-share`), migrated off node-vikunja onto
 * `vikunjaRestRequest` (Wave D domain migration, tracking issue #28).
 *
 * Mocks the REST layer directly (fetch), not a node-vikunja client — see
 * docs/ENDPOINT-PLAYBOOK.md §6: mocks are built from the OpenAPI spec's
 * response shapes (models.LinkSharing: {permission, name, ...}, NOT
 * node-vikunja's stale {right, label, password_enabled, expires}), and every
 * write asserts the actual outgoing request body.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import {
  createProjectShare,
  listProjectShares,
  getProjectShare,
  deleteProjectShare,
  authProjectShare,
} from '../../../src/tools/projects/sharing';
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

describe('project link sharing (REST-migrated)', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  describe('create-share', () => {
    it('verifies the project exists, then PUTs {permission} to /projects/{id}/shares', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1, title: 'Proj' }) }))
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify({ id: 5, hash: 'abc123', permission: 0, created: '2026-01-01T00:00:00Z' }),
          }),
        );

      const result = await createProjectShare({ projectId: 1, right: 'read' }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [getCall, putCall] = mockFetch.mock.calls as [string, RequestInit][][];
      expect(getCall[0]).toBe('https://vikunja.test/api/v1/projects/1');
      expect(putCall[0]).toBe('https://vikunja.test/api/v1/projects/1/shares');
      expect(putCall[1]?.method).toBe('PUT');
      // Payload must match models.LinkSharing: {permission, name?, password?}
      // — not node-vikunja's stale {right, label, password_enabled, expires}.
      expect(JSON.parse(putCall[1]?.body as string)).toEqual({ permission: 0 });

      expect(result.content[0].text).toContain('Share created successfully for project ID 1');
    });

    it('maps right aliases to numeric permission and includes name/password when supplied', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 5, permission: 2 }) }));

      await createProjectShare(
        { projectId: 1, right: 'admin', name: 'Admin Share', password: 'secret123' },
        authManager,
      );

      const putCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(JSON.parse(putCall[1].body as string)).toEqual({
        permission: 2,
        name: 'Admin Share',
        password: 'secret123',
      });
    });

    it('validates permission level', async () => {
      await expect(createProjectShare({ projectId: 1, right: 3 as never }, authManager)).rejects.toThrow(
        'Invalid permission level. Use: 0=Read, 1=Write, 2=Admin',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('requires a project id', async () => {
      await expect(
        createProjectShare({ projectId: 0, right: 'read' }, authManager),
      ).rejects.toThrow('project id must be a positive integer');
    });

    it('surfaces a friendly NOT_FOUND when the project does not exist', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'not found' }),
      );

      await expect(createProjectShare({ projectId: 999, right: 'read' }, authManager)).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('propagates a non-404 REST failure from the create call', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'boom' }));

      await expect(createProjectShare({ projectId: 1, right: 'read' }, authManager)).rejects.toThrow(MCPError);
    });

    it('rejects (does not remap) `title` reused as the share label when `name` is absent', async () => {
      await expect(
        createProjectShare(
          { projectId: 1, right: 'read', title: 'my-renamed-project-client-view' },
          authManager,
        ),
      ).rejects.toThrow(/share label goes in 'name'.*my-renamed-project-client-view/);

      // Must fail fast, before any network call (including the
      // project-exists check).
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('truncates a long `title` in the name/title mix-up error message', async () => {
      const longTitle = 'x'.repeat(80);
      await expect(
        createProjectShare({ projectId: 1, right: 'read', title: longTitle }, authManager),
      ).rejects.toThrow(/x{40}\.\.\./);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not reject when neither `name` nor `title` is supplied (unnamed share is legitimate)', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 5, permission: 0 }) }));

      await expect(createProjectShare({ projectId: 1, right: 'read' }, authManager)).resolves.toBeDefined();
    });

    it('does not reject when `name` is supplied alongside `title` (title simply ignored)', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 5, permission: 0 }) }));

      await expect(
        createProjectShare(
          { projectId: 1, right: 'read', name: 'Client view', title: 'Unrelated project title' },
          authManager,
        ),
      ).resolves.toBeDefined();

      const putCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(JSON.parse(putCall[1].body as string)).toEqual({ permission: 0, name: 'Client view' });
    });
  });

  describe('list-shares', () => {
    it('verifies the project exists, then lists shares', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify([
              { id: 1, hash: 'abc', permission: 0 },
              { id: 2, hash: 'def', permission: 1 },
            ]),
          }),
        );

      const result = await listProjectShares({ projectId: 1 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const urls = mockFetch.mock.calls.map((c) => c[0]);
      expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/1/shares');
      expect(result.content[0].text).toContain('Retrieved 2 shares for project 1');
    });

    it('includes page/per_page query params only when non-default', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await listProjectShares({ projectId: 1, page: 2, perPage: 10 }, authManager);

      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/shares?page=2&per_page=10');
    });

    it('exposes the spec\'s `s` (search-by-hash) query param (LOW issue, docs/API-COVERAGE.md)', async () => {
      // Reproduces the gap: GET /projects/{project}/shares documents page,
      // per_page AND s, but this tool used to only ever send page/per_page.
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await listProjectShares({ projectId: 1, search: 'abc123' }, authManager);

      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/shares?s=abc123');
    });

    it('combines search with page/per_page in the outgoing query string', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: '[]' }));

      const result = await listProjectShares(
        { projectId: 1, page: 2, perPage: 10, search: 'abc123' },
        authManager,
      );

      const url = mockFetch.mock.calls[1][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/shares?page=2&per_page=10&s=abc123');
      expect(result.content[0].text).toContain('Retrieved 0 shares for project 1');
    });

    it('treats a non-array response as an empty list', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1 }) }))
        .mockResolvedValueOnce(mockResponse({ text: '' }));

      const result = await listProjectShares({ projectId: 1 }, authManager);
      expect(result.content[0].text).toContain('Retrieved 0 shares');
    });

    it('surfaces a friendly NOT_FOUND when the project does not exist', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: '' }),
      );

      await expect(listProjectShares({ projectId: 999 }, authManager)).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });
  });

  describe('get-share', () => {
    it('fetches a share by id via the LIST route (by-id GET is broken upstream, see sharing.ts)', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify([
            { id: 1, hash: 'abc123', permission: 2, name: 'Admin share' },
            { id: 2, hash: 'def456', permission: 0, name: 'Other share' },
          ]),
        }),
      );

      const result = await getProjectShare({ projectId: 1, shareId: '1' }, authManager);

      // Regression test: must hit the LIST url, not the old by-id url —
      // fails against the pre-fix code, which called
      // `/projects/1/shares/1` and would 404 against this mock.
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://vikunja.test/api/v1/projects/1/shares');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain('Retrieved link share: Admin share');
    });

    it('succeeds even when the by-id route would 404 (proves the workaround: it is never called)', async () => {
      // No mock is registered for the by-id URL at all — only the LIST
      // route responds. If `getProjectShare` ever called the by-id route
      // again, `mockFetch` would fall through with `undefined` and the test
      // would throw, not pass.
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc123', permission: 2, name: 'Admin share' }]) }),
      );

      const result = await getProjectShare({ projectId: 1, shareId: '1' }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/shares');
      expect(result.content[0].text).toContain('Retrieved link share: Admin share');
    });

    it('falls back to a generic label when the share has no name', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc' }]) }));

      const result = await getProjectShare({ projectId: 1, shareId: '1' }, authManager);
      expect(result.content[0].text).toContain('Retrieved link share: Share #1');
    });

    it('requires a non-empty share id', async () => {
      await expect(getProjectShare({ projectId: 1, shareId: '' }, authManager)).rejects.toThrow(
        'Share ID must be a non-empty string',
      );
    });

    it('requires a project id', async () => {
      await expect(getProjectShare({ projectId: 0, shareId: '1' }, authManager)).rejects.toThrow(
        'Project ID is required',
      );
    });

    it('surfaces a friendly NOT_FOUND when the id is absent from a (200 OK) list response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc123', permission: 0 }]) }),
      );

      await expect(getProjectShare({ projectId: 1, shareId: '999' }, authManager)).rejects.toThrow(
        'Share with ID 999 not found for project 1',
      );
    });

    it('surfaces a friendly NOT_FOUND when the list route itself 404s (e.g. missing project)', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: '' }),
      );

      await expect(getProjectShare({ projectId: 1, shareId: '999' }, authManager)).rejects.toThrow(
        'Share with ID 999 not found for project 1',
      );
    });
  });

  describe('delete-share', () => {
    it('looks up the share via the LIST route (by-id GET is broken upstream, see sharing.ts), then deletes it', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc', name: 'Test Share' }]) }),
        )
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'deleted' }) }));

      const result = await deleteProjectShare({ projectId: 1, shareId: '1' }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [getCall, deleteCall] = mockFetch.mock.calls as [string, RequestInit][][];
      // Regression test: must hit the LIST url, not the old by-id url —
      // fails against the pre-fix code, which called
      // `/projects/1/shares/1` and would 404 against this mock.
      expect(getCall[0]).toBe('https://vikunja.test/api/v1/projects/1/shares');
      // The actual DELETE call is unaffected by the upstream bug and is
      // left exactly as-is: still the by-id URL.
      expect(deleteCall[0]).toBe('https://vikunja.test/api/v1/projects/1/shares/1');
      expect(deleteCall[1]?.method).toBe('DELETE');
      expect(result.content[0].text).toContain('Share with ID 1 deleted successfully');
    });

    it('succeeds even when the by-id GET route would 404 (proves the workaround: it is never called)', async () => {
      // No mock is registered for the by-id GET URL at all — only the LIST
      // route and the DELETE call respond.
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc', name: 'Test Share' }]) }),
        )
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'deleted' }) }));

      const result = await deleteProjectShare({ projectId: 1, shareId: '1' }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe('https://vikunja.test/api/v1/projects/1/shares');
      expect(result.content[0].text).toContain('Share with ID 1 deleted successfully');
    });

    it('requires a project id and a non-empty share id', async () => {
      await expect(deleteProjectShare({ projectId: 0, shareId: '1' }, authManager)).rejects.toThrow(
        'Project ID is required',
      );
      await expect(deleteProjectShare({ projectId: 1, shareId: '' }, authManager)).rejects.toThrow(
        'Share ID must be a non-empty string',
      );
    });

    it('surfaces a friendly NOT_FOUND when the id is absent from a (200 OK) list response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 1, hash: 'abc', name: 'Other share' }]) }),
      );

      await expect(deleteProjectShare({ projectId: 1, shareId: '999' }, authManager)).rejects.toThrow(
        'Share with ID 999 not found for project 1',
      );
    });

    it('surfaces a friendly NOT_FOUND when the list route itself 404s (e.g. missing project)', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: '' }),
      );

      await expect(deleteProjectShare({ projectId: 1, shareId: '999' }, authManager)).rejects.toThrow(
        'Share with ID 999 not found for project 1',
      );
    });
  });

  describe('auth-share', () => {
    it('POSTs {password} to /shares/{hash}/auth and returns the token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ token: 'jwt-token-here' }) }));

      const result = await authProjectShare({ shareHash: 'abc123' }, authManager);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/shares/abc123/auth');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ password: '' });
      expect(result.content[0].text).toContain('Successfully authenticated to share');
    });

    it('sends the supplied password', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ token: 'jwt' }) }));

      await authProjectShare({ shareHash: 'abc123', password: 'secret' }, authManager);

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ password: 'secret' });
    });

    it('requires a non-empty share hash', async () => {
      await expect(authProjectShare({ shareHash: '' }, authManager)).rejects.toThrow(
        'Share hash must be a non-empty string',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('maps a 401 to an invalid-password error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: '' }),
      );

      await expect(
        authProjectShare({ shareHash: 'abc123', password: 'wrong' }, authManager),
      ).rejects.toThrow('Invalid password for share');
    });

    it('maps a 404 to a not-found error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: '' }),
      );

      await expect(authProjectShare({ shareHash: 'invalid' }, authManager)).rejects.toThrow(
        'Share with hash invalid not found',
      );
    });

    it('propagates other REST failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('kaboom'));

      await expect(authProjectShare({ shareHash: 'abc123' }, authManager)).rejects.toThrow(
        'Vikunja REST request failed (POST /shares/abc123/auth): kaboom',
      );
    });
  });
});
