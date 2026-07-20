/**
 * Export Tool Tests
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerExportTool } from '../../src/tools/export';
import { MCPError, ErrorCode } from '../../src/types/index';
import type { Project, Task, Label } from 'node-vikunja';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { getClientFromContext } from '../../src/client';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

// Mock the MCP server
const mockServer = {
  tool: jest.fn(),
} as unknown as MockServer;

// Mock auth manager
const mockAuthManager = {
  isAuthenticated: jest.fn().mockReturnValue(true),
  getAuthType: jest.fn().mockReturnValue('jwt'),
  getSession: jest.fn().mockReturnValue({
    apiUrl: 'https://vikunja.example.com',
    apiToken: 'test-token',
  }),
} as unknown as MockAuthManager;

// Mock the client module. `labels.getLabel` remains the only node-vikunja
// call site exportProjectRecursive still uses — getProject/getProjectTasks/
// getProjects are migrated to the direct-REST helper (mocked via
// `global.fetch` below).
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn().mockResolvedValue({
    labels: {
      getLabel: jest.fn(),
    },
  }),
  getAuthManagerFromContext: jest.fn(),
  hasRequestContext: jest.fn(() => false),
}));

// Mock fetch for the direct-REST project/task calls and the user export endpoints
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

/** Queues one successful JSON response for the next `fetch` call. */
function fetchOkOnce(body: unknown): void {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  } as Response);
}

describe('Export Tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats so one test's deliberately
    // failing scenario doesn't trip the breaker for a later test that
    // shares the same auto-derived breaker name (e.g. all `/user/export/*`
    // calls below, and all `/projects*` calls share `vikunja-rest-projects`).
    circuitBreakerRegistry.clear();
    registerExportTool(mockServer, mockAuthManager);
  });

  describe('vikunja_export_project', () => {
    it('should register the export project tool', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_export_project',
        'Export project data including tasks, labels, and metadata in structured format',
        expect.objectContaining({
          projectId: expect.any(Object),
          includeChildren: expect.any(Object),
        }),
        expect.any(Object), // ToolAnnotations
        expect.any(Function),
      );
    });

    describe('Authentication', () => {
      it('should require authentication', async () => {
        const mockAuthManagerNoAuth = {
          isAuthenticated: jest.fn().mockReturnValue(false),
        } as unknown as MockAuthManager;

        mockServer.tool.mockClear();
        registerExportTool(mockServer, mockAuthManagerNoAuth);

        const handler = mockServer.tool.mock.calls.find(
          (call) => call[0] === 'vikunja_export_project',
        )?.at(-1);

        await expect(handler?.({ projectId: 1 })).rejects.toThrow(
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      });

      it('should require JWT authentication', async () => {
        const mockAuthManagerApiToken = {
          isAuthenticated: jest.fn().mockReturnValue(true),
          getAuthType: jest.fn().mockReturnValue('api-token'),
        } as unknown as MockAuthManager;

        mockServer.tool.mockClear();
        registerExportTool(mockServer, mockAuthManagerApiToken);

        const handler = mockServer.tool.mock.calls.find(
          (call) => call[0] === 'vikunja_export_project',
        )?.at(-1);

        await expect(handler?.({ projectId: 1 })).rejects.toThrow(
          'Export operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        );
      });

      it('should allow operations with JWT authentication', async () => {
        const mockProject: Project = {
          id: 1,
          title: 'Test Project',
          description: 'Test Description',
          identifier: 'TEST',
          hex_color: '#4287f5',
          is_archived: false,
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
        };

        const mockAuthManagerJWT = {
          isAuthenticated: jest.fn().mockReturnValue(true),
          getAuthType: jest.fn().mockReturnValue('jwt'),
          getSession: jest.fn().mockReturnValue({
            apiUrl: 'https://vikunja.example.com',
            apiToken: 'test-token',
          }),
        } as unknown as MockAuthManager;

        mockServer.tool.mockClear();
        registerExportTool(mockServer, mockAuthManagerJWT);

        fetchOkOnce(mockProject);
        fetchOkOnce([]);

        const handler = mockServer.tool.mock.calls.find(
          (call) => call[0] === 'vikunja_export_project',
        )?.at(-1);

        const result = await handler?.({ projectId: 1, includeChildren: false });

        expect(result).toMatchObject({
          content: [
            {
              type: 'text',
              text: expect.any(String),
            },
          ],
        });

        const markdown = result.content[0].text;
        const parsed = parseMarkdown(markdown);
        expect(markdown).toContain('## ✅ Success');
      });
    });

    it('should export a project without children', async () => {
      const mockProject: Project = {
        id: 1,
        title: 'Test Project',
        description: 'Test Description',
        identifier: 'TEST',
        hex_color: '#4287f5',
        is_archived: false,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      const mockTasks: Task[] = [
        {
          id: 1,
          title: 'Task 1',
          project_id: 1,
          done: false,
          labels: [{ id: 1, title: 'Label 1', hex_color: '#ff0000' }],
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          title: 'Task 2',
          project_id: 1,
          done: true,
          labels: [{ id: 2, title: 'Label 2', hex_color: '#00ff00' }],
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
        },
      ];

      const mockLabels: Label[] = [
        { id: 1, title: 'Label 1', hex_color: '#ff0000' },
        { id: 2, title: 'Label 2', hex_color: '#00ff00' },
      ];

      const mockClient = await getClientFromContext();

      fetchOkOnce(mockProject);
      fetchOkOnce(mockTasks);
      jest
        .mocked(mockClient.labels.getLabel)
        .mockResolvedValueOnce(mockLabels[0])
        .mockResolvedValueOnce(mockLabels[1]);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_export_project',
      )?.at(-1);

      const result = await handler?.({ projectId: 1, includeChildren: false });

      expect(result).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.any(String),
          },
        ],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('Project exported successfully');
      expect(markdown).toContain('Test Project');
    });

    it('should export a project with children', async () => {
      const mockParentProject: Project = {
        id: 1,
        title: 'Parent Project',
        description: 'Parent Description',
        identifier: 'PARENT',
        hex_color: '#4287f5',
        is_archived: false,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      const mockChildProject: Project = {
        id: 2,
        title: 'Child Project',
        description: 'Child Description',
        identifier: 'CHILD',
        hex_color: '#f54242',
        parent_project_id: 1,
        is_archived: false,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      const mockAllProjects: Project[] = [mockParentProject, mockChildProject];

      // FIXED (was: docs/API-COVERAGE.md Issues table, LOW): exportProjectRecursive
      // used to re-fetch the full project catalog (GET /projects) once per
      // recursion level. It's now fetched once, at the top level, and
      // threaded through recursive calls — so the sequence below has only
      // ONE "GET all projects" call for the whole (parent + child) export,
      // not one per level. Parent: GET project, GET tasks, GET all projects
      // (to find children). Child (id 2, no children of its own): GET
      // project, GET tasks only — no second catalog refetch.
      fetchOkOnce(mockParentProject);
      fetchOkOnce([]);
      fetchOkOnce(mockAllProjects);
      fetchOkOnce(mockChildProject);
      fetchOkOnce([]);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_export_project',
      )?.at(-1);

      const result = await handler?.({ projectId: 1, includeChildren: true });

      expect(result).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.any(String),
          },
        ],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('Project exported successfully');
      expect(markdown).toContain('Parent Project');

      // Exactly 5 fetch calls total (2 per project x 2 projects, plus one
      // shared catalog fetch) — not 6, which is what the old O(depth)
      // refetch shape would have required.
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('should handle circular references in project hierarchy', async () => {
      const mockProject: Project = {
        id: 1,
        title: 'Test Project',
        parent_project_id: 1, // Self-reference
        description: '',
        identifier: 'TEST',
        hex_color: '#4287f5',
        is_archived: false,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      // The circular-reference check fires before any fetch in the
      // recursive call for the "child" (which is really project 1 again),
      // so only the parent invocation's 3 calls actually happen.
      fetchOkOnce(mockProject);
      fetchOkOnce([]);
      fetchOkOnce([mockProject]);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_export_project',
      )?.at(-1);

      await expect(handler?.({ projectId: 1, includeChildren: true })).rejects.toThrow(
        'Circular reference detected in project hierarchy',
      );
    });

    it('should validate project ID', async () => {
      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_export_project',
      )?.at(-1);

      await expect(handler?.({ projectId: 0 })).rejects.toThrow(
        'projectId must be a positive integer',
      );

      await expect(handler?.({ projectId: -1 })).rejects.toThrow(
        'projectId must be a positive integer',
      );

      await expect(handler?.({ projectId: 1.5 })).rejects.toThrow(
        'projectId must be a positive integer',
      );
    });

    it('should handle non-existent project', async () => {
      // An empty response body deserializes to `null` (see
      // vikunjaRestRequestRaw), matching the pre-migration
      // `getProject.mockResolvedValue(null)` scenario.
      fetchOkOnce(null);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_export_project',
      )?.at(-1);

      await expect(handler?.({ projectId: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should skip missing labels gracefully', async () => {
      const mockProject: Project = {
        id: 1,
        title: 'Test Project',
        description: '',
        identifier: 'TEST',
        hex_color: '#4287f5',
        is_archived: false,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      const mockTasks: Task[] = [
        {
          id: 1,
          title: 'Task 1',
          project_id: 1,
          done: false,
          labels: [{ id: 1, title: 'Label 1', hex_color: '#ff0000' }],
          created: '2024-01-01T00:00:00Z',
          updated: '2024-01-01T00:00:00Z',
        },
      ];

      const mockClient = await getClientFromContext();

      fetchOkOnce(mockProject);
      fetchOkOnce(mockTasks);
      jest.mocked(mockClient.labels.getLabel).mockRejectedValue(new Error('Label not found'));

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_export_project',
      )?.at(-1);

      const result = await handler?.({ projectId: 1 });

      expect(result).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.any(String),
          },
        ],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
    });
  });

  describe('vikunja_request_user_export', () => {
    it('should register the request user export tool', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_request_user_export',
        expect.stringContaining('POST /user/export/request'),
        expect.objectContaining({
          password: expect.any(Object),
        }),
        expect.any(Object), // ToolAnnotations
        expect.any(Function),
      );
    });

    it('should request user data export successfully, routed through vikunjaRestRequest with /api/v1 normalization', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ message: 'Export requested' }),
        statusText: 'OK',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      )?.at(-1);

      const result = await handler?.({ password: 'test-password' });

      expect(result).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.any(String),
          },
        ],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('User data export requested successfully');
      expect(markdown).toContain('Export requested');

      // apiUrl has no /api/v1 suffix, so vikunjaRestRequest must normalize it.
      expect(global.fetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/user/export/request',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ password: 'test-password' }),
        }),
      );
    });

    it('should handle API errors when requesting export', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'Invalid password' }),
        statusText: 'Unauthorized',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'wrong-password' })).rejects.toThrow('Invalid password');
    });

    it('should fall back to a null serverMessage when the server returns an empty body', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => '',
        statusText: 'OK',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      )?.at(-1);

      const result = await handler?.({ password: 'test-password' });

      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('User data export requested successfully');
    });

    it('should handle missing authentication token', async () => {
      jest.mocked(mockAuthManager.getSession).mockReturnValueOnce({
        apiUrl: 'https://vikunja.example.com',
        apiToken: null,
      });

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow(
        'No authentication token available',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should validate password parameter', async () => {
      // Test that the schema is properly defined
      const toolCall = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      );

      expect(toolCall).toBeDefined();
      expect(toolCall?.[2]).toMatchObject({
        password: expect.objectContaining({
          minLength: 1,
        }),
      });
    });

    it('should surface HTTP status details when the error body is not JSON', async () => {
      // Persistent (not `...Once`): a bare 502 is retried by
      // vikunjaRestRequest's default policy, so every attempt must see the
      // same failing response for the final thrown message to still be
      // this one.
      jest.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Invalid JSON',
        statusText: 'Bad Gateway',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow(
        'HTTP 502 Bad Gateway',
      );
    });

    it('should handle network timeouts', async () => {
      // Persistent: "timeout" is a retryable message under the default
      // policy, so every retry attempt must see the same rejection.
      jest.mocked(global.fetch).mockRejectedValue(new Error('Request timeout'));

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_request_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow('Request timeout');
    });
  });

  describe('vikunja_download_user_export', () => {
    it('should register the download tool with an honest description of the models.Message response shape', () => {
      const toolCall = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      );

      expect(toolCall).toBeDefined();
      expect(toolCall?.[1]).toContain('models.Message');
      expect(toolCall?.[1]).toContain('does NOT return the export archive');
      expect(toolCall?.[1]).toContain('MCP protocol');
      expect(toolCall?.[2]).toMatchObject({
        password: expect.any(Object),
      });
    });

    it('should handle missing authentication token in download', async () => {
      jest.mocked(mockAuthManager.getSession).mockReturnValueOnce({
        apiUrl: 'https://vikunja.example.com',
        apiToken: null,
      });

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow(
        'No authentication token available',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should report the server confirmation message honestly, not pretend the export data was delivered', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ message: 'Export is ready for download' }),
        statusText: 'OK',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      )?.at(-1);

      const result = await handler?.({ password: 'test-password' });

      expect(result).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.any(String),
          },
        ],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      // Must not claim the export file itself was delivered.
      expect(markdown).not.toContain('User data export downloaded successfully');
      expect(markdown).toContain('does not return the export file');
      expect(markdown).toContain('Export is ready for download');

      // apiUrl has no /api/v1 suffix, so vikunjaRestRequest must normalize it.
      expect(global.fetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/user/export/download',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ password: 'test-password' }),
        }),
      );
    });

    it('should fall back to a null serverMessage when the server returns an empty body', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => '',
        statusText: 'OK',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      )?.at(-1);

      const result = await handler?.({ password: 'test-password' });

      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('does not return the export file');
    });

    it('should handle API errors when confirming the export download', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: 'Export not ready' }),
        statusText: 'Not Found',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow('Export not ready');
    });

    it('should surface HTTP status details when the error body is not JSON', async () => {
      // Persistent: a bare 500 is retried by default, so every attempt must
      // see the same failing response for the final message to match.
      jest.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Invalid JSON',
        statusText: 'Server Error',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow(
        'HTTP 500 Server Error',
      );
    });

    it('should handle network connection errors', async () => {
      // Persistent: "network" is a retryable message under the default
      // policy, so every retry attempt must see the same rejection.
      jest.mocked(global.fetch).mockRejectedValue(new Error('Network request failed'));

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_download_user_export',
      )?.at(-1);

      await expect(handler?.({ password: 'test-password' })).rejects.toThrow(
        'Network request failed',
      );
    });
  });

  describe('vikunja_user_export_status', () => {
    it('should register the status tool', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_user_export_status',
        expect.stringContaining('GET /user/export'),
        {},
        expect.any(Object), // ToolAnnotations
        expect.any(Function),
      );
    });

    it('should retrieve the export status successfully, routed through vikunjaRestRequest with /api/v1 normalization', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            id: 42,
            created: '2026-07-01T00:00:00Z',
            expires: '2026-08-01T00:00:00Z',
            size: 12345,
          }),
        statusText: 'OK',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_user_export_status',
      )?.at(-1);

      const result = await handler?.({});

      expect(result).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.any(String),
          },
        ],
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('Retrieved the current user data export status');
      expect(markdown).toContain('42');
      expect(markdown).toContain('12345');

      // apiUrl has no /api/v1 suffix, so vikunjaRestRequest must normalize it.
      expect(global.fetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/user/export',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should fall back to a null status and honest message when the server returns an empty body', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => '',
        statusText: 'OK',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_user_export_status',
      )?.at(-1);

      const result = await handler?.({});

      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('No user data export has been requested yet');
    });

    it('should handle missing authentication token', async () => {
      jest.mocked(mockAuthManager.getSession).mockReturnValueOnce({
        apiUrl: 'https://vikunja.example.com',
        apiToken: null,
      });

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_user_export_status',
      )?.at(-1);

      await expect(handler?.({})).rejects.toThrow('No authentication token available');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle API errors when checking export status', async () => {
      jest.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: 'Not found' }),
        statusText: 'Not Found',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_user_export_status',
      )?.at(-1);

      await expect(handler?.({})).rejects.toThrow('Not found');
    });

    it('should surface HTTP status details when the error body is not JSON', async () => {
      // Persistent: a bare 500 is retried by default, so every attempt must
      // see the same failing response for the final message to match.
      jest.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Invalid JSON',
        statusText: 'Server Error',
      } as Response);

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_user_export_status',
      )?.at(-1);

      await expect(handler?.({})).rejects.toThrow('HTTP 500 Server Error');
    });

    it('should handle network connection errors', async () => {
      // Persistent: "network" is a retryable message under the default
      // policy, so every retry attempt must see the same rejection.
      jest.mocked(global.fetch).mockRejectedValue(new Error('Network request failed'));

      const handler = mockServer.tool.mock.calls.find(
        (call) => call[0] === 'vikunja_user_export_status',
      )?.at(-1);

      await expect(handler?.({})).rejects.toThrow('Network request failed');
    });
  });

  describe('global read-only mode', () => {
    function getHandler(toolName: string): (args: Record<string, unknown>) => Promise<unknown> {
      const handler = mockServer.tool.mock.calls.find((call) => call[0] === toolName)?.at(-1);
      if (!handler) {
        throw new Error(`handler for ${toolName} not found`);
      }
      return handler as (args: Record<string, unknown>) => Promise<unknown>;
    }

    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('vikunja_export_project (read-only tool, GET-only) is never rejected', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(getHandler('vikunja_export_project'), { projectId: 1 })),
      ).toBe(false);
    });

    it('vikunja_request_user_export (write) is rejected when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(getHandler('vikunja_request_user_export'), { password: 'pw' }),
        ),
      ).toBe(true);
    });

    it('vikunja_request_user_export is not rejected when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });
      fetchOkOnce({ message: 'ok' });

      expect(
        isReadOnlyRejection(
          await callAndCatch(getHandler('vikunja_request_user_export'), { password: 'pw' }),
        ),
      ).toBe(false);
    });

    it('vikunja_download_user_export (classified read — confirmation only) is never rejected', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(getHandler('vikunja_download_user_export'), { password: 'pw' }),
        ),
      ).toBe(false);
    });

    it('vikunja_user_export_status (GET-only) is never rejected', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(getHandler('vikunja_user_export_status'), {})),
      ).toBe(false);
    });
  });
});
