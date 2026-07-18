/**
 * Webhooks Tool Tests
 *
 * webhooks.ts routes all its HTTP calls through vikunjaRestRequest (see
 * src/utils/vikunja-rest.ts), which normalizes the configured apiUrl to
 * always include the `/api/v1` prefix regardless of how VIKUNJA_URL was
 * configured. These tests mock global fetch the same way
 * tests/utils/vikunja-rest.test.ts and tests/tools/projects/buckets.test.ts
 * do, and assert against the normalized `/api/v1/...` URLs.
 */

import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import {
  registerWebhooksTool,
  clearWebhookEventCache,
  expireWebhookEventCache,
} from '../../src/tools/webhooks';
import { MCPError, ErrorCode } from '../../src/types';
import { getAuthManagerFromContext } from '../../src/client';
import * as validationUtils from '../../src/utils/validation';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import type { Webhook } from '../../src/types/vikunja';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

// Mock the modules
jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));
jest.mock('../../src/auth/AuthManager');

// Mock global fetch (consumed internally by vikunjaRestRequest)
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

/**
 * Minimal Response-like object matching what vikunjaRestRequest reads:
 * `.ok`, `.status`, `.statusText`, `.text()`.
 */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
}): Response {
  const { ok = true, status = 200, statusText = 'OK', body } = opts;
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('Webhooks Tool', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockHandler: (args: any) => Promise<any>;
  let mockClient: MockVikunjaClient;

  const mockWebhook: Webhook = {
    id: 1,
    project_id: 1,
    target_url: 'https://example.com/webhook',
    events: ['task.created', 'task.updated'],
    secret: 'test-secret',
    created: '2023-01-01T00:00:00Z',
    updated: '2023-01-01T00:00:00Z',
  };

  const mockEvents = [
    'task.created',
    'task.updated',
    'task.deleted',
    'task.assigned',
    'task.comment.created',
    'project.created',
    'project.updated',
    'project.deleted',
  ];

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Clear webhook event cache
    clearWebhookEventCache();

    // Create mock client
    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
    } as MockVikunjaClient;

    // Mock auth manager
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
    } as MockAuthManager;

    // Create mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    // Mock the getAuthManagerFromContext function
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(mockClient);

    // Mock auth manager session - apiUrl has no /api/v1 prefix, matching a
    // common VIKUNJA_URL misconfiguration that vikunjaRestRequest normalizes.
    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-token',
    });

    // Reset fetch mock
    mockFetch.mockReset();

    // vikunjaRestRequest now protects every call with a process-wide named
    // circuit breaker (keyed by endpoint group, e.g. all `/projects/*/webhooks`
    // calls here share one breaker). Without clearing accumulated stats
    // between tests, a run of deliberately-failing tests can trip the
    // breaker and leave every later test in this file failing with
    // "Breaker is open" instead of exercising its own scenario.
    circuitBreakerRegistry.clear();

    // Register the tool
    registerWebhooksTool(
      mockServer as unknown as McpServer,
      mockAuthManager as unknown as AuthManager,
    );

    // Get the tool handler
    const calls = (mockServer.tool as jest.Mock).mock.calls;
    if (calls.length > 0) {
      mockHandler = calls[0][calls[0].length - 1]; // Handler is always the last argument
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('Authentication', () => {
    it('should throw error when not authenticated', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(mockHandler({ subcommand: 'list', projectId: 1 })).rejects.toThrow(
        new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        ),
      );
    });
  });

  describe('List Webhooks', () => {
    it('should throw validation error when no subcommand provided', async () => {
      // subcommand is a required field (see src/tools/webhooks.ts) - the MCP SDK's
      // Zod validation rejects calls with a missing subcommand before the handler
      // ever runs. This test exercises the handler's own defensive default case
      // for the same scenario (e.g. if invoked directly bypassing SDK validation).
      await expect(mockHandler({ projectId: 1 })).rejects.toThrow('Unknown subcommand: undefined');
    });

    it('should list webhooks for a project', async () => {
      const mockWebhooks = [mockWebhook, { ...mockWebhook, id: 2 }];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhooks }));

      const result = await mockHandler({ subcommand: 'list', projectId: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**success:** true');
      expect(result.content[0].text).toContain('**operation:** list');
      expect(result.content[0].text).toContain('**count:** 2');
    });

    it('forwards page/perPage query params (LOW issue, docs/API-COVERAGE.md)', async () => {
      // Reproduces the gap: GET /projects/{id}/webhooks documents optional
      // page/per_page query params, but this tool used to never forward
      // them, making it impossible to paginate large webhook lists.
      const mockWebhooks = [mockWebhook];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhooks }));

      const result = await mockHandler({ subcommand: 'list', projectId: 1, page: 2, perPage: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks?page=2&per_page=10',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**page:** 2');
      expect(result.content[0].text).toContain('**perPage:** 10');
    });

    it('ignores page/perPage for scope "user" (GET /user/settings/webhooks documents no pagination params)', async () => {
      const mockWebhooks = [mockWebhook];
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhooks }));

      await mockHandler({ subcommand: 'list', scope: 'user', page: 2, perPage: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should handle empty webhook list', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      const result = await mockHandler({ subcommand: 'list', projectId: 1 });

      expect(result.content[0].text).toContain('**webhooks:** []');
      expect(result.content[0].text).toContain('**count:** 0');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          body: { message: 'Project not found' },
        }),
      );

      await expect(mockHandler({ subcommand: 'list', projectId: 999 })).rejects.toThrow(
        'HTTP 404 Not Found',
      );
    });

    it('should provide helpful error message for webhook authentication errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: { message: 'missing, malformed, expired or otherwise invalid token provided' },
        }),
      );

      await expect(mockHandler({ subcommand: 'list', projectId: 1 })).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
        ),
      );
    });

    it('should throw error for invalid project ID', async () => {
      await expect(mockHandler({ subcommand: 'list', projectId: 'invalid' })).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'projectId must be a positive integer'),
      );
    });
  });

  describe('Get Webhook', () => {
    it('should get a specific webhook', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ body: [mockWebhook, { ...mockWebhook, id: 2 }] }),
      );

      const result = await mockHandler({
        subcommand: 'get',
        projectId: 1,
        webhookId: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**operation:** get');
      expect(result.content[0].text).toContain('"id": 1');
    });

    it('should handle a non-OK response when getting webhooks', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 400, statusText: 'Bad Request' }),
      );

      await expect(
        mockHandler({
          subcommand: 'get',
          projectId: 1,
          webhookId: 1,
        }),
      ).rejects.toThrow('HTTP 400 Bad Request');
    });

    it('should provide helpful error message for webhook authentication errors when getting', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          body: { message: 'insufficient permissions' },
        }),
      );

      await expect(
        mockHandler({
          subcommand: 'get',
          projectId: 1,
          webhookId: 1,
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
        ),
      );
    });

    it('should throw error when webhook not found', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [{ ...mockWebhook, id: 2 }] }));

      await expect(
        mockHandler({
          subcommand: 'get',
          projectId: 1,
          webhookId: 1,
        }),
      ).rejects.toThrow(
        new MCPError(ErrorCode.NOT_FOUND, 'Webhook with ID 1 not found in project 1'),
      );
    });
  });

  describe('Create Webhook', () => {
    it('should create a webhook with all fields', async () => {
      // Mock the events validation call
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));
      // Mock the webhook creation
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhook }));

      const result = await mockHandler({
        subcommand: 'create',
        projectId: 1,
        targetUrl: 'https://example.com/webhook',
        events: ['task.created', 'task.updated'],
        secret: 'test-secret',
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target_url: 'https://example.com/webhook',
            events: ['task.created', 'task.updated'],
            secret: 'test-secret',
          }),
        },
      );
      expect(result.content[0].text).toContain('**operation:** create');
      expect(result.content[0].text).toContain('Webhook created successfully with ID 1');
    });

    it('should create a webhook without secret', async () => {
      const webhookNoSecret = { ...mockWebhook, secret: undefined };
      // Mock the events validation call
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));
      // Mock the webhook creation
      mockFetch.mockResolvedValueOnce(mockResponse({ body: webhookNoSecret }));

      await mockHandler({
        subcommand: 'create',
        projectId: 1,
        targetUrl: 'https://example.com/webhook',
        events: ['task.created'],
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target_url: 'https://example.com/webhook',
            events: ['task.created'],
          }),
        },
      );
    });

    it('should throw error when targetUrl is missing', async () => {
      await expect(
        mockHandler({
          subcommand: 'create',
          projectId: 1,
          events: ['task.created'],
        }),
      ).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'targetUrl is required for creating a webhook'),
      );
    });

    it('should throw error when events are missing', async () => {
      await expect(
        mockHandler({
          subcommand: 'create',
          projectId: 1,
          targetUrl: 'https://example.com/webhook',
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'At least one event is required for creating a webhook',
        ),
      );
    });

    it('should throw error when events array is empty', async () => {
      await expect(
        mockHandler({
          subcommand: 'create',
          projectId: 1,
          targetUrl: 'https://example.com/webhook',
          events: [],
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'At least one event is required for creating a webhook',
        ),
      );
    });

    it('should throw error when events are invalid', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      await expect(
        mockHandler({
          subcommand: 'create',
          projectId: 1,
          targetUrl: 'https://example.com/webhook',
          events: ['task.archived', 'invalid.event'],
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid webhook events: task.archived, invalid.event. Valid events are: ${mockEvents.join(', ')}`,
        ),
      );
    });

    it('should use cached events for validation', async () => {
      // First call fetches events
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));
      // Mock webhook creation for first call
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhook }));

      await mockHandler({
        subcommand: 'create',
        projectId: 1,
        targetUrl: 'https://example.com/webhook',
        events: ['task.created'],
      });

      // Mock webhook creation for second call
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhook }));

      // Second call should use cache, not fetch again
      await mockHandler({
        subcommand: 'create',
        projectId: 1,
        targetUrl: 'https://example.com/webhook',
        events: ['task.updated'],
      });

      // Events API should have been called only once
      const eventsCalls = mockFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/webhooks/events'),
      );
      expect(eventsCalls).toHaveLength(1);
    });

    it('should use stale cache when API fails after initial cache', async () => {
      // First call to populate cache
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      // Create webhook to populate cache
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhook }));

      await mockHandler({
        subcommand: 'create',
        projectId: 1,
        targetUrl: 'https://example.com/webhook',
        events: ['task.created'],
      });

      // Expire the cache to trigger a refetch (but keep the cached events)
      expireWebhookEventCache();

      // Now make the events API fail
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // But webhook creation should still succeed
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockWebhook }));

      // Should not throw error, should use stale cache
      const result = await mockHandler({
        subcommand: 'create',
        projectId: 1,
        targetUrl: 'https://example.com/webhook',
        events: ['task.created'],
      });

      expect(result.content[0].text).toContain('**success:** true');
    });

    it('should handle a non-OK response when creating a webhook', async () => {
      // Events fetch succeeds
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      // Create webhook fails
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 400, statusText: 'Bad Request' }),
      );

      await expect(
        mockHandler({
          subcommand: 'create',
          projectId: 1,
          targetUrl: 'https://example.com/webhook',
          events: ['task.created'],
        }),
      ).rejects.toThrow('HTTP 400 Bad Request');
    });

    it('should provide helpful error message for webhook authentication errors when creating', async () => {
      // Events fetch succeeds
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      // Create webhook fails with 401
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: { message: 'invalid token' },
        }),
      );

      await expect(
        mockHandler({
          subcommand: 'create',
          projectId: 1,
          targetUrl: 'https://example.com/webhook',
          events: ['task.created'],
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
        ),
      );
    });
  });

  describe('Update Webhook', () => {
    it('should update webhook events', async () => {
      const updatedWebhook = {
        ...mockWebhook,
        events: ['task.created', 'task.updated', 'task.deleted'],
      };
      // Mock events validation
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));
      // Mock webhook update
      mockFetch.mockResolvedValueOnce(mockResponse({ body: updatedWebhook }));

      const result = await mockHandler({
        subcommand: 'update',
        projectId: 1,
        webhookId: 1,
        events: ['task.created', 'task.updated', 'task.deleted'],
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks/1',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            events: ['task.created', 'task.updated', 'task.deleted'],
          }),
        },
      );
      const responseText = result.content[0].text;

      // Check markdown format
      expect(responseText).toContain('## ✅ Success');
      expect(responseText).toContain('Webhook events updated successfully');
      expect(responseText).toContain('**operation:** update');
      expect(responseText).toContain('**count:** 1');
      expect(responseText).toContain('**webhook:**');
    });

    it('should throw error when events are missing', async () => {
      await expect(
        mockHandler({
          subcommand: 'update',
          projectId: 1,
          webhookId: 1,
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'At least one event is required for updating a webhook',
        ),
      );
    });

    it('should throw error when events array is empty', async () => {
      await expect(
        mockHandler({
          subcommand: 'update',
          projectId: 1,
          webhookId: 1,
          events: [],
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'At least one event is required for updating a webhook',
        ),
      );
    });

    it('should throw error when events are invalid for update', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      await expect(
        mockHandler({
          subcommand: 'update',
          projectId: 1,
          webhookId: 1,
          events: ['project.archived', 'webhook.invalid'],
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid webhook events: project.archived, webhook.invalid. Valid events are: ${mockEvents.join(', ')}`,
        ),
      );
    });

    it('should handle a non-OK response when updating a webhook', async () => {
      // Events fetch succeeds
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      // Update webhook fails. Persistent (not `...Once`): a bare 500 is
      // retried by vikunjaRestRequest's default policy, so every attempt
      // must see the same failing response for the final thrown message to
      // still be this one.
      mockFetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, statusText: 'Server Error' }),
      );

      await expect(
        mockHandler({
          subcommand: 'update',
          projectId: 1,
          webhookId: 1,
          events: ['task.created'],
        }),
      ).rejects.toThrow('HTTP 500 Server Error');
    });

    it('should provide helpful error message for webhook authentication errors when updating', async () => {
      // Events fetch succeeds
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      // Update webhook fails with 403
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          body: { message: 'permission denied' },
        }),
      );

      await expect(
        mockHandler({
          subcommand: 'update',
          projectId: 1,
          webhookId: 1,
          events: ['task.created'],
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
        ),
      );
    });
  });

  describe('Delete Webhook', () => {
    it('should delete a webhook', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: {} }));

      const result = await mockHandler({
        subcommand: 'delete',
        projectId: 1,
        webhookId: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/projects/1/webhooks/1',
        {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**operation:** delete');
      expect(result.content[0].text).toContain('Webhook 1 deleted successfully');
    });

    it('should handle a non-OK response when deleting a webhook', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 403, statusText: 'Forbidden not-auth-related' }),
      );

      await expect(
        mockHandler({
          subcommand: 'delete',
          projectId: 1,
          webhookId: 1,
        }),
      ).rejects.toThrow(
        // Status 403 always maps to the "additional permissions" message
        // regardless of the underlying reason - see the outer catch in
        // src/tools/webhooks.ts.
        new MCPError(
          ErrorCode.API_ERROR,
          'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
        ),
      );
    });

    it('should handle delete errors', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          body: { message: 'Webhook not found' },
        }),
      );

      await expect(
        mockHandler({
          subcommand: 'delete',
          projectId: 1,
          webhookId: 999,
        }),
      ).rejects.toThrow('HTTP 404 Not Found');
    });

    it('should provide helpful error message for webhook authentication errors when deleting', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: { message: 'authentication required' },
        }),
      );

      await expect(
        mockHandler({
          subcommand: 'delete',
          projectId: 1,
          webhookId: 1,
        }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          'Webhook operations require additional permissions. Please ensure your API token has webhook access rights.',
        ),
      );
    });
  });

  describe('List Events', () => {
    it('should list available webhook events', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));

      const result = await mockHandler({ subcommand: 'list-events' });

      expect(mockFetch).toHaveBeenCalledWith('https://api.vikunja.test/api/v1/webhooks/events', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
      });
      expect(result.content[0].text).toContain('**operation:** list-events');
      expect(result.content[0].text).toContain('**count:** 8');
      expect(result.content[0].text).toContain('task.created');
      expect(result.content[0].text).toContain('project.updated');
    });

    it('should handle empty events list', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      const result = await mockHandler({ subcommand: 'list-events' });

      expect(result.content[0].text).toContain('**events:** []');
      expect(result.content[0].text).toContain('**count:** 0');
    });

    it('should use default events when API fails and no cache available', async () => {
      // Clear any existing cache
      clearWebhookEventCache();

      // Make the events API fail
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await mockHandler({ subcommand: 'list-events' });
      const responseText = result.content[0].text;

      // Check markdown format
      expect(responseText).toContain('## ✅ Success');
      expect(responseText).toContain('webhook events');
      expect(responseText).toContain('**operation:** list-events');
      expect(responseText).toContain('task.created');
      expect(responseText).toContain('project.created');
    });

    it('should use default events when API returns 401/403/404', async () => {
      // Clear any existing cache
      clearWebhookEventCache();

      // Make the events API return 401
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 401, statusText: 'Unauthorized' }),
      );

      const result = await mockHandler({ subcommand: 'list-events' });
      const responseText = result.content[0].text;

      // Check markdown format
      expect(responseText).toContain('## ✅ Success');
      expect(responseText).toContain('webhook events');
      expect(responseText).toContain('**operation:** list-events');
      expect(responseText).toContain('task.created');
      expect(responseText).toContain('project.created');
      expect(responseText).toContain('team.created');
    });

    it('should use default events when events API returns other errors', async () => {
      // Clear any existing cache
      clearWebhookEventCache();

      // Make the events API return 500
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error' }),
      );

      const result = await mockHandler({ subcommand: 'list-events' });
      const responseText = result.content[0].text;

      // Check markdown format
      expect(responseText).toContain('## ✅ Success');
      expect(responseText).toContain('webhook events');
      expect(responseText).toContain('**operation:** list-events');
      expect(responseText).toContain('task.created');
      expect(responseText).toContain('project.created');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown subcommand', async () => {
      await expect(mockHandler({ subcommand: 'unknown' })).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'Unknown subcommand: unknown'),
      );
    });

    it('should wrap a network failure (fetch rejects) as an MCPError from vikunjaRestRequest', async () => {
      // vikunjaRestRequest wraps every fetch failure into an MCPError before
      // it ever reaches webhooks.ts, so this already carries a clear,
      // specific message - it does not fall through to the generic
      // "Webhook operation failed: ..." wrapper.
      mockFetch.mockRejectedValue(new Error('API Error'));

      await expect(mockHandler({ subcommand: 'list', projectId: 1 })).rejects.toThrow(
        'Vikunja REST request failed (GET /projects/1/webhooks): API Error',
      );
    });

    // The generic Error/non-Error branches of the outer catch in
    // src/tools/webhooks.ts exist as a safety net for failures that do not
    // originate from vikunjaRestRequest (which always throws MCPError).
    // validateAndConvertId is one such dependency; mock it to simulate an
    // unexpected non-MCPError failure and confirm the safety net still works.
    describe('unexpected (non-MCPError) failures from other dependencies', () => {
      let validateAndConvertIdSpy: jest.SpiedFunction<
        typeof validationUtils.validateAndConvertId
      >;

      beforeEach(() => {
        validateAndConvertIdSpy = jest.spyOn(validationUtils, 'validateAndConvertId');
      });

      afterEach(() => {
        validateAndConvertIdSpy.mockRestore();
      });

      it('should wrap a plain Error as an API_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          throw new Error('unexpected failure');
        });

        await expect(mockHandler({ subcommand: 'list', projectId: 1 })).rejects.toThrow(
          new MCPError(ErrorCode.API_ERROR, 'Webhook operation failed: unexpected failure'),
        );
      });

      it('should handle a non-Error throw as an INTERNAL_ERROR', async () => {
        validateAndConvertIdSpy.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'string error';
        });

        await expect(mockHandler({ subcommand: 'list', projectId: 1 })).rejects.toThrow(
          new MCPError(
            ErrorCode.INTERNAL_ERROR,
            'An unexpected error occurred during webhook operation',
          ),
        );
      });
    });
  });

  describe("User-scoped webhooks (scope: 'user')", () => {
    const mockUserWebhook: Webhook = {
      id: 5,
      user_id: 42,
      target_url: 'https://example.com/user-webhook',
      events: ['task.created'],
      created: '2023-01-01T00:00:00Z',
      updated: '2023-01-01T00:00:00Z',
    };

    it('should list webhooks for the current user', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [mockUserWebhook] }));

      const result = await mockHandler({ subcommand: 'list', scope: 'user' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('**operation:** list');
      expect(result.content[0].text).toContain('Retrieved 1 webhooks for the current user');
    });

    it('should get a specific user-level webhook', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [mockUserWebhook] }));

      const result = await mockHandler({ subcommand: 'get', scope: 'user', webhookId: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].text).toContain('**operation:** get');
      expect(result.content[0].text).toContain('"id": 5');
    });

    it('should throw error when the user-level webhook is not found', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));

      await expect(
        mockHandler({ subcommand: 'get', scope: 'user', webhookId: 999 }),
      ).rejects.toThrow(
        new MCPError(ErrorCode.NOT_FOUND, 'Webhook with ID 999 not found for the current user'),
      );
    });

    it('should create a user-level webhook', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockUserWebhook }));

      const result = await mockHandler({
        subcommand: 'create',
        scope: 'user',
        targetUrl: 'https://example.com/user-webhook',
        events: ['task.created'],
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks',
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target_url: 'https://example.com/user-webhook',
            events: ['task.created'],
          }),
        },
      );
      expect(result.content[0].text).toContain('Webhook created successfully with ID 5');
    });

    it('should update a user-level webhook', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: mockEvents }));
      mockFetch.mockResolvedValueOnce(
        mockResponse({ body: { ...mockUserWebhook, events: ['task.updated'] } }),
      );

      const result = await mockHandler({
        subcommand: 'update',
        scope: 'user',
        webhookId: 5,
        events: ['task.updated'],
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks/5',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ events: ['task.updated'] }),
        },
      );
      expect(result.content[0].text).toContain('Webhook events updated successfully');
    });

    it('should delete a user-level webhook', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: {} }));

      const result = await mockHandler({ subcommand: 'delete', scope: 'user', webhookId: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks/5',
        {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('Webhook 5 deleted successfully');
    });

    it('should list user-level webhook events from a separate endpoint/cache than project events', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: ['task.created', 'task.updated'] }));

      const result = await mockHandler({ subcommand: 'list-events', scope: 'user' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/user/settings/webhooks/events',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        },
      );
      expect(result.content[0].text).toContain('Retrieved 2 available user-level webhook events');
    });

    it('should reject projectId when scope is user', async () => {
      await expect(
        mockHandler({ subcommand: 'list', scope: 'user', projectId: 1 }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          "projectId must not be provided when scope is 'user' (user-level webhooks are account-wide, not project-scoped)",
        ),
      );
    });

    it('should require projectId when scope is project (default) and it is missing', async () => {
      await expect(mockHandler({ subcommand: 'list' })).rejects.toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, "projectId is required when scope is 'project'"),
      );
    });

    it('should provide a JWT-specific error message for user-scope auth failures', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: { message: 'missing, malformed, expired or otherwise invalid token provided' },
        }),
      );

      await expect(
        mockHandler({ subcommand: 'list', scope: 'user' }),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.API_ERROR,
          "User-level webhook operations require JWT authentication (per the OpenAPI spec, /user/settings/webhooks* endpoints are JWTKeyAuth-only). Reconnect via vikunja_auth.connect with a JWT token, or use scope: 'project' if you only have an API token.",
        ),
      );
    });

    it('does not raise the read-only error for user-scope reads when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list', scope: 'user' })),
      ).toBe(false);

      ConfigurationManager.reset();
    });

    it('rejects user-scope delete when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'delete', scope: 'user', webhookId: 5 }),
        ),
      ).toBe(true);

      ConfigurationManager.reset();
    });
  });

  describe('Tool Registration', () => {
    it('should register with correct schema', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_webhooks',
        expect.any(String), // description
        expect.objectContaining({
          subcommand: expect.any(Object),
          scope: expect.any(Object),
          projectId: expect.any(Object),
          webhookId: expect.any(Object),
          targetUrl: expect.any(Object),
          events: expect.any(Object),
          secret: expect.any(Object),
        }),
        expect.any(Object), // ToolAnnotations
        expect.any(Function),
      );
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
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'create', projectId: 1, targetUrl: 'https://x', events: [] }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'update', projectId: 1, webhookId: 1 }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'delete', projectId: 1, webhookId: 1 }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for list/get/list-events when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list', projectId: 1 })),
      ).toBe(false);
      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'get', projectId: 1, webhookId: 1 }),
        ),
      ).toBe(false);
      expect(
        isReadOnlyRejection(await callAndCatch(mockHandler, { subcommand: 'list-events' })),
      ).toBe(false);
    });

    it('does not raise the read-only error for create when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(mockHandler, { subcommand: 'create', projectId: 1, targetUrl: 'https://x', events: [] }),
        ),
      ).toBe(false);
    });
  });
});
