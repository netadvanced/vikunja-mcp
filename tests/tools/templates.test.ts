import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTemplatesTool } from '../../src/tools/templates';
import type { MockVikunjaClient, MockServer } from '../types/mocks';
import type { components } from '../../src/types/generated/vikunja-openapi';

type Project = components['schemas']['models.Project'];
type Task = components['schemas']['models.Task'];
type User = components['schemas']['models.User'];
import { MCPError, ErrorCode } from '../../src/types';
import { AuthManager } from '../../src/auth/AuthManager';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

// Mock modules. getAuthManagerFromContext is used by setTaskLabels
// (src/utils/label-bulk.ts, migrated to direct REST) — any test here that
// instantiates a task template with labels needs it resolved (see
// beforeEach below).
jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));

jest.mock('../../src/storage', () => ({
  storageManager: {
    getStorage: jest.fn(),
  },
}));

// Import mocked functions
import { getAuthManagerFromContext } from '../../src/client';
import { storageManager } from '../../src/storage';

// Mock fetch: `create` (getProject, getProjectTasks) and `instantiate`
// (createProject, createTask) are all migrated off node-vikunja onto the
// direct-REST helper (see src/tools/templates.ts); `updateTaskLabels`
// (via setTaskLabels) stays on the node-vikunja client and is still mocked
// through `mockClient` below.
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object for the REST helper. */
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

/** Queues one successful JSON response for the next `fetch` call. */
function fetchOkOnce(body: unknown): void {
  mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(body) }));
}

/** Queues one failing response for the next `fetch` call. */
function fetchErrOnce(status: number, text = ''): void {
  mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status, text }));
}

/** Parses the JSON body sent on the Nth `fetch` call. */
function fetchBody(callIndex: number): any {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

/** Returns the URL and method used on the Nth `fetch` call. */
function fetchCall(callIndex: number): { url: string; method: string } {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return { url: call[0], method: call[1].method as string };
}

// Mock data
const mockUser: User = {
  id: 1,
  username: 'testuser',
  email: 'test@example.com',
  name: 'Test User',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

const mockProject: Project = {
  id: 1,
  title: 'Test Project',
  description: 'Test Description',
  parent_project_id: undefined,
  is_archived: false,
  hex_color: '#4287f5',
  owner: mockUser,
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

const mockTask: Task = {
  id: 1,
  title: 'Test Task with {{PROJECT_NAME}}',
  description: 'Description with {{START_DATE}}',
  project_id: 1,
  done: false,
  labels: [{ id: 1, title: 'Label 1' }],
  priority: 2,
  position: 1,
  due_date: '2025-06-01T12:00:00Z',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

describe('Templates Tool', () => {
  let mockClient: MockVikunjaClient;
  let mockAuthManager: AuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;
  let mockFilterStorage: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats so one test's deliberately
    // failing scenario doesn't trip the breaker for a later test that
    // shares the same auto-derived breaker name (e.g. `/projects` and
    // `/projects/{id}` share the `vikunja-rest-projects` breaker).
    circuitBreakerRegistry.clear();

    // Setup mock storage instance
    mockFilterStorage = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByName: jest.fn(),
      clear: jest.fn(),
      getByProject: jest.fn(),
      getStats: jest.fn(),
      getSession: jest.fn(),
    };

    // Mock storageManager.getStorage to return our mock storage
    (storageManager.getStorage as jest.Mock).mockResolvedValue(mockFilterStorage);

    // Setup mock client. Only `tasks.updateTaskLabels` remains: templates.ts
    // still calls `setTaskLabels(client, ...)` for label assignment on
    // instantiated tasks (that domain's node-vikunja retirement is a
    // separate item's scope). Project/task get/create all go through fetch.
    mockClient = {
      tasks: {
        updateTaskLabels: jest.fn(),
      },
    } as any;

    // Setup mock auth manager
    mockAuthManager = new AuthManager();
    mockAuthManager.connect('https://test.vikunja.io', 'test-token-12345678');

    // setTaskLabels (src/utils/label-bulk.ts, migrated by #71) recovers its
    // session via getAuthManagerFromContext before the label-bulk POST, which
    // — like project/task creation — goes through the module-level mockFetch.
    // Default every fetch to success so instantiating a template with labels
    // keeps working; fetchOkOnce queues the create responses per test, and
    // label-failure tests override with mockFetch.mockRejectedValue.
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(mockAuthManager);
    mockFetch.mockResolvedValue(mockResponse({ text: JSON.stringify({ labels: [] }) }));
    circuitBreakerRegistry.clear();

    // Setup mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as any;

    // Register the tool
    registerTemplatesTool(mockServer, mockAuthManager);

    // Get the tool handler
    const calls = (mockServer.tool as jest.Mock).mock.calls;
    if (calls.length > 0) {
      toolHandler = calls[0][calls[0].length - 1]; // Handler is always the last argument
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('create subcommand', () => {
    it('should create a template from an existing project', async () => {
      fetchOkOnce(mockProject);
      fetchOkOnce([mockTask]);
      (mockFilterStorage.create as jest.Mock).mockResolvedValue({
        id: 'filter-123',
        name: 'template_123',
        filter: '{}',
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      const result = await toolHandler({
        subcommand: 'create',
        projectId: 1,
        name: 'Sprint Template',
        description: 'Template for sprints',
        tags: ['agile', 'sprint'],
      });

      expect(fetchCall(0)).toEqual({
        url: 'https://test.vikunja.io/api/v1/projects/1',
        method: 'GET',
      });
      expect(fetchCall(1)).toEqual({
        url: 'https://test.vikunja.io/api/v1/projects/1/tasks',
        method: 'GET',
      });
      expect(mockFilterStorage.create).toHaveBeenCalledWith({
        name: expect.stringMatching(/^template_\d+$/),
        filter: expect.any(String),
        isGlobal: true,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** create-template");
      expect(markdown).toContain('Template "Sprint Template" created successfully');
    });

    it('should throw error if required fields are missing', async () => {
      await expect(
        toolHandler({
          subcommand: 'create',
          projectId: 1,
        }),
      ).rejects.toThrow('projectId and name are required');
    });

    it('should handle API errors', async () => {
      mockFetch.mockRejectedValue(new Error('API Error'));

      await expect(
        toolHandler({
          subcommand: 'create',
          projectId: 1,
          name: 'Template',
        }),
      ).rejects.toThrow('Failed to create template');
    });

    it('should create a template from project with minimal data', async () => {
      const minimalProject = { id: 1, title: 'Minimal Project' }; // No description or hex_color
      const minimalTasks = [
        { id: 1, title: 'Task 1' }, // No description, labels, due_date, priority, etc.
        { id: 2, title: 'Task 2', labels: [], assignees: [] }, // Empty arrays
      ];

      fetchOkOnce(minimalProject);
      fetchOkOnce(minimalTasks);
      (mockFilterStorage.create as jest.Mock).mockResolvedValue({
        id: 'filter-123',
        name: 'template_123',
        filter: '{}',
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      const result = await toolHandler({
        subcommand: 'create',
        projectId: 1,
        name: 'Minimal Template',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** create-template");

      // Verify the template data structure
      const createCall = (mockFilterStorage.create as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(createCall.filter);
      expect(templateData.projectData.description).toBeUndefined();
      expect(templateData.projectData.hex_color).toBeUndefined();
      expect(templateData.tasks[0].description).toBeUndefined();
      expect(templateData.tasks[0].labels).toBeUndefined();
      expect(templateData.tasks[1].labels).toBeUndefined(); // Empty array should be undefined
    });

    it('should create a template with tasks having undefined label IDs', async () => {
      const projectWithLabels = { id: 1, title: 'Test Project' };
      const tasksWithUndefinedIds = [
        { id: 1, title: 'Task 1', labels: [{ id: 1 }, { id: undefined }, { id: 2 }] }, // Label with undefined id
        { id: 2, title: 'Task 2', assignees: [{ id: 1 }, { id: undefined }] }, // Assignee with undefined id
      ];

      fetchOkOnce(projectWithLabels);
      fetchOkOnce(tasksWithUndefinedIds);
      (mockFilterStorage.create as jest.Mock).mockResolvedValue({
        id: 'filter-123',
        name: 'template_123',
        filter: '{}',
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      const result = await toolHandler({
        subcommand: 'create',
        projectId: 1,
        name: 'Template with undefined IDs',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** create-template");

      // Verify undefined IDs are filtered out
      const createCall = (mockFilterStorage.create as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(createCall.filter);
      expect(templateData.tasks[0].labels).toEqual([1, 2]); // undefined filtered out
      expect(templateData.tasks[1].assignees).toBeUndefined(); // assignees not included in templates
    });

    it('should handle tasks with various optional fields', async () => {
      const project = { id: 1, title: 'Project', description: 'Desc', hex_color: '#123456' };
      const tasks = [
        {
          id: 1,
          title: 'Task 1',
          due_date: '2025-12-31',
          priority: 2,
          done: true,
          labels: [{ id: 1 }],
          assignees: [{ id: 2 }],
        },
        {
          id: 2,
          title: 'Task 2',
          description: '', // Empty string
          labels: [{ id: undefined }], // All undefined IDs
          assignees: null, // Null assignees
        },
        {
          id: 3,
          title: 'Task 3',
          labels: [], // Empty labels array
        },
      ];

      fetchOkOnce(project);
      fetchOkOnce(tasks);
      (mockFilterStorage.create as jest.Mock).mockResolvedValue({
        id: 'filter-123',
        name: 'template_123',
        filter: '{}',
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      const result = await toolHandler({
        subcommand: 'create',
        projectId: 1,
        name: 'Complex Template',
        description: '', // Empty description
        tags: [], // Empty tags
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** create-template");

      const createCall = (mockFilterStorage.create as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(createCall.filter);

      // Task 1 should have all fields (except done and assignees which aren't saved)
      expect(templateData.tasks[0].due_date).toBe('2025-12-31');
      expect(templateData.tasks[0].priority).toBe(2);
      expect(templateData.tasks[0].done).toBeUndefined(); // done not included in templates

      // Task 2 should have minimal fields
      expect(templateData.tasks[1].description).toBeUndefined(); // Empty string not preserved (falsy check)
      expect(templateData.tasks[1].labels).toEqual([]); // Original array has items but all undefined IDs filtered out
      expect(templateData.tasks[1].assignees).toBeUndefined(); // assignees not included in templates

      // Task 3 with empty labels array
      expect(templateData.tasks[2].labels).toBeUndefined(); // Empty array not included
    });

    it('should skip invalid hex colors when creating templates', async () => {
      const projectWithInvalidColor = {
        id: 1,
        title: 'Project',
        hex_color: 'invalid-color', // Invalid hex color
      };
      const tasks = [{ id: 1, title: 'Task 1' }];

      fetchOkOnce(projectWithInvalidColor);
      fetchOkOnce(tasks);
      (mockFilterStorage.create as jest.Mock).mockResolvedValue({
        id: 'filter-123',
        name: 'template_123',
        filter: '{}',
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      const result = await toolHandler({
        subcommand: 'create',
        projectId: 1,
        name: 'Template with Invalid Color',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** create-template");

      const createCall = (mockFilterStorage.create as jest.Mock).mock.calls[0][0];
      const templateData = JSON.parse(createCall.filter);

      // Invalid hex color should not be included
      expect(templateData.projectData.hex_color).toBeUndefined();
    });

    it('should handle create errors with non-Error objects', async () => {
      // The direct-REST helper always wraps a failed fetch into a real
      // `Error` (see vikunjaRestRequestRaw), so a raw non-Error rejection can
      // no longer come from the project/task fetches themselves post
      // migration — trigger the same fallback branch in templates.ts's
      // 'create' catch (`error instanceof Error ? ... : 'Unknown error'`)
      // via a non-Error rejection from `storage.create` instead.
      fetchOkOnce(mockProject);
      fetchOkOnce([mockTask]);
      (mockFilterStorage.create as jest.Mock).mockRejectedValue('String error');

      await expect(
        toolHandler({
          subcommand: 'create',
          projectId: 1,
          name: 'Template',
        }),
      ).rejects.toThrow('Failed to create template: Unknown error');
    });
  });

  describe('list subcommand', () => {
    it('should list all templates', async () => {
      const mockSavedFilters = [
        {
          id: 'filter_1',
          name: 'template_1',
          filter: JSON.stringify({ id: 'template_1', name: 'Sprint Template', tags: ['agile'] }),
          created: new Date(),
          updated: new Date(),
          isGlobal: true,
        },
        {
          id: 'filter_2',
          name: 'template_2',
          filter: JSON.stringify({ id: 'template_2', name: 'Onboarding Template', tags: ['hr'] }),
          created: new Date(),
          updated: new Date(),
          isGlobal: true,
        },
      ];
      (mockFilterStorage.list as jest.Mock).mockResolvedValue(mockSavedFilters);

      const result = await toolHandler({ subcommand: 'list' });

      expect(mockFilterStorage.list).toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** list-templates");
      expect(markdown).toContain('2'); // Should show count of 2 templates
    });

    it('should handle templates with invalid JSON', async () => {
      const mockSavedFilters = [
        {
          id: 'filter_1',
          name: 'template_1',
          filter: 'invalid json',
          created: new Date(),
          updated: new Date(),
          isGlobal: true,
        },
        {
          id: 'filter_2',
          name: 'template_2',
          filter: JSON.stringify({ id: 'template_2', name: 'Valid Template' }),
          created: new Date(),
          updated: new Date(),
          isGlobal: true,
        },
      ];
      (mockFilterStorage.list as jest.Mock).mockResolvedValue(mockSavedFilters);

      const result = await toolHandler({ subcommand: 'list' });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** list-templates");
      expect(markdown).toContain('1'); // Should show count of 1 template (invalid one filtered out)
    });

    it('should handle list errors', async () => {
      (mockFilterStorage.list as jest.Mock).mockRejectedValue(new Error('Storage error'));

      await expect(toolHandler({ subcommand: 'list' })).rejects.toThrow('Failed to list templates');
    });

    it('should handle list errors with non-Error objects', async () => {
      (mockFilterStorage.list as jest.Mock).mockRejectedValue('String error');

      await expect(toolHandler({ subcommand: 'list' })).rejects.toThrow('Failed to list templates: Unknown error');
    });
  });

  describe('get subcommand', () => {
    it('should get a specific template', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Sprint Template',
        description: 'For sprints',
        tags: ['agile'],
        projectData: { title: 'Test Project' },
        tasks: [],
      };
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      const result = await toolHandler({
        subcommand: 'get',
        id: 'template_123',
      });

      expect(mockFilterStorage.findByName).toHaveBeenCalledWith('template_123');

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** get-template");
      expect(markdown).toContain('Sprint Template');
    });

    it('should throw error if template not found', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue(null);

      await expect(
        toolHandler({
          subcommand: 'get',
          id: 'nonexistent',
        }),
      ).rejects.toThrow('Template with ID nonexistent not found');
    });

    it('should throw error if id is missing', async () => {
      await expect(
        toolHandler({
          subcommand: 'get',
        }),
      ).rejects.toThrow('Template ID is required');
    });

    it('should handle get errors', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockRejectedValue(new Error('Storage error'));

      await expect(
        toolHandler({
          subcommand: 'get',
          id: 'template_123',
        }),
      ).rejects.toThrow('Failed to get template');
    });

    it('should handle get errors with non-Error objects', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockRejectedValue('String error');

      await expect(
        toolHandler({
          subcommand: 'get',
          id: 'template_123',
        }),
      ).rejects.toThrow('Failed to get template: Unknown error');
    });
  });

  describe('update subcommand', () => {
    it('should update template fields', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Old Name',
        description: 'Old description',
        tags: ['old'],
      };
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.update as jest.Mock).mockResolvedValue(undefined);

      const result = await toolHandler({
        subcommand: 'update',
        id: 'template_123',
        name: 'New Name',
        tags: ['new', 'updated'],
      });

      expect(mockFilterStorage.update).toHaveBeenCalledWith('filter_123', {
        filter: expect.any(String),
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** update-template");
      expect(markdown).toContain('Template "New Name" updated successfully');
    });

    it('should update all fields when provided', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Name',
        tags: ['tag'],
      };
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.update as jest.Mock).mockResolvedValue(undefined);

      const result = await toolHandler({
        subcommand: 'update',
        id: 'template_123',
        description: 'New description',
      });

      const updateCall = (mockFilterStorage.update as jest.Mock).mock.calls[0][1];
      const updatedTemplate = JSON.parse(updateCall.filter);
      expect(updatedTemplate.description).toBe('New description');
    });

    it('should throw error if id is missing', async () => {
      await expect(
        toolHandler({
          subcommand: 'update',
          name: 'New Name',
        }),
      ).rejects.toThrow('Template ID is required');
    });

    it('should throw error if template not found', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue(null);

      await expect(
        toolHandler({
          subcommand: 'update',
          id: 'nonexistent',
          name: 'New Name',
        }),
      ).rejects.toThrow('Template with ID nonexistent not found');
    });

    it('should not update if filter not found during update', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Old Name',
        tags: ['old'],
      };
      (mockFilterStorage.findByName as jest.Mock)
        .mockResolvedValueOnce({
          id: 'filter_123',
          name: 'template_123',
          filter: JSON.stringify(mockTemplate),
          created: new Date(),
          updated: new Date(),
          isGlobal: true,
        })
        .mockResolvedValueOnce(null);

      const result = await toolHandler({
        subcommand: 'update',
        id: 'template_123',
        name: 'New Name',
      });

      // Should still return success even if the second findByName fails
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** update-template");
      expect(markdown).toContain('Template "New Name" updated successfully');
    });

    it('should handle update errors', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Old Name',
      };
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.update as jest.Mock).mockRejectedValue(new Error('Update failed'));

      await expect(
        toolHandler({
          subcommand: 'update',
          id: 'template_123',
          name: 'New Name',
        }),
      ).rejects.toThrow('Failed to update template');
    });

    it('should handle update errors with non-Error objects', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Old Name',
      };
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.update as jest.Mock).mockRejectedValue('String error');

      await expect(
        toolHandler({
          subcommand: 'update',
          id: 'template_123',
          name: 'New Name',
        }),
      ).rejects.toThrow('Failed to update template: Unknown error');
    });
  });

  describe('delete subcommand', () => {
    it('should delete a template', async () => {
      const mockTemplate = { id: 'template_123', name: 'Template to delete' };
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.delete as jest.Mock).mockResolvedValue(undefined);

      const result = await toolHandler({
        subcommand: 'delete',
        id: 'template_123',
      });

      expect(mockFilterStorage.delete).toHaveBeenCalledWith('filter_123');

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** delete-template");
      expect(markdown).toContain('Template "Template to delete" deleted successfully');
    });

    it('should throw error if id is missing', async () => {
      await expect(
        toolHandler({
          subcommand: 'delete',
        }),
      ).rejects.toThrow('Template ID is required');
    });

    it('should throw error if template not found', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue(null);

      await expect(
        toolHandler({
          subcommand: 'delete',
          id: 'nonexistent',
        }),
      ).rejects.toThrow('Template with ID nonexistent not found');
    });

    it('should handle delete errors', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify({ id: 'template_123', name: 'Template' }),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.delete as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      await expect(
        toolHandler({
          subcommand: 'delete',
          id: 'template_123',
        }),
      ).rejects.toThrow('Failed to delete template');
    });

    it('should handle delete errors with non-Error objects', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify({ id: 'template_123', name: 'Template' }),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      (mockFilterStorage.delete as jest.Mock).mockRejectedValue('String error');

      await expect(
        toolHandler({
          subcommand: 'delete',
          id: 'template_123',
        }),
      ).rejects.toThrow('Failed to delete template: Unknown error');
    });
  });

  describe('instantiate subcommand', () => {
    it('should create a project from template', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Sprint Template',
        projectData: {
          title: 'Sprint {{SPRINT_NUM}}',
          description: 'Sprint starting {{START_DATE}}',
          hex_color: '#4287f5',
        },
        tasks: [
          {
            title: 'Planning for {{PROJECT_NAME}}',
            description: 'Plan sprint {{SPRINT_NUM}}',
            labels: [1, 2],
            priority: 3,
          },
        ],
      };

      const newProject = { ...mockProject, id: 100, title: 'Sprint 24' };
      const newTask = { ...mockTask, id: 200, project_id: 100 };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      // Project + task creation succeed; the label-bulk POST resolves via
      // the default-success mockFetch configured in beforeEach.
      fetchOkOnce(newProject);
      fetchOkOnce(newTask);

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Sprint 24',
        parentProjectId: 5,
        variables: {
          SPRINT_NUM: '24',
          START_DATE: '2025-06-01',
          PROJECT_NAME: 'Sprint 24',
        },
      });

      expect(fetchCall(0)).toEqual({
        url: 'https://test.vikunja.io/api/v1/projects',
        method: 'PUT',
      });
      expect(fetchBody(0)).toEqual(
        expect.objectContaining({
          title: 'Sprint 24',
          description: 'Sprint starting 2025-06-01',
          parent_project_id: 5,
        }),
      );

      expect(fetchCall(1)).toEqual({
        url: 'https://test.vikunja.io/api/v1/projects/100/tasks',
        method: 'PUT',
      });
      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          title: 'Planning for Sprint 24',
          description: 'Plan sprint 24',
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** instantiate-template");
      expect(markdown).toContain('Project "Sprint 24" created from template');
    });

    it('should handle label assignment failures gracefully', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [{ title: 'Task', labels: [999] }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      // Project + task creation succeed; the label-bulk POST fails.
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });
      mockFetch.mockRejectedValue(new Error('Label not found'));

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'New Project',
      });

      // Should still succeed even if labels fail
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** instantiate-template");
      expect(markdown).toContain('1'); // Should show 1 created task
    });

    it('should throw error if required params missing', async () => {
      await expect(
        toolHandler({
          subcommand: 'instantiate',
          id: 'template_123',
        }),
      ).rejects.toThrow('id and projectName are required');

      await expect(
        toolHandler({
          subcommand: 'instantiate',
          projectName: 'New Project',
        }),
      ).rejects.toThrow('id and projectName are required');
    });

    it('should throw error if template not found', async () => {
      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue(null);

      await expect(
        toolHandler({
          subcommand: 'instantiate',
          id: 'nonexistent',
          projectName: 'New Project',
        }),
      ).rejects.toThrow('Template with ID nonexistent not found');
    });

    it('should handle project creation failure', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      mockFetch.mockRejectedValue(new Error('Project creation failed'));

      // vikunjaRestRequest already throws a well-formed MCPError, and the
      // 'instantiate' catch deliberately passes an already-MCPError through
      // unwrapped (same convention as duplicateProject) rather than
      // re-wrapping it with a generic "Failed to instantiate template:"
      // prefix — that prefix is reserved for genuinely unexpected errors.
      await expect(
        toolHandler({
          subcommand: 'instantiate',
          id: 'template_123',
          projectName: 'New Project',
        }),
      ).rejects.toThrow('Project creation failed');
    });

    it('should handle task creation failures gracefully', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [{ title: 'Task 1' }, { title: 'Task 2' }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });

      // First task succeeds, second fails
      fetchOkOnce({ ...mockTask, id: 200 });
      mockFetch.mockRejectedValueOnce(new Error('Task creation failed'));

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'New Project',
      });

      // Should still succeed but report the failure
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** instantiate-template");
      expect(markdown).toContain('1'); // Should show created and failed task counts
    });

    it('should handle unexpected errors', async () => {
      // Non-MCPError
      (mockFilterStorage.findByName as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await expect(
        toolHandler({
          subcommand: 'instantiate',
          id: 'template_123',
          projectName: 'New Project',
        }),
      ).rejects.toThrow('Failed to instantiate template');
    });

    it('should handle instantiate errors with non-Error objects', async () => {
      // The direct-REST helper always wraps a failed fetch into a real
      // `Error` (see vikunjaRestRequestRaw), so a raw non-Error rejection can
      // no longer come from `createProject` itself post migration — trigger
      // the same fallback branch in templates.ts's 'instantiate' catch
      // (`error instanceof Error ? ... : 'Unknown error'`) via a non-Error
      // rejection from `storage.findByName` instead.
      (mockFilterStorage.findByName as jest.Mock).mockRejectedValue('String error');

      await expect(
        toolHandler({
          subcommand: 'instantiate',
          id: 'template_123',
          projectName: 'New Project',
        }),
      ).rejects.toThrow('Failed to instantiate template: Unknown error');
    });

    it('should apply variables including undefined text and empty variables', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project {{NAME}}',
          description: undefined, // Undefined description
        },
        tasks: [
          {
            title: 'Task on {{TODAY}} at {{NOW}}',
            description: 'Task desc {{VAR}}', // Task with description to cover line 355
          },
        ],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
        variables: { VAR: 'value' }, // Provide variable for task description
      });

      // Check that built-in variables are still applied
      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          title: expect.stringMatching(/Task on \d{4}-\d{2}-\d{2} at \d{4}-\d{2}-\d{2}T/),
          description: 'Task desc value',
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain("**Operation:** instantiate-template");
    });

    it('should handle tasks with position field', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [
          {
            title: 'Task with position',
            position: 10, // Position field
          },
        ],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
      });

      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          title: 'Task with position',
          position: 10,
        }),
      );
    });

    it('should handle project with null ID', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [{ title: 'Task 1' }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });

      // Project created with null ID
      fetchOkOnce({ ...mockProject, id: null });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
      });

      // Should use 0 as fallback for null project ID
      expect(fetchCall(1)).toEqual({
        url: 'https://test.vikunja.io/api/v1/projects/0/tasks',
        method: 'PUT',
      });
      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          project_id: 0,
        }),
      );
    });

    it('should handle task with null ID when adding labels', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [
          {
            title: 'Task with labels',
            labels: [1, 2],
          },
        ],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });

      // Task created with null ID; the label-bulk POST resolves via the
      // default-success mockFetch configured in beforeEach.
      fetchOkOnce({ ...mockTask, id: null });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
      });

      // Should use 0 as fallback for null task ID
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.vikunja.io/api/v1/tasks/0/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
        }),
      );
    });

    it('should handle variable names with regex special characters', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project {{$PROJ.NAME}}',
          description: 'Uses {{[VAR]}} and {{NAME*}}',
        },
        tasks: [
          {
            title: 'Task with {{^START}} and {{END$}}',
          },
        ],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
        variables: {
          '$PROJ.NAME': 'MyProject',
          '[VAR]': 'TestVar',
          'NAME*': 'StarName',
          '^START': 'Beginning',
          END$: 'Finish',
        },
      });

      // Check that project was created with properly substituted variables
      expect(fetchBody(0)).toEqual(
        expect.objectContaining({
          title: 'Test Project', // Uses projectName, not template title
          description: 'Uses TestVar and StarName',
        }),
      );

      // Check that task was created with properly substituted variables
      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          title: 'Task with Beginning and Finish',
        }),
      );
    });

    it('should handle tasks with non-empty description', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: { title: 'Project' },
        tasks: [
          {
            title: 'Task',
            description: 'Test {{VAR}}', // Non-empty description
          },
        ],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
        variables: { VAR: 'Value' },
      });

      // Description with variables should be transformed
      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          description: 'Test Value',
        }),
      );
    });

    it('should preserve description when applying variables', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project',
          description: 'Test {{TODAY}} and {{NOW}}', // Built-in variables
        },
        tasks: [],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'New Project',
      });

      // Built-in variables should be replaced
      const projectCall = fetchBody(0);
      expect(projectCall.description).toMatch(/Test \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}T/);
    });

    it('should handle instantiate with project hex color', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project',
          hex_color: '#FF0000', // Hex color to test line 338
        },
        tasks: [],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Colored Project',
      });

      // Hex color should be included
      expect(fetchBody(0)).toEqual(
        expect.objectContaining({
          hex_color: '#FF0000',
        }),
      );
    });

    it('should handle variables with empty values in applyVariables', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project',
          description: 'Test {{VAR1}} and {{VAR2}}',
        },
        tasks: [],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test',
        variables: {
          VAR1: '', // Empty value
          VAR2: 'value2',
        },
      });

      // Empty variable value should be replaced with empty string
      expect(fetchBody(0)).toEqual(
        expect.objectContaining({
          description: 'Test  and value2',
        }),
      );
    });

    it('should handle template with no description', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project',
          // No description field at all
        },
        tasks: [{
          title: 'Task',
          // No description
        }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
        variables: {},
      });

      // Project should be created without description field
      const projectCall = fetchBody(0);
      expect(projectCall).not.toHaveProperty('description');

      // Task should be created without description field
      const taskCall = fetchBody(1);
      expect(taskCall).not.toHaveProperty('description');
    });

    it('should handle empty variables object in applyVariables', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project {{TODAY}}',
          description: 'Desc {{NOW}}',
        },
        tasks: [{
          title: 'Task {{TODAY}}',
          description: 'Task desc {{NOW}}',
          due_date: '2025-12-31T00:00:00Z', // Add due_date to test line 357
        }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
        // No variables provided - will be undefined in the call
      });

      // Built-in variables should still be applied even without custom variables
      const projectCall = fetchBody(0);
      expect(projectCall.description).toMatch(/Desc \d{4}-\d{2}-\d{2}T/);

      const taskCall = fetchBody(1);
      expect(taskCall.description).toMatch(/Task desc \d{4}-\d{2}-\d{2}T/);
      expect(taskCall.due_date).toBe('2025-12-31T00:00:00Z');
    });

    it('should handle undefined text in applyVariables', async () => {
      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: undefined, // Undefined title
          description: 'Description',
        },
        tasks: [{
          title: undefined, // Undefined task title
        }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      const result = await toolHandler({
        subcommand: 'instantiate',
        id: 'template_123',
        projectName: 'Test Project',
        variables: { VAR: 'value' },
      });

      // Check that applyVariables returns empty string for undefined text
      expect(fetchBody(0)).toEqual(
        expect.objectContaining({
          title: 'Test Project', // Uses projectName directly
          description: 'Description',
        }),
      );

      expect(fetchBody(1)).toEqual(
        expect.objectContaining({
          title: '', // applyVariables returns empty string for undefined
          project_id: 100,
        }),
      );
    });

    it('should handle broken Date.toISOString that returns malformed date', async () => {
      // Save original Date
      const RealDate = global.Date;

      // Mock Date to return a broken ISO string that starts with T (edge case from bad API)
      const mockDate = {
        toISOString: jest.fn().mockReturnValue('T12:34:56.789Z'), // Starts with 'T' - missing date part!
      };
      global.Date = jest.fn(() => mockDate) as any;
      global.Date.now = RealDate.now;

      const mockTemplate = {
        id: 'template_123',
        name: 'Template',
        projectData: {
          title: 'Project {{TODAY}}',
          description: 'Starting {{NOW}}',
        },
        tasks: [{
          title: 'Task for {{TODAY}}',
        }],
      };

      (mockFilterStorage.findByName as jest.Mock).mockResolvedValue({
        id: 'filter_123',
        name: 'template_123',
        filter: JSON.stringify(mockTemplate),
        created: new Date(),
        updated: new Date(),
        isGlobal: true,
      });
      fetchOkOnce({ ...mockProject, id: 100 });
      fetchOkOnce({ ...mockTask, id: 200 });

      try {
        const result = await toolHandler({
          subcommand: 'instantiate',
          id: 'template_123',
          projectName: 'Test Project',
        });

        // Should handle the broken date format gracefully - TODAY becomes empty string due to || ''
        expect(fetchBody(0)).toEqual(
          expect.objectContaining({
            title: 'Test Project',
            description: 'Starting T12:34:56.789Z', // {{NOW}} replaced with full broken string
          }),
        );

        expect(fetchBody(1)).toEqual(
          expect.objectContaining({
            title: 'Task for ', // {{TODAY}} replaced with empty string because split('T')[0] is ''
          }),
        );
      } finally {
        // Restore original Date
        global.Date = RealDate;
      }
    });
  });

  describe('authentication', () => {
    it('should require authentication', async () => {
      mockAuthManager.disconnect(); // Simulate not being authenticated

      await expect(
        toolHandler({
          subcommand: 'list',
        }),
      ).rejects.toThrow('Authentication required');
    });
  });

  describe('unknown subcommand', () => {
    it('should throw error for unknown subcommand', async () => {
      await expect(
        toolHandler({
          subcommand: 'unknown',
        }),
      ).rejects.toThrow('Unknown subcommand: unknown');
    });
  });

  describe('unexpected errors', () => {
    afterEach(() => {
      // Reset the storage mock after error tests
      (storageManager.getStorage as jest.Mock).mockResolvedValue(mockFilterStorage);
    });

    it('should handle non-MCPError errors', async () => {
      // Make session storage resolution throw an unexpected error; this happens
      // before the subcommand switch, so it hits the handler's top-level catch.
      (storageManager.getStorage as jest.Mock).mockRejectedValue(
        new TypeError('Unexpected type error')
      );

      await expect(
        toolHandler({
          subcommand: 'list',
        }),
      ).rejects.toThrow('Unexpected error: Unexpected type error');
    });

    it('should handle non-Error objects thrown at top level', async () => {
      // Reject with a non-Error value to exercise the 'Unknown error' branch.
      (storageManager.getStorage as jest.Mock).mockRejectedValue(
        'String thrown' // eslint-disable-line no-throw-literal
      );

      await expect(
        toolHandler({
          subcommand: 'list',
        }),
      ).rejects.toThrow('Unexpected error: Unknown error');
    });
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects create/update/delete/instantiate when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'create', projectId: 1, name: 'x' }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'update', id: '1' })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'delete', id: '1' })),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'instantiate', id: '1', projectName: 'x' }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for list/get when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'list' }))).toBe(
        false,
      );
      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { subcommand: 'get', id: '1' })),
      ).toBe(false);
    });

    it('does not raise the read-only error for create when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { subcommand: 'create', projectId: 1, name: 'x' }),
        ),
      ).toBe(false);
    });
  });
});
