/**
 * Labels Tool Tests
 *
 * Migrated off node-vikunja (Wave D domain migration, tracking issue #28)
 * onto `vikunjaRestRequest`. Mocks the REST layer directly (fetch), not a
 * node-vikunja client — see docs/ENDPOINT-PLAYBOOK.md §6: mocks are built
 * from the OpenAPI spec's response shape (models.Label), and every write
 * asserts the actual outgoing request body.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerLabelsTool } from '../../src/tools/labels';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

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

describe('Labels Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;

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
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    registerLabelsTool(mockServer, mockAuthManager as unknown as AuthManager);

    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_labels',
      expect.any(String),
      expect.any(Object),
      expect.any(Object), // ToolAnnotations
      expect.any(Function),
    );
    const calls = mockServer.tool.mock.calls;
    if (calls.length > 0 && calls[0] && calls[0].length > 3) {
      mockHandler = calls[0][calls[0].length - 1];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('Registration', () => {
    it('should register the vikunja_labels tool', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_labels',
        expect.any(String),
        expect.any(Object),
        expect.any(Object), // ToolAnnotations
        expect.any(Function),
      );
    });
  });

  describe('Authentication', () => {
    it('should throw AUTH_REQUIRED error when not authenticated', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(mockHandler({ subcommand: 'list' })).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
    });
  });

  describe('List Labels', () => {
    it('should throw validation error when no subcommand provided', async () => {
      // subcommand is a required field (see src/tools/labels.ts) - the MCP SDK's
      // Zod validation rejects calls with a missing subcommand before the handler
      // ever runs. This test exercises the handler's own defensive default case
      // for the same scenario (e.g. if invoked directly bypassing SDK validation).
      await expect(mockHandler({})).rejects.toThrow('Invalid subcommand: undefined');
    });

    it('should list all labels without parameters', async () => {
      const mockLabels = [
        { id: 1, title: 'Bug', hex_color: '#ff0000' },
        { id: 2, title: 'Feature', hex_color: '#00ff00' },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabels }));

      const result = await mockHandler({ subcommand: 'list' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels',
        expect.objectContaining({ method: 'GET' }),
      );
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('list-labels');
      expect(markdown).toContain('Retrieved 2 labels');
    });

    it('should list labels with pagination', async () => {
      const mockLabels = [{ id: 1, title: 'Bug' }];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabels }));

      const result = await mockHandler({
        subcommand: 'list',
        page: 2,
        perPage: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels?page=2&per_page=10',
        expect.objectContaining({ method: 'GET' }),
      );
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** list-labels');
      expect(markdown).toContain('Retrieved 1 label');
    });

    it('should list labels with search', async () => {
      const mockLabels = [{ id: 3, title: 'Security' }];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabels }));

      const result = await mockHandler({
        subcommand: 'list',
        search: 'sec',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels?s=sec',
        expect.objectContaining({ method: 'GET' }),
      );
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** list-labels');
      expect(markdown).toContain('Retrieved 1 label');
    });
  });

  describe('Get Label', () => {
    it('should validate label ID is required', async () => {
      await expect(
        mockHandler({
          subcommand: 'get',
        }),
      ).rejects.toThrow('Label ID is required');
    });

    it('should validate label ID must be positive', async () => {
      await expect(
        mockHandler({
          subcommand: 'get',
          id: -1,
        }),
      ).rejects.toThrow('id must be a positive integer');
    });

    it('should get a label by ID', async () => {
      const mockLabel = {
        id: 1,
        title: 'Bug',
        description: 'Bug reports',
        hex_color: '#ff0000',
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabel }));

      const result = await mockHandler({
        subcommand: 'get',
        id: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels/1',
        expect.objectContaining({ method: 'GET' }),
      );
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('get-label');
      expect(markdown).toContain('Retrieved label "Bug"');
    });

    it('should throw NOT_FOUND error when label does not exist', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      );

      await expect(
        mockHandler({
          subcommand: 'get',
          id: 999,
        }),
      ).rejects.toThrow(new MCPError(ErrorCode.NOT_FOUND, 'Label with ID 999 not found'));
    });
  });

  describe('Create Label', () => {
    it('should validate title is required', async () => {
      await expect(
        mockHandler({
          subcommand: 'create',
        }),
      ).rejects.toThrow('Title is required');
    });

    it('should create a label with title only', async () => {
      const mockLabel = {
        id: 1,
        title: 'New Label',
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabel }));

      const result = await mockHandler({
        subcommand: 'create',
        title: 'New Label',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels',
        expect.objectContaining({ method: 'PUT' }),
      );
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ title: 'New Label' });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('create-label');
      expect(markdown).toContain('Label "New Label" created successfully');
    });

    it('should create a label with all fields', async () => {
      const mockLabel = {
        id: 1,
        title: 'Priority',
        description: 'Priority tasks',
        hex_color: '#ff0000',
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabel }));

      const result = await mockHandler({
        subcommand: 'create',
        title: 'Priority',
        description: 'Priority tasks',
        hexColor: '#ff0000',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        title: 'Priority',
        description: 'Priority tasks',
        hex_color: '#ff0000',
      });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('create-label');
      expect(markdown).toContain('Label "Priority" created successfully');
    });

    it('should throw API_ERROR for bad request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 400, statusText: 'Bad Request', text: 'Invalid hex color' }),
      );

      await expect(
        mockHandler({
          subcommand: 'create',
          title: 'Bad Label',
          hexColor: '#invalid',
        }),
      ).rejects.toThrow('HTTP 400');
    });
  });

  describe('Update Label', () => {
    it('should validate label ID is required', async () => {
      await expect(
        mockHandler({
          subcommand: 'update',
          title: 'Updated',
        }),
      ).rejects.toThrow('Label ID is required');
    });

    it('should validate at least one field is required', async () => {
      await expect(
        mockHandler({
          subcommand: 'update',
          id: 1,
        }),
      ).rejects.toThrow('At least one field to update is required');
    });

    it('should update a label with partial fields', async () => {
      const mockLabel = {
        id: 1,
        title: 'Updated Label',
        hex_color: '#00ff00',
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabel }));

      const result = await mockHandler({
        subcommand: 'update',
        id: 1,
        title: 'Updated Label',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels/1',
        expect.objectContaining({ method: 'PUT' }),
      );
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ title: 'Updated Label' });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('update-label');
      expect(markdown).toContain('Label "Updated Label" updated successfully');
    });

    it('should update all label fields', async () => {
      const mockLabel = {
        id: 1,
        title: 'Complete Update',
        description: 'New description',
        hex_color: '#0000ff',
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabel }));

      const result = await mockHandler({
        subcommand: 'update',
        id: 1,
        title: 'Complete Update',
        description: 'New description',
        hexColor: '#0000ff',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        title: 'Complete Update',
        description: 'New description',
        hex_color: '#0000ff',
      });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('update-label');
      expect(markdown).toContain('Label "Complete Update" updated successfully');
    });

    it('should allow clearing description', async () => {
      const mockLabel = {
        id: 1,
        title: 'Label',
        description: '',
      };
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockLabel }));

      const result = await mockHandler({
        subcommand: 'update',
        id: 1,
        description: '',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ description: '' });
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('update-label');
      expect(markdown).toContain('Label "Label" updated successfully');
    });

    it('should throw API_ERROR for permission errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: 'You do not have permission to perform this action',
        }),
      );

      await expect(
        mockHandler({
          subcommand: 'update',
          id: 1,
          title: 'Forbidden Update',
        }),
      ).rejects.toThrow('HTTP 403');
    });

    it('should throw NOT_FOUND error when label does not exist', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      );

      await expect(
        mockHandler({
          subcommand: 'update',
          id: 999,
          title: 'New Title',
        }),
      ).rejects.toThrow(new MCPError(ErrorCode.NOT_FOUND, 'Label with ID 999 not found'));
    });
  });

  describe('Delete Label', () => {
    it('should validate label ID is required', async () => {
      await expect(
        mockHandler({
          subcommand: 'delete',
        }),
      ).rejects.toThrow('Label ID is required');
    });

    it('should delete a label by ID', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ body: { id: 1, title: 'Bug' } }),
      );

      const result = await mockHandler({
        subcommand: 'delete',
        id: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v1/labels/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('delete-label');
      expect(markdown).toContain('Label deleted successfully');
    });

    it('should throw NOT_FOUND error when label does not exist', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'Not found' }),
      );

      await expect(
        mockHandler({
          subcommand: 'delete',
          id: 999,
        }),
      ).rejects.toThrow(new MCPError(ErrorCode.NOT_FOUND, 'Label with ID 999 not found'));
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown subcommand', async () => {
      await expect(
        mockHandler({
          subcommand: 'unknown',
        }),
      ).rejects.toThrow('Invalid subcommand: unknown');
    });

    it('should handle generic errors', async () => {
      // A 500 is retried by the REST helper's built-in retry loop — use a
      // persistent mock (not `Once`) so the retried attempts still resolve
      // instead of hitting jest's default `undefined` return.
      mockFetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'Network error' }),
      );

      await expect(
        mockHandler({
          subcommand: 'list',
        }),
      ).rejects.toThrow('HTTP 500');
    });

    it('should handle network-level fetch failures', async () => {
      // Network-level failures are also retried — see above.
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await expect(
        mockHandler({
          subcommand: 'get',
          id: 1,
        }),
      ).rejects.toThrow('Connection refused');
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects create/update/delete when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'create', title: 'x' })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'update', id: 1 })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'delete', id: 1 })),
      ).toBe(true);
    });

    it('does not raise the read-only error for list/get when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list' }))).toBe(
        false,
      );
      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'get', id: 1 })),
      ).toBe(false);
    });

    it('does not raise the read-only error for create when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'create', title: 'x' })),
      ).toBe(false);
    });
  });
});
