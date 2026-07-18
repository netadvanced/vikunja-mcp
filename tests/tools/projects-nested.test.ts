/**
 * Tests for nested/hierarchy project features (get-children, get-tree,
 * get-breadcrumb, move, depth validation), migrated off node-vikunja onto
 * `vikunjaRestRequest` (Wave D domain migration, tracking issue #28).
 *
 * Mocks the REST layer directly (fetch), not a node-vikunja client — see
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

/** Routes fetch calls by `METHOD pathname` (query string / api-version prefix ignored). */
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

describe('Projects Tool - Nested Project Features', () => {
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;

  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    return toolHandler({ subcommand, ...args });
  }

  const mockProjects = [
    {
      id: 1,
      title: 'Root Project',
      description: 'Root level project',
      parent_project_id: undefined,
      is_archived: false,
      hex_color: '#4287f5',
    },
    {
      id: 2,
      title: 'Child Project 1',
      description: 'First child',
      parent_project_id: 1,
      is_archived: false,
      hex_color: '#ff0000',
    },
    {
      id: 3,
      title: 'Child Project 2',
      description: 'Second child',
      parent_project_id: 1,
      is_archived: false,
      hex_color: '#00ff00',
    },
    {
      id: 4,
      title: 'Grandchild Project',
      description: 'Nested deeper',
      parent_project_id: 2,
      is_archived: false,
      hex_color: '#0000ff',
    },
    {
      id: 5,
      title: 'Orphan Project',
      description: 'No parent',
      parent_project_id: undefined,
      is_archived: false,
      hex_color: '#ffff00',
    },
  ];

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
    } as unknown as MockAuthManager;

    mockServer = {
      // The handler is always the last argument (server.tool now optionally
      // takes a ToolAnnotations object between the schema and the handler).
      tool: jest.fn((...args: unknown[]) => {
        toolHandler = args[args.length - 1];
      }) as jest.MockedFunction<any>,
    } as MockServer;

    registerProjectsTool(mockServer, mockAuthManager as unknown as AuthManager);

    if (typeof toolHandler !== 'function') {
      throw new Error('toolHandler was not set properly by registerProjectsTool in projects-nested test');
    }
  });

  describe('get-children', () => {
    it('should return direct children of a project', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ body: mockProjects[0] }),
        'GET /projects': mockResponse({ body: mockProjects }),
      });

      const result = await callTool('get-children', { id: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-children');
      expect(markdown).toContain('Found 2 child projects for project ID 1');
    });

    it('should return empty array for projects with no children', async () => {
      routeFetch({
        'GET /projects/4': mockResponse({ body: mockProjects[3] }),
        'GET /projects': mockResponse({ body: mockProjects }),
      });

      const result = await callTool('get-children', { id: 4 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-children');
      expect(markdown).toContain('Found 0 child projects for project ID 4');
    });

    it('should require project ID', async () => {
      await expect(callTool('get-children')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      await expect(callTool('get-children', { id: -1 })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should handle API errors', async () => {
      routeFetch({
        'GET /projects/1': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'API Error' }),
      });

      await expect(callTool('get-children', { id: 1 })).rejects.toThrow('HTTP 500');
    });
  });

  describe('get-tree', () => {
    it('should return complete project tree', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-tree');
      expect(markdown).toContain('Retrieved project tree with 4 nodes at depth 2');
    });

    it('should handle leaf nodes correctly', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      const result = await callTool('get-tree', { id: 4 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-tree');
      expect(markdown).toContain('Retrieved project tree with 1 nodes at depth 0');
    });

    it('should handle circular references', async () => {
      const circularProjects = [
        { id: 1, title: 'A', parent_project_id: 2 },
        { id: 2, title: 'B', parent_project_id: 1 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: circularProjects }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      // Should still work but prevent infinite loops
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-tree');
    });

    it('should throw error for non-existent project', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      await expect(callTool('get-tree', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should require project ID', async () => {
      await expect(callTool('get-tree')).rejects.toThrow('Project ID is required');
    });
  });

  describe('get-breadcrumb', () => {
    it('should return path from root to project', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      const result = await callTool('get-breadcrumb', { id: 4 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-breadcrumb');
      expect(markdown).toContain('Retrieved breadcrumb path with 3 items');
    });

    it('should handle root level projects', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      const result = await callTool('get-breadcrumb', { id: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-breadcrumb');
      expect(markdown).toContain('Root Project');
    });

    it('should detect circular references', async () => {
      const circularProjects = [
        { id: 1, title: 'A', parent_project_id: 3 },
        { id: 2, title: 'B', parent_project_id: 1 },
        { id: 3, title: 'C', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: circularProjects }) });

      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow(
        'Circular reference detected in project hierarchy',
      );
    });

    it('should throw error for non-existent project', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      await expect(callTool('get-breadcrumb', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should require project ID', async () => {
      await expect(callTool('get-breadcrumb')).rejects.toThrow('Project ID is required');
    });
  });

  describe('move', () => {
    it('should move project to new parent', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: mockProjects }),
        'POST /projects/5': mockResponse({ body: { ...mockProjects[4], parent_project_id: 1 } }),
      });

      const result = await callTool('move', { id: 5, parentProjectId: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** move_project');
      expect(markdown).toContain('Moved project "Orphan Project" to parent project 1');
      // Regression test for the move data-wipe bug: POST /projects/{id} is a
      // full-model-replace endpoint, so the payload must carry every field
      // of the current project (merged via buildProjectUpdatePayload), not
      // just a bare { parent_project_id } that would wipe title/description/
      // hex_color/etc. on the server.
      expect(bodyOf('POST', '/projects/5')).toEqual({
        ...mockProjects[4],
        parent_project_id: 1,
      });
    });

    it('should move project to root level', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: mockProjects }),
        'POST /projects/2': mockResponse({ body: { ...mockProjects[1], parent_project_id: undefined } }),
      });

      const result = await callTool('move', { id: 2, parentProjectId: undefined });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** move_project');
      expect(markdown).toContain('Moved project "Child Project 1" to root level');
      // A root move must still merge through the current project — only
      // parent_project_id is explicitly cleared (0), everything else
      // (title/description/hex_color/etc.) is preserved.
      expect(bodyOf('POST', '/projects/2')).toEqual({
        ...mockProjects[1],
        parent_project_id: 0,
      });
    });

    it('should prevent moving project to itself', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      await expect(callTool('move', { id: 1, parentProjectId: 1 })).rejects.toThrow(
        'Cannot move a project to be its own parent',
      );
    });

    it('should prevent circular references', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      // Try to move parent to its own child
      await expect(callTool('move', { id: 1, parentProjectId: 2 })).rejects.toThrow(
        'Move would create a circular reference in project hierarchy',
      );
    });

    it('should prevent excessive depth', async () => {
      // Create two separate deep hierarchies
      const deepProjects = [];

      // First hierarchy: 1->2->3->4->5->6 (6 levels total, depth 5)
      for (let i = 1; i <= 6; i++) {
        deepProjects.push({
          id: i,
          title: `Chain1-${i}`,
          parent_project_id: i > 1 ? i - 1 : undefined,
        });
      }

      // Second hierarchy: 11->12->13->14->15->16->17 (7 levels total, depth 6)
      for (let i = 11; i <= 17; i++) {
        deepProjects.push({
          id: i,
          title: `Chain2-${i}`,
          parent_project_id: i > 11 ? i - 1 : undefined,
        });
      }

      routeFetch({ 'GET /projects': mockResponse({ body: deepProjects }) });

      // Try to move the first chain (6 nodes, depth 5) under the bottom of second chain (at depth 6)
      // This would create total depth of 6 + 1 + 5 = 12, exceeding max of 10
      await expect(callTool('move', { id: 1, parentProjectId: 17 })).rejects.toThrow(
        /maximum depth of 10 levels/,
      );
    });

    it('should throw error for non-existent project', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      await expect(callTool('move', { id: 999, parentProjectId: 1 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should throw error for non-existent parent', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });

      await expect(callTool('move', { id: 1, parentProjectId: 999 })).rejects.toThrow(
        'Parent project with ID 999 not found',
      );
    });

    it('should require project ID', async () => {
      await expect(callTool('move')).rejects.toThrow('Project ID is required');
    });

    it('should validate parent project ID', async () => {
      routeFetch({ 'GET /projects': mockResponse({ body: mockProjects }) });
      await expect(callTool('move', { id: 1, parentProjectId: -1 })).rejects.toThrow(
        'parentProjectId must be a positive integer',
      );
    });
  });

  describe('create with depth validation', () => {
    it('should allow creating project within depth limit', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: mockProjects }),
        'PUT /projects': mockResponse({ body: { id: 6, title: 'New Project', parent_project_id: 4 } }),
      });

      const result = await callTool('create', { title: 'New Project', parentProjectId: 4 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** create_project');
    });

    it('should prevent creating project beyond depth limit', async () => {
      // Create a hierarchy at max depth
      const deepProjects = [];
      for (let i = 1; i <= 10; i++) {
        deepProjects.push({
          id: i,
          title: `Level ${i}`,
          parent_project_id: i > 1 ? i - 1 : undefined,
        });
      }
      routeFetch({ 'GET /projects': mockResponse({ body: deepProjects }) });

      await expect(callTool('create', { title: 'Too Deep', parentProjectId: 10 })).rejects.toThrow(
        /Maximum allowed depth is 10 levels/,
      );
    });
  });

  describe('update with depth validation', () => {
    it('should allow updating parent within depth limit', async () => {
      routeFetch({
        'GET /projects/5': mockResponse({ body: mockProjects[4] }),
        'GET /projects': mockResponse({ body: mockProjects }),
        'POST /projects/5': mockResponse({ body: { ...mockProjects[4], parent_project_id: 3 } }),
      });

      const result = await callTool('update', { id: 5, parentProjectId: 3 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** update_project');
    });

    it('should prevent updating to parent beyond depth limit', async () => {
      // Create a hierarchy at max depth
      const deepProjects = [];
      for (let i = 1; i <= 10; i++) {
        deepProjects.push({
          id: i,
          title: `Level ${i}`,
          parent_project_id: i > 1 ? i - 1 : undefined,
        });
      }
      // Add an 11th project that exists but will exceed depth when moved
      deepProjects.push({
        id: 11,
        title: 'Will Exceed Depth',
        parent_project_id: undefined,
      });
      routeFetch({
        // getProject (singular) is looked up separately by updateProject to fetch the
        // current project before validating the new parent's depth - it must also know
        // about project 11, or the update fails with a 404 before depth validation runs.
        'GET /projects/11': mockResponse({ body: deepProjects.find((p) => p.id === 11) }),
        'GET /projects': mockResponse({ body: deepProjects }),
      });

      await expect(callTool('update', { id: 11, parentProjectId: 10 })).rejects.toThrow(
        /Maximum allowed depth is 10 levels/,
      );
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle circular references in calculateProjectDepth', async () => {
      // Create a circular reference: 1 -> 2 -> 3 -> 1
      const circularProjects = [
        { id: 1, title: 'A', parent_project_id: 3 },
        { id: 2, title: 'B', parent_project_id: 1 },
        { id: 3, title: 'C', parent_project_id: 2 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: circularProjects }) });

      // This should throw when trying to create with parent that has circular ref
      await expect(callTool('create', { title: 'New', parentProjectId: 1 })).rejects.toThrow(
        'Circular reference detected in project hierarchy',
      );
    });

    it('should handle missing projects in hierarchy', async () => {
      // Project with parent that doesn't exist
      const brokenHierarchy = [{ id: 1, title: 'Orphan', parent_project_id: 999 }];
      routeFetch({
        'GET /projects': mockResponse({ body: brokenHierarchy }),
        'PUT /projects': mockResponse({ body: { id: 2, title: 'New', parent_project_id: 1 } }),
      });

      // Should still work - depth calculation stops at missing parent
      const result = await callTool('create', { title: 'New', parentProjectId: 1 });
      expect(result).toBeDefined();
    });

    it('should handle empty children array in getMaxSubtreeDepth', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: [{ id: 1, title: 'Leaf Node', parent_project_id: undefined }] }),
        'POST /projects/1': mockResponse({ body: { id: 1, title: 'Leaf Node', parent_project_id: undefined } }),
      });

      // Move should work fine with leaf node
      const result = await callTool('move', { id: 1, parentProjectId: undefined });
      expect(result).toBeDefined();
    });

    it('should handle projects without IDs in tree building', async () => {
      const projectsWithMissingIds = [
        { id: 1, title: 'Parent', parent_project_id: undefined },
        { title: 'No ID', parent_project_id: 1 }, // Missing ID - will be filtered out
        { id: 3, title: 'Child', parent_project_id: 1 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projectsWithMissingIds }) });

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      // Only children with valid IDs will be included
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-tree');
    });

    it('should prevent moving ancestor to its descendant', async () => {
      // Create a simple hierarchy: 1 -> 2 -> 3
      const hierarchyProjects = [
        { id: 1, title: 'Parent', parent_project_id: undefined },
        { id: 2, title: 'Child', parent_project_id: 1 },
        { id: 3, title: 'Grandchild', parent_project_id: 2 },
      ];
      routeFetch({
        'GET /projects': mockResponse({ body: hierarchyProjects }),
        'POST /projects/1': mockResponse({ body: { id: 1, title: 'Parent', parent_project_id: 3 } }),
      });

      // Should prevent moving parent (1) under its grandchild (3)
      await expect(callTool('move', { id: 1, parentProjectId: 3 })).rejects.toThrow(
        'Move would create a circular reference in project hierarchy',
      );

      // Should prevent moving parent (1) under its child (2)
      await expect(callTool('move', { id: 1, parentProjectId: 2 })).rejects.toThrow(
        'Move would create a circular reference in project hierarchy',
      );
    });

    it('should handle move operation with complex subtree depth calculation', async () => {
      // Create a project with deep subtree that would exceed max depth if moved
      const projectWithDeepSubtree = [
        { id: 1, title: 'Root', parent_project_id: undefined },
        { id: 2, title: 'Branch', parent_project_id: undefined },
        // Create subtree under project 2 first (4 levels deep from root)
        { id: 3, title: 'B1', parent_project_id: 2 },
        { id: 4, title: 'B2', parent_project_id: 3 },
        { id: 5, title: 'B3', parent_project_id: 4 },
        { id: 12, title: 'B4', parent_project_id: 5 },
        // Deep subtree under project 1 (7 levels)
        { id: 6, title: 'L1', parent_project_id: 1 },
        { id: 7, title: 'L2', parent_project_id: 6 },
        { id: 8, title: 'L3', parent_project_id: 7 },
        { id: 9, title: 'L4', parent_project_id: 8 },
        { id: 10, title: 'L5', parent_project_id: 9 },
        { id: 11, title: 'L6', parent_project_id: 10 },
        { id: 13, title: 'L7', parent_project_id: 11 },
      ];
      routeFetch({ 'GET /projects': mockResponse({ body: projectWithDeepSubtree }) });

      // Moving project 1 (with 7-level subtree) under project 12 (which is at depth 4) should fail
      // because total depth would be 4 (parent depth) + 1 (project 1) + 7 (subtree) = 12, which exceeds 10
      await expect(callTool('move', { id: 1, parentProjectId: 12 })).rejects.toThrow(
        /maximum depth of 10 levels/,
      );
    });

    it('should handle circular reference in getMaxSubtreeDepth', async () => {
      // Create projects with a diamond pattern that will trigger visited set
      // A -> B -> D
      // A -> C -> D  (D is reached from both B and C)
      const diamondProjects = [
        { id: 1, title: 'A', parent_project_id: undefined },
        { id: 2, title: 'B', parent_project_id: 1 },
        { id: 3, title: 'C', parent_project_id: 1 },
        { id: 4, title: 'D1', parent_project_id: 2 },
        { id: 4, title: 'D2', parent_project_id: 3 }, // Same ID, different parent - simulates data issue
        { id: 5, title: 'E', parent_project_id: 4 },
        { id: 6, title: 'F', parent_project_id: 5 },
      ];

      routeFetch({
        'GET /projects': mockResponse({ body: diamondProjects }),
        'POST /projects/1': mockResponse({ body: { id: 1, title: 'A', parent_project_id: undefined } }),
      });

      // The move should still work because getMaxSubtreeDepth handles duplicate IDs
      const result = await callTool('move', { id: 1, parentProjectId: undefined });
      expect(result).toBeDefined();
    });

    it('should handle projects without id in getMaxSubtreeDepth', async () => {
      const projectsWithMissingId = [
        { id: 1, title: 'Parent', parent_project_id: undefined },
        { id: 2, title: 'Child', parent_project_id: 1 },
        { title: 'No ID Child', parent_project_id: 2 }, // Missing ID
        { id: 4, title: 'Grandchild', parent_project_id: 2 },
      ];

      routeFetch({
        'GET /projects': mockResponse({ body: projectsWithMissingId }),
        'POST /projects/1': mockResponse({ body: { id: 1, title: 'Parent', parent_project_id: undefined } }),
      });

      // Should handle missing ID gracefully
      const result = await callTool('move', { id: 1, parentProjectId: undefined });
      expect(result).toBeDefined();
    });

    it('should throw API_ERROR when get-tree fails with non-MCP error', async () => {
      routeFetch({
        'GET /projects': mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'Network error' }),
      });

      await expect(callTool('get-tree', { id: 1 })).rejects.toThrow('HTTP 500');
    });

    it('should throw API_ERROR when get-breadcrumb fails with non-MCP error', async () => {
      routeFetch({
        'GET /projects': mockResponse({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          text: 'Database connection failed',
        }),
      });

      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow('HTTP 500');
    });

    it('should throw API_ERROR when move fails with non-MCP error', async () => {
      routeFetch({
        'GET /projects': mockResponse({ body: mockProjects }),
        'POST /projects/5': mockResponse({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          text: 'Server rejected the update',
        }),
      });

      await expect(callTool('move', { id: 5, parentProjectId: 1 })).rejects.toThrow('HTTP 500');
    });

    it('should handle empty breadcrumb array and break correctly', async () => {
      // Return empty projects list
      routeFetch({ 'GET /projects': mockResponse({ body: [] }) });

      await expect(callTool('get-breadcrumb', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle project at root level for breadcrumb', async () => {
      // Project with no parent (root level)
      const rootProject = [{ id: 1, title: 'Root', parent_project_id: undefined }];
      routeFetch({ 'GET /projects': mockResponse({ body: rootProject }) });

      const result = await callTool('get-breadcrumb', { id: 1 });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);

      // Breadcrumb should contain only the root project itself
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** get-project-breadcrumb');
      expect(markdown).toContain('Root');
    });
  });
});
