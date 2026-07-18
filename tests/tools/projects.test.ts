/**
 * Tests for project CRUD + hierarchy operations (list/get/create/update/
 * delete/archive/unarchive, get-children/get-tree/get-breadcrumb/move),
 * migrated off node-vikunja onto `vikunjaRestRequest` (Wave D domain
 * migration, tracking issue #28).
 *
 * Mocks the REST layer directly (fetch), not a node-vikunja client — see
 * docs/ENDPOINT-PLAYBOOK.md §6. A small route table keyed by
 * "METHOD pathname" (query strings ignored) stands in for the real API;
 * every write test also asserts the outgoing request body.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerProjectsTool } from '../../src/tools/projects';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object for the vikunjaRestRequest helper. */
function mockResponse(opts: {
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

/**
 * Routes `fetch` calls by `METHOD pathname` (the query string is ignored —
 * `/projects` is hit both by `list` with pagination params and by the
 * `per_page=1000` "fetch all projects" helper used for hierarchy/depth
 * validation, but no single test exercises both, so this is unambiguous in
 * practice). A route may be a single Response (reused for every call to that
 * key) or an array (consumed in order, the last entry repeating once
 * exhausted).
 */
function routeFetch(routes: Record<string, Response | Response[]>): void {
  const counters: Record<string, number> = {};
  mockFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    const pathname = u.pathname.replace(/^\/api\/v\d+/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${pathname}`;
    const entry = routes[key];
    if (!entry) {
      throw new Error(`Unmocked fetch call in test: ${key}`);
    }
    if (Array.isArray(entry)) {
      const idx = counters[key] ?? 0;
      counters[key] = idx + 1;
      return entry[Math.min(idx, entry.length - 1)];
    }
    return entry;
  });
}

/** Finds the body sent on the (n-th, 1-indexed) call matching method+pathname. */
function bodyOf(method: string, pathname: string, occurrence = 1): unknown {
  const calls = mockFetch.mock.calls as [string, RequestInit][];
  const matches = calls.filter(([url, init]) => {
    const u = new URL(String(url));
    const p = u.pathname.replace(/^\/api\/v\d+/, '');
    return (init?.method ?? 'GET').toUpperCase() === method && p === pathname;
  });
  const call = matches[occurrence - 1];
  if (!call?.[1]?.body) return undefined;
  return JSON.parse(call[1].body as string);
}

describe('Projects Tool', () => {
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
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    registerProjectsTool(mockServer, mockAuthManager as unknown as AuthManager);

    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_projects',
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

      const subcommands = [
        'list',
        'get',
        'create',
        'update',
        'delete',
        'archive',
        'unarchive',
        'get-children',
        'get-tree',
        'get-breadcrumb',
        'move',
      ];

      for (const subcommand of subcommands) {
        await expect(callTool(subcommand, { id: 1, title: 'x' })).rejects.toThrow(
          /Authentication required/,
        );
      }
    });
  });

  describe('list subcommand', () => {
    it('should list all projects', async () => {
      const mockProjects = [mockProject, { ...mockProject, id: 2, title: 'Project 2' }];
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      const result = await callTool('list');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.example.com/api/v1/projects?page=1&per_page=50');
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Retrieved 2 projects');
      expect(markdown).toMatch(/list[_\\]+projects/);
    });

    it('should support pagination parameters', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [mockProject] }) });

      await callTool('list', { page: 2, perPage: 10 });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.example.com/api/v1/projects?page=2&per_page=10');
    });

    it('should handle singular project in message', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [mockProject] }) });

      const result = await callTool('list');
      const markdown = result.content[0].text;
      expect(markdown).toContain('Retrieved 1 project');
    });

    it('should support search parameter', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [mockProject] }) });

      await callTool('list', { search: 'test' });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.example.com/api/v1/projects?page=1&per_page=50&s=test');
    });

    it('should support archived filter', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [] }) });

      await callTool('list', { isArchived: true });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(
        'https://vikunja.example.com/api/v1/projects?page=1&per_page=50&is_archived=true',
      );
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('list')).rejects.toThrow('HTTP 500');
    });
  });

  describe('get subcommand', () => {
    it('should get a project by ID', async () => {
      routeFetch({ 'GET /projects/1': mockResponse({ body: mockProject }) });

      const result = await callTool('get', { id: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/projects/1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Retrieved project: Test Project');
      expect(markdown).toMatch(/get[_\\]+project/);
    });

    it('should require project ID', async () => {
      await expect(callTool('get')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID is positive integer', async () => {
      await expect(callTool('get', { id: -1 })).rejects.toThrow('id must be a positive integer');
      await expect(callTool('get', { id: 0 })).rejects.toThrow('id must be a positive integer');
      await expect(callTool('get', { id: 1.5 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle 404 errors', async () => {
      routeFetch({
        'GET /projects/999': mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      });

      await expect(callTool('get', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle other API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('get', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('create subcommand', () => {
    it('should create a project', async () => {
      routeFetch({ 'PUT /projects': mockResponse({ body: mockProject }) });

      const result = await callTool('create', {
        title: 'Test Project',
        description: 'Test Description',
        hexColor: '#4287f5',
      });

      expect(bodyOf('PUT', '/projects')).toEqual({
        title: 'Test Project',
        description: 'Test Description',
        hex_color: '#4287f5',
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Project "Test Project" created successfully');
      expect(markdown).toMatch(/create[_\\]+project/);
    });

    it('should require project title', async () => {
      await expect(callTool('create')).rejects.toThrow('Project title is required');
    });

    it('should support parent project ID', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: [mockProject] }),
        'PUT /projects': mockResponse({ body: mockProject }),
      });

      await callTool('create', {
        title: 'Child Project',
        parentProjectId: 1,
      });

      expect(bodyOf('PUT', '/projects')).toEqual({
        title: 'Child Project',
        parent_project_id: 1,
      });
    });

    it('should default isArchived to false', async () => {
      routeFetch({ 'PUT /projects': mockResponse({ body: mockProject }) });

      await callTool('create', { title: 'New Project' });

      expect(bodyOf('PUT', '/projects')).toEqual({ title: 'New Project' });
    });

    it('should handle API errors', async () => {
      routeFetch({
        'PUT /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('create', { title: 'New Project' })).rejects.toThrow('HTTP 500');
    });

    it('should support all optional fields', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: [mockProject] }),
        'PUT /projects': mockResponse({ body: mockProject }),
      });

      await callTool('create', {
        title: 'Full Project',
        description: 'Full description',
        parentProjectId: 1,
        isArchived: false,
        hexColor: '#FF0000',
      });

      expect(bodyOf('PUT', '/projects')).toEqual({
        title: 'Full Project',
        description: 'Full description',
        parent_project_id: 1,
        is_archived: false,
        hex_color: '#ff0000', // Normalized to lowercase
      });
    });

    describe('hex color validation', () => {
      it('should accept valid hex colors and normalize to lowercase', async () => {
        routeFetch({ 'PUT /projects': mockResponse({ body: mockProject }) });

        const validColors = [
          { input: '#4287f5', expected: '#4287f5' },
          { input: '#FF0000', expected: '#ff0000' },
          { input: '#00ff00', expected: '#00ff00' },
          { input: '#123456', expected: '#123456' },
          { input: '#abcdef', expected: '#abcdef' },
          { input: '#ABCDEF', expected: '#abcdef' },
        ];

        for (const { input, expected } of validColors) {
          await callTool('create', { title: 'Project', hexColor: input });
          expect(bodyOf('PUT', '/projects', mockFetch.mock.calls.length)).toEqual({
            title: 'Project',
            hex_color: expected,
          });
        }
      });

      it('should reject invalid hex colors', async () => {
        const invalidColors = [
          { color: '#fff', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#12345', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#GGGGGG', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '4287f5', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#1234567', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: 'red', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#12345g', error: 'Invalid hex color format. Expected format: #RRGGBB' },
        ];

        for (const { color, error } of invalidColors) {
          await expect(callTool('create', { title: 'Project', hexColor: color })).rejects.toThrow(
            error,
          );
        }
      });
    });
  });

  describe('update subcommand', () => {
    it('should update a project', async () => {
      const updatedProject = { ...mockProject, title: 'Updated Title' };
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'POST /projects/1': mockResponse({ body: updatedProject }),
      });

      const result = await callTool('update', {
        id: 1,
        title: 'Updated Title',
      });

      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...mockProject,
        title: 'Updated Title',
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Project "Updated Title" updated successfully');
      expect(markdown).toMatch(/update[_\\]+project/);
    });

    it('should preserve parent_project_id when parentProjectId is omitted (issue #45)', async () => {
      const childProject = {
        ...mockProject,
        id: 2,
        title: 'Child Project',
        parent_project_id: 1,
      };
      const updatedChild = { ...childProject, description: 'Updated description' };
      routeFetch({
        'GET /projects/2': mockResponse({ body: childProject }),
        'GET /projects': mockResponse({ body: [mockProject, childProject] }),
        'POST /projects/2': mockResponse({ body: updatedChild }),
      });

      await callTool('update', {
        id: 2,
        title: childProject.title,
        description: 'Updated description',
        // parentProjectId intentionally omitted
      });

      expect(bodyOf('POST', '/projects/2')).toEqual(
        expect.objectContaining({
          description: 'Updated description',
          parent_project_id: 1,
          title: 'Child Project',
        }),
      );
    });

    it('should update a root-level project without parentProjectId (real API returns parent_project_id: 0, not undefined)', async () => {
      // Vikunja's real API always returns a numeric parent_project_id (0 for
      // a root/top-level project), never omits the field — unlike this
      // suite's shared `mockProject` fixture, which uses `undefined` for
      // brevity. That fixture shape masked a real bug: buildProjectUpdatePayload
      // resolves the omitted parentProjectId to the current project's
      // parent_project_id (0 for root) for merge-preserve purposes, and
      // validateProjectData then tried to look 0 up as if it were a real
      // parent project id to validate, throwing "parentProjectId must be a
      // positive integer" — meaning updating ANY root-level project without
      // explicitly repeating parentProjectId always failed. Found via the
      // MCP-layer e2e harness (scripts/mcp-e2e.ts) against a real Vikunja
      // server, where every project starts out at the root.
      const rootProject: Project = { ...mockProject, id: 5, parent_project_id: 0 };
      routeFetch({
        'GET /projects/5': mockResponse({ body: rootProject }),
        'POST /projects/5': mockResponse({ body: { ...rootProject, description: 'updated description' } }),
      });

      await callTool('update', {
        id: 5,
        description: 'updated description',
        // parentProjectId intentionally omitted, like a normal partial update
      });

      expect(bodyOf('POST', '/projects/5')).toEqual(
        expect.objectContaining({
          description: 'updated description',
          parent_project_id: 0,
        }),
      );
    });

    it('should preserve existing title when title is omitted (issue #44)', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'POST /projects/1': mockResponse({ body: { ...mockProject, description: 'new description' } }),
      });

      // Title intentionally omitted — Vikunja rejects updates without a title
      await callTool('update', {
        id: 1,
        description: 'new description',
      });

      expect(bodyOf('POST', '/projects/1')).toEqual(
        expect.objectContaining({
          title: 'Test Project',
          description: 'new description',
        }),
      );
    });

    it('should still allow explicit parent reassignment on update', async () => {
      const childProject = {
        ...mockProject,
        id: 2,
        title: 'Child Project',
        parent_project_id: 1,
      };
      const newParent = { ...mockProject, id: 3, title: 'New Parent' };
      routeFetch({
        'GET /projects/2': mockResponse({ body: childProject }),
        'GET /projects': mockResponse({ body: [mockProject, childProject, newParent] }),
        'POST /projects/2': mockResponse({ body: { ...childProject, parent_project_id: 3 } }),
      });

      await callTool('update', {
        id: 2,
        parentProjectId: 3,
      });

      expect(bodyOf('POST', '/projects/2')).toEqual(
        expect.objectContaining({
          parent_project_id: 3,
        }),
      );
    });

    it('should require project ID', async () => {
      await expect(callTool('update', { title: 'New Title' })).rejects.toThrow(
        'Project ID is required',
      );
    });

    it('should validate project ID', async () => {
      await expect(callTool('update', { id: -1, title: 'New Title' })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should require at least one field to update', async () => {
      await expect(callTool('update', { id: 1 })).rejects.toThrow('No fields to update provided');
    });

    it('should support updating all fields', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'GET /projects': mockResponse({
          body: [mockProject, { id: 2, title: 'Parent', parent_project_id: undefined }],
        }),
        'POST /projects/1': mockResponse({ body: mockProject }),
      });

      await callTool('update', {
        id: 1,
        title: 'New Title',
        description: 'New Description',
        parentProjectId: 2,
        isArchived: true,
        hexColor: '#ff0000',
      });

      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...mockProject,
        title: 'New Title',
        description: 'New Description',
        parent_project_id: 2,
        is_archived: true,
        hex_color: '#ff0000', // Already lowercase
      });
    });

    it('should handle 404 errors', async () => {
      routeFetch({
        'GET /projects/999': mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      });

      await expect(callTool('update', { id: 999, title: 'New Title' })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('update', { id: 1, title: 'New Title' })).rejects.toThrow('HTTP 500');
    });

    describe('hex color validation', () => {
      it('should accept valid hex colors in update and normalize to lowercase', async () => {
        routeFetch({
          'GET /projects/1': mockResponse({ body: mockProject }),
          'POST /projects/1': mockResponse({ body: mockProject }),
        });

        const validColors = [
          { input: '#4287f5', expected: '#4287f5' },
          { input: '#FF0000', expected: '#ff0000' },
          { input: '#00ff00', expected: '#00ff00' },
          { input: '#123456', expected: '#123456' },
          { input: '#abcdef', expected: '#abcdef' },
          { input: '#ABCDEF', expected: '#abcdef' },
        ];

        for (const { input, expected } of validColors) {
          await callTool('update', { id: 1, hexColor: input });
          const calls = (mockFetch.mock.calls as [string, RequestInit][]).filter(
            ([url, init]) =>
              (init?.method ?? 'GET') === 'POST' &&
              new URL(url).pathname.replace(/^\/api\/v\d+/, '') === '/projects/1',
          );
          const lastBody = JSON.parse(calls[calls.length - 1][1].body as string);
          expect(lastBody).toEqual({
            ...mockProject,
            hex_color: expected,
          });
        }
      });

      it('should reject invalid hex colors in update', async () => {
        const invalidColors = [
          { color: '#fff', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#12345', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#GGGGGG', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '4287f5', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#1234567', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: 'red', error: 'Invalid hex color format. Expected format: #RRGGBB' },
          { color: '#12345g', error: 'Invalid hex color format. Expected format: #RRGGBB' },
        ];

        for (const { color, error } of invalidColors) {
          await expect(callTool('update', { id: 1, hexColor: color })).rejects.toThrow(error);
        }
      });
    });
  });

  describe('delete subcommand', () => {
    it('should delete a project', async () => {
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
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Deleted project: Test Project');
    });

    it('should require project ID', async () => {
      await expect(callTool('delete')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('delete', { id: -1 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle 404 errors', async () => {
      routeFetch({
        'GET /projects/999': mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      });

      await expect(callTool('delete', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('delete', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('archive subcommand', () => {
    it('should archive a project successfully', async () => {
      const archivedProject = { ...mockProject, is_archived: true };
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }), // Not archived yet
        'POST /projects/1': mockResponse({ body: archivedProject }),
      });

      const result = await callTool('archive', { id: 1 });

      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...mockProject,
        is_archived: true,
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Project "Test Project" archived successfully');
      expect(markdown).toMatch(/archive[_\\]+project/);
    });

    it('should return already archived message if project is already archived', async () => {
      const archivedProject = { ...mockProject, is_archived: true };
      routeFetch({ 'GET /projects/1': mockResponse({ body: archivedProject }) });

      const result = await callTool('archive', { id: 1 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Project "Test Project" is already archived');
      expect(markdown).toMatch(/archive[_\\]+project/);
    });

    it('should require project ID', async () => {
      await expect(callTool('archive')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('archive', { id: -1 })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should handle 404 errors', async () => {
      routeFetch({
        'GET /projects/999': mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      });

      await expect(callTool('archive', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('archive', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('unarchive subcommand', () => {
    it('should unarchive a project successfully', async () => {
      const archivedProject = { ...mockProject, is_archived: true };
      const unarchivedProject = { ...mockProject, is_archived: false };
      routeFetch({
        'GET /projects/1': mockResponse({ body: archivedProject }), // Currently archived
        'POST /projects/1': mockResponse({ body: unarchivedProject }),
      });

      const result = await callTool('unarchive', { id: 1 });

      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...archivedProject,
        is_archived: false,
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Project "Test Project" unarchived successfully');
      expect(markdown).toMatch(/unarchive[_\\]+project/);
    });

    it('should return already active message if project is not archived', async () => {
      routeFetch({ 'GET /projects/1': mockResponse({ body: mockProject }) }); // Not archived

      const result = await callTool('unarchive', { id: 1 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Project "Test Project" is already active (not archived)');
      expect(markdown).toMatch(/unarchive[_\\]+project/);
    });

    it('should require project ID', async () => {
      await expect(callTool('unarchive')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('unarchive', { id: -1 })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should handle 404 errors', async () => {
      routeFetch({
        'GET /projects/999': mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      });

      await expect(callTool('unarchive', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('unarchive', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('invalid subcommand', () => {
    it('should reject invalid subcommands', async () => {
      await expect(callTool('invalid')).rejects.toThrow('Unknown subcommand: invalid');
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      routeFetch({
        'GET /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'String error' }),
      });

      await expect(callTool('list')).rejects.toThrow('HTTP 500');
    });

    it('should handle non-MCPError objects in catch block', async () => {
      // Mock isAuthenticated to throw a non-MCPError
      mockAuthManager.isAuthenticated = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected auth error');
      });

      await expect(callTool('list')).rejects.toThrow('Unexpected error: Unexpected auth error');
    });

    it('should handle non-Error thrown values in main handler', async () => {
      // Mock isAuthenticated to throw a non-Error value
      mockAuthManager.isAuthenticated = jest.fn().mockImplementation(() => {
        throw 'String error thrown';
      });

      await expect(callTool('list')).rejects.toThrow('Unexpected error: Unknown error');
    });
  });

  describe('get-children subcommand', () => {
    it('should get child projects', async () => {
      const childProjects = [
        { ...mockProject, id: 2, title: 'Child 1', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Child 2', parent_project_id: 1 },
      ];
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'GET /projects': mockResponse({ body: [mockProject, ...childProjects] }),
      });

      const result = await callTool('get-children', { id: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('get-project-children');
      expect(markdown).toContain('Child 1');
      expect(markdown).toContain('Child 2');
    });

    it('should require project ID', async () => {
      await expect(callTool('get-children')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('get-children', { id: -1 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API error' }),
      });
      await expect(callTool('get-children', { id: 1 })).rejects.toThrow('HTTP 500');
    });

    it('should handle singular child project in message', async () => {
      const childProject = { ...mockProject, id: 2, title: 'Only Child', parent_project_id: 1 };
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProject }),
        'GET /projects': mockResponse({ body: [mockProject, childProject] }),
      });

      const result = await callTool('get-children', { id: 1 });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Found 1 child project for project ID 1');
    });
  });

  describe('get-tree subcommand', () => {
    it('should get project tree', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child 1', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Child 2', parent_project_id: 1 },
        { ...mockProject, id: 4, title: 'Grandchild', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('get-project-tree');
      expect(markdown).toContain('Root');
      expect(markdown).toContain('Retrieved project tree with 4 nodes at depth 2');
    });

    it('should handle circular references', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 2 },
        { ...mockProject, id: 2, title: 'Project 2', parent_project_id: 1 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('get-project-tree');
      expect(markdown).toContain('Project 1');
      expect(markdown).toContain('Project 2');
    });

    it('should require project ID', async () => {
      await expect(callTool('get-tree')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('get-tree', { id: 0 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle project not found', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [] }) });
      await expect(callTool('get-tree', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API error' }),
      });
      await expect(callTool('get-tree', { id: 1 })).rejects.toThrow('HTTP 500');
    });

    it('should handle projects without IDs', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: undefined, title: 'No ID', parent_project_id: 1 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Root');
    });

    it('should handle singular project in tree message', async () => {
      const projects = [{ ...mockProject, id: 1, title: 'Root', parent_project_id: undefined }];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Retrieved project tree with 1 nodes at depth 0');
    });

    it('should handle countProjects with null node', async () => {
      // Create a scenario where we have nested projects
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 1 },
        { ...mockProject, id: undefined, title: 'Child without ID', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      // The project without ID should be filtered out
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Root');
      expect(markdown).toContain('Child');
    });
  });

  describe('get-breadcrumb subcommand', () => {
    it('should get project breadcrumb', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Grandchild', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-breadcrumb', { id: 3 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('get-project-breadcrumb');
      expect(markdown).toContain('Retrieved breadcrumb path with 3 items');
      expect(markdown).toContain('"title": "Root"');
      expect(markdown).toContain('"title": "Child"');
      expect(markdown).toContain('"title": "Grandchild"');
    });

    it('should handle circular references', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 2 },
        { ...mockProject, id: 2, title: 'Project 2', parent_project_id: 1 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow('Circular reference detected');
    });

    it('should handle orphaned projects', async () => {
      const projects = [
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 999 }, // Parent doesn't exist
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      const result = await callTool('get-breadcrumb', { id: 2 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Child');
    });

    it('should require project ID', async () => {
      await expect(callTool('get-breadcrumb')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('get-breadcrumb', { id: -5 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle project not found', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [] }) });
      await expect(callTool('get-breadcrumb', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API error' }),
      });
      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('move subcommand', () => {
    it('should move project to new parent', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Parent', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Project to Move', parent_project_id: undefined },
      ];
      routeFetch({
        'GET /projects': mockResponse({ body: projects }),
        'POST /projects/2': mockResponse({ body: { ...projects[1], parent_project_id: 1 } }),
      });

      const result = await callTool('move', { id: 2, parentProjectId: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
      expect(markdown).toContain('Moved project "Project to Move" to parent project 1');
      // Regression test for the move data-wipe bug: POST /projects/{id} is a
      // full-model-replace endpoint, so the payload must carry every field
      // of the current project, not just a bare { parent_project_id } that
      // would wipe title/description/hex_color/etc. on the server.
      expect(bodyOf('POST', '/projects/2')).toEqual({
        ...projects[1],
        parent_project_id: 1,
      });
    });

    it('should move project to root', async () => {
      const projects = [{ ...mockProject, id: 1, title: 'Project', parent_project_id: 2 }];
      routeFetch({
        'GET /projects': mockResponse({ body: projects }),
        'POST /projects/1': mockResponse({ body: { ...projects[0], parent_project_id: undefined } }),
      });

      const result = await callTool('move', { id: 1, parentProjectId: undefined });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Moved project "Project" to root level');
      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...projects[0],
        parent_project_id: 0,
      });
    });

    it('should prevent self-parent', async () => {
      const projects = [{ ...mockProject, id: 1, title: 'Project', parent_project_id: undefined }];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      await expect(callTool('move', { id: 1, parentProjectId: 1 })).rejects.toThrow('Cannot move a project to be its own parent');
    });

    it('should prevent circular references', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Parent', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Grandchild', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      await expect(callTool('move', { id: 1, parentProjectId: 3 })).rejects.toThrow('Move would create a circular reference in project hierarchy');
    });

    it('should prevent exceeding max depth', async () => {
      // Create a deep hierarchy
      const projects = [];
      for (let i = 1; i <= 9; i++) {
        projects.push({
          ...mockProject,
          id: i,
          title: `Level ${i}`,
          parent_project_id: i > 1 ? i - 1 : undefined,
        });
      }
      // Add a project with deep children to move
      projects.push({
        ...mockProject,
        id: 10,
        title: 'Project with children',
        parent_project_id: undefined,
      });
      projects.push({
        ...mockProject,
        id: 11,
        title: 'Child of 10',
        parent_project_id: 10,
      });
      projects.push({
        ...mockProject,
        id: 12,
        title: 'Grandchild of 10',
        parent_project_id: 11,
      });

      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      await expect(callTool('move', { id: 10, parentProjectId: 9 })).rejects.toThrow('exceed the maximum depth');
    });

    it('should require project ID', async () => {
      await expect(callTool('move')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('move', { id: 0 })).rejects.toThrow('id must be a positive integer');
    });

    it('should validate parent project ID', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [mockProject] }) });
      await expect(callTool('move', { id: 1, parentProjectId: -1 })).rejects.toThrow('parentProjectId must be a positive integer');
    });

    it('should handle project not found', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: [] }) });
      await expect(callTool('move', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle parent project not found', async () => {
      const projects = [{ ...mockProject, id: 1, title: 'Project', parent_project_id: undefined }];
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });
      await expect(callTool('move', { id: 1, parentProjectId: 999 })).rejects.toThrow('Parent project with ID 999 not found');
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API error' }),
      });
      await expect(callTool('move', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('depth validation edge cases', () => {
    it('should detect circular reference in calculateProjectDepth', async () => {
      const circularProjects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 3 },
        { ...mockProject, id: 2, title: 'Project 2', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Project 3', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: circularProjects }) });

      await expect(callTool('create', { title: 'New Project', parentProjectId: 1 })).rejects.toThrow('Circular reference detected');
    });

    it('should handle edge case where project has multiple children with same ID', async () => {
      // Create a corrupted dataset where the same project ID appears multiple times
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        // Two projects with same ID but different parent_project_id
        { ...mockProject, id: 2, title: 'Child 1', parent_project_id: 1 },
        { ...mockProject, id: 2, title: 'Child 1 Duplicate', parent_project_id: 1 },
        // Project to move that has a complex subtree
        { ...mockProject, id: 5, title: 'Project to Move', parent_project_id: undefined },
        { ...mockProject, id: 6, title: 'Child of 5', parent_project_id: 5 },
        { ...mockProject, id: 7, title: 'Another Child of 5', parent_project_id: 5 },
        // Create a loop in the subtree of project 5
        { ...mockProject, id: 6, title: 'Child of 5 Again', parent_project_id: 7 },
      ];

      routeFetch({
        'GET /projects': mockResponse({ body: projects }),
        'POST /projects/5': mockResponse({
          body: { ...mockProject, id: 5, title: 'Project to Move', parent_project_id: 1 },
        }),
      });

      const result = await callTool('move', { id: 5, parentProjectId: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
    });

    it('should handle projects without IDs in getMaxSubtreeDepth', async () => {
      // Create projects where some don't have IDs
      const projects = [
        { ...mockProject, id: 1, title: 'Project with mixed children', parent_project_id: undefined },
        { ...mockProject, id: undefined, title: 'Child without ID', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Child with ID', parent_project_id: 1 },
        // Add a target parent
        { ...mockProject, id: 4, title: 'Target Parent', parent_project_id: undefined },
      ];

      routeFetch({
        'GET /projects': mockResponse({ body: projects }),
        'POST /projects/1': mockResponse({
          body: { ...mockProject, id: 1, title: 'Project with mixed children', parent_project_id: 4 },
        }),
      });

      const result = await callTool('move', { id: 1, parentProjectId: 4 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
    });

    it('should handle missing project in calculateProjectDepth', async () => {
      const projects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 999 }, // Parent doesn't exist
      ];
      routeFetch({
        'GET /projects': mockResponse({ body: projects }),
        'PUT /projects': mockResponse({
          body: { ...mockProject, id: 2, title: 'New Project', parent_project_id: 1 },
        }),
      });

      const result = await callTool('create', { title: 'New Project', parentProjectId: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('New Project');
    });

    it('should enforce max depth on create', async () => {
      // Create a hierarchy at max depth
      const projects = [];
      for (let i = 1; i <= 10; i++) {
        projects.push({
          ...mockProject,
          id: i,
          title: `Level ${i}`,
          parent_project_id: i > 1 ? i - 1 : undefined,
        });
      }
      routeFetch({ 'GET /projects': mockResponse({ body: projects }) });

      await expect(callTool('create', { title: 'Too Deep', parentProjectId: 10 })).rejects.toThrow('Maximum allowed depth is 10 levels');
    });

    it('should enforce max depth on update', async () => {
      // Create a hierarchy at max depth
      const projects = [];
      for (let i = 1; i <= 10; i++) {
        projects.push({
          ...mockProject,
          id: i,
          title: `Level ${i}`,
          parent_project_id: i > 1 ? i - 1 : undefined,
        });
      }
      // Add a project to move
      projects.push({
        ...mockProject,
        id: 11,
        title: 'Project to Update',
        parent_project_id: undefined,
      });
      routeFetch({
        'GET /projects/11': mockResponse({ body: projects[projects.length - 1] }),
        'GET /projects': mockResponse({ body: projects }),
      });

      await expect(callTool('update', { id: 11, parentProjectId: 10 })).rejects.toThrow('Maximum allowed depth is 10 levels');
    });

    it('should move a project under a sibling that is not its descendant', async () => {
      // Historical note: this case used to exercise a BFS isDescendant()
      // check implemented with an explicit queue and Array.prototype.shift().
      // That code path no longer exists (validateMoveConstraints now uses
      // recursive DFS — see getMaxSubtreeDepth), so this just verifies the
      // move itself succeeds and reports the new parent.
      const projects = [
        { ...mockProject, id: 1, parent_project_id: undefined },
        { ...mockProject, id: 2, parent_project_id: undefined },
        { ...mockProject, id: 3, parent_project_id: 1 },
        { ...mockProject, id: 4, parent_project_id: 1 },
      ];
      routeFetch({
        'GET /projects': mockResponse({ body: projects }),
        'POST /projects/1': mockResponse({ body: { ...projects[0], parent_project_id: 2 } }),
      });

      // Move project 1 to be under project 2 (not a descendant, so should succeed)
      const result = await callTool('move', { id: 1, parentProjectId: 2 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
      expect(bodyOf('POST', '/projects/1')).toEqual({
        ...projects[0],
        parent_project_id: 2,
      });
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects create/update/delete/duplicate/share-with-user when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'create', title: 'x' })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'update', id: 1 })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'delete', id: 1 })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'duplicate', id: 1 })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, {
            subcommand: 'share-with-user',
            projectId: 1,
            username: 'bob',
            right: 'read',
          }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for list/get/get-tree when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'list' }))).toBe(
        false,
      );
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'get', id: 1 })),
      ).toBe(false);
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'get-tree' })),
      ).toBe(false);
    });

    it('does not raise the read-only error for create when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'create', title: 'x' })),
      ).toBe(false);
    });
  });
});
