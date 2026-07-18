/**
 * Regression tests for delete/archive/unarchive mock wiring, migrated off
 * node-vikunja onto `vikunjaRestRequest` (Wave D domain migration, tracking
 * issue #28). Mocks the REST layer directly (fetch) — see
 * docs/ENDPOINT-PLAYBOOK.md §6.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerProjectsTool } from '../../src/tools/projects';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockResponse(opts: { body?: unknown }): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: jest.fn(async () => JSON.stringify(opts.body ?? {})),
  } as unknown as Response;
}

function routeFetch(routes: Record<string, Response>): void {
  mockFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    const pathname = u.pathname.replace(/^\/api\/v\d+/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${pathname}`;
    const entry = routes[key];
    if (!entry) {
      throw new Error(`Unmocked fetch call in test: ${key}`);
    }
    return entry;
  });
}

function bodyOf(method: string, pathname: string): unknown {
  const calls = mockFetch.mock.calls as [string, RequestInit][];
  const call = calls.find(([url, init]) => {
    const u = new URL(String(url));
    const p = u.pathname.replace(/^\/api\/v\d+/, '');
    return (init?.method ?? 'GET').toUpperCase() === method && p === pathname;
  });
  if (!call?.[1]?.body) return undefined;
  return JSON.parse(call[1].body as string);
}

describe('Projects Tool Mock Fixes', () => {
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;

  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    if (typeof toolHandler !== 'function') {
      throw new Error('toolHandler is not a function in callTool');
    }
    return toolHandler({ subcommand, ...args });
  }

  const mockProject = {
    id: 1,
    title: 'Test Project',
    description: 'Test Description',
    is_archived: false,
    hex_color: '#4287f5',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    position: 1,
    identifier: 'TEST',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

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

    mockServer = {
      // The handler is always the last argument (server.tool now optionally
      // takes a ToolAnnotations object between the schema and the handler).
      tool: jest.fn((...args: unknown[]) => {
        toolHandler = args[args.length - 1];
      }),
    } as MockServer;

    try {
      registerProjectsTool(mockServer, mockAuthManager as unknown as AuthManager);

      if (typeof toolHandler !== 'function') {
        throw new Error('toolHandler was not set properly by registerProjectsTool');
      }
    } catch (error) {
      console.error('Error setting up projects tool test:', error);
      throw error;
    }
  });

  describe('delete subcommand mock fixes', () => {
    it('should delete a project with proper mock setup', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'DELETE /projects/1': mockResponse({ body: { message: 'Success' } }),
      });

      const result = await callTool('delete', { id: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/projects/1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/projects/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('delete_project');
      expect(markdown).toContain('Deleted project');
    });
  });

  describe('archive subcommand mock fixes', () => {
    it('should archive a project with proper mock setup', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'POST /projects/1': mockResponse({ body: { ...mockProject, is_archived: true } }),
      });

      const result = await callTool('archive', { id: 1 });

      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...mockProject,
        is_archived: true,
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('archive_project');
      expect(markdown).toContain('archived successfully');
    });
  });

  describe('unarchive subcommand mock fixes', () => {
    it('should unarchive a project with proper mock setup', async () => {
      const archivedProject = { ...mockProject, is_archived: true };
      routeFetch({
        'GET /projects/1': mockResponse({ body: archivedProject }),
        'POST /projects/1': mockResponse({ body: mockProject }),
      });

      const result = await callTool('unarchive', { id: 1 });

      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...archivedProject,
        is_archived: false,
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('unarchive_project');
      expect(markdown).toContain('unarchived successfully');
    });
  });
});
