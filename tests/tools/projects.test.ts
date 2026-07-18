import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerProjectsTool } from '../../src/tools/projects';
import type { Project, User } from 'node-vikunja';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';

// Import the function we're mocking
import { getClientFromContext } from '../../src/client';

// Mock the modules
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
}));
jest.mock('../../src/auth/AuthManager');

describe('Projects Tool', () => {
  let mockClient: MockVikunjaClient;
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;

  // Helper function to call a tool
  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    if (typeof toolHandler !== 'function') {
      throw new Error('toolHandler is not a function in callTool');
    }

    return toolHandler({
      subcommand,
      ...args,
    });
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
    position: 1,
    identifier: 'TEST',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client
    mockClient = {
      getToken: jest.fn().mockReturnValue('test-token'),
      tasks: {
        getAllTasks: jest.fn(),
        getProjectTasks: jest.fn(),
        createTask: jest.fn(),
        getTask: jest.fn(),
        updateTask: jest.fn(),
        deleteTask: jest.fn(),
        getTaskComments: jest.fn(),
        createTaskComment: jest.fn(),
        updateTaskLabels: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
        bulkUpdateTasks: jest.fn(),
      },
      projects: {
        getProjects: jest.fn(),
        createProject: jest.fn(),
        getProject: jest.fn(),
        updateProject: jest.fn(),
        deleteProject: jest.fn(),
        createLinkShare: jest.fn(),
        getLinkShares: jest.fn(),
        getLinkShare: jest.fn(),
        deleteLinkShare: jest.fn(),
      },
      labels: {
        getLabels: jest.fn(),
        getLabel: jest.fn(),
        createLabel: jest.fn(),
        updateLabel: jest.fn(),
        deleteLabel: jest.fn(),
      },
      users: {
        getAll: jest.fn(),
      },
      teams: {
        getAll: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      shares: {
        getShareAuth: jest.fn(),
      },
    } as MockVikunjaClient;

    // Setup mock auth manager
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn(),
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

    // Mock getClientFromContext
    (getClientFromContext as jest.Mock).mockReturnValue(mockClient);
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);

    try {
      // Register the tool
      registerProjectsTool(mockServer, mockAuthManager);

      // Get the tool handler
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_projects',
        expect.any(String),
        expect.any(Object),
        expect.any(Function),
      );
      const calls = mockServer.tool.mock.calls;
      if (calls.length > 0 && calls[0] && calls[0].length > 3) {
        toolHandler = calls[0][3];
      } else {
        throw new Error('Tool handler not found');
      }
    } catch (error) {
      console.error('Error setting up projects tool test:', error);
      throw error;
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
        'create-share',
        'list-shares',
        'get-share',
        'delete-share',
        'auth-share',
        'list-project-users',
        'search-project-users',
        'add-project-user',
        'update-project-user-permission',
        'remove-project-user',
        'list-project-teams',
        'add-project-team',
        'update-project-team-permission',
        'remove-project-team',
        'share-with-user',
        'share-with-team',
        'list-members',
      ];

      for (const subcommand of subcommands) {
        await expect(callTool(subcommand)).rejects.toThrow('Authentication required');
      }
    });
  });

  describe('list subcommand', () => {
    it('should list all projects', async () => {
      const mockProjects = [mockProject, { ...mockProject, id: 2, title: 'Project 2' }];
      mockClient.projects.getProjects.mockResolvedValue(mockProjects);

      const result = await callTool('list');

      expect(mockClient.projects.getProjects).toHaveBeenCalledWith({
        page: 1,
        per_page: 50,
      });
      expect(result.content[0].type).toBe('text');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Retrieved 2 projects');
      expect(markdown).toMatch(/list[_\\]+projects/);
    });

    it('should support pagination parameters', async () => {
      mockClient.projects.getProjects.mockResolvedValue([mockProject]);

      await callTool('list', { page: 2, perPage: 10 });

      expect(mockClient.projects.getProjects).toHaveBeenCalledWith({
        page: 2,
        per_page: 10,
      });
    });

    it('should handle singular project in message', async () => {
      mockClient.projects.getProjects.mockResolvedValue([mockProject]);

      const result = await callTool('list');
      const markdown = result.content[0].text;
      expect(markdown).toContain('Retrieved 1 project');
    });

    it('should support search parameter', async () => {
      mockClient.projects.getProjects.mockResolvedValue([mockProject]);

      await callTool('list', { search: 'test' });

      expect(mockClient.projects.getProjects).toHaveBeenCalledWith({
        page: 1,
        per_page: 50,
        s: 'test',
      });
    });

    it('should support archived filter', async () => {
      mockClient.projects.getProjects.mockResolvedValue([]);

      await callTool('list', { isArchived: true });

      expect(mockClient.projects.getProjects).toHaveBeenCalledWith({
        page: 1,
        per_page: 50,
        is_archived: true,
      });
    });

    it('should handle API errors', async () => {
      mockClient.projects.getProjects.mockRejectedValue(new Error('API Error'));

      await expect(callTool('list')).rejects.toThrow('Failed to list projects: API Error');
    });
  });

  describe('get subcommand', () => {
    it('should get a project by ID', async () => {
      mockClient.projects.getProject.mockResolvedValue(mockProject);

      const result = await callTool('get', { id: 1 });

      expect(mockClient.projects.getProject).toHaveBeenCalledWith(1);
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
      const error: any = new Error('Not found');
      error.statusCode = 404;
      mockClient.projects.getProject.mockRejectedValue(error);

      await expect(callTool('get', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle other API errors', async () => {
      mockClient.projects.getProject.mockRejectedValue(new Error('API Error'));

      await expect(callTool('get', { id: 1 })).rejects.toThrow('Failed to get project: API Error');
    });

    it('should handle non-Error API errors in get', async () => {
      mockClient.projects.getProject.mockRejectedValue({ error: 'Unknown' });

      await expect(callTool('get', { id: 1 })).rejects.toThrow(
        'Failed to get project: Unknown error',
      );
    });
  });

  describe('create subcommand', () => {
    it('should create a project', async () => {
      mockClient.projects.createProject.mockResolvedValue(mockProject);

      const result = await callTool('create', {
        title: 'Test Project',
        description: 'Test Description',
        hexColor: '#4287f5',
      });

      expect(mockClient.projects.createProject).toHaveBeenCalledWith({
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
      mockClient.projects.createProject.mockResolvedValue(mockProject);
      mockClient.projects.getProjects.mockResolvedValue([mockProject]); // Add this for depth validation

      await callTool('create', {
        title: 'Child Project',
        parentProjectId: 1,
      });

      expect(mockClient.projects.createProject).toHaveBeenCalledWith({
        title: 'Child Project',
        parent_project_id: 1,
      });
    });

    it('should default isArchived to false', async () => {
      mockClient.projects.createProject.mockResolvedValue(mockProject);

      await callTool('create', { title: 'New Project' });

      expect(mockClient.projects.createProject).toHaveBeenCalledWith({
        title: 'New Project',
      });
    });

    it('should handle API errors', async () => {
      mockClient.projects.createProject.mockRejectedValue(new Error('API Error'));

      await expect(callTool('create', { title: 'New Project' })).rejects.toThrow(
        'Failed to create project: API Error',
      );
    });

    it('should handle non-Error API errors in create', async () => {
      mockClient.projects.createProject.mockRejectedValue('String error');

      await expect(callTool('create', { title: 'New Project' })).rejects.toThrow(
        'Failed to create project: String error',
      );
    });

    it('should support all optional fields', async () => {
      mockClient.projects.createProject.mockResolvedValue(mockProject);
      mockClient.projects.getProjects.mockResolvedValue([mockProject]); // Add this for depth validation

      await callTool('create', {
        title: 'Full Project',
        description: 'Full description',
        parentProjectId: 1,
        isArchived: false,
        hexColor: '#FF0000',
      });

      expect(mockClient.projects.createProject).toHaveBeenCalledWith({
        title: 'Full Project',
        description: 'Full description',
        parent_project_id: 1,
        is_archived: false,
        hex_color: '#ff0000', // Normalized to lowercase
      });
    });

    describe('hex color validation', () => {
      it('should accept valid hex colors and normalize to lowercase', async () => {
        mockClient.projects.createProject.mockResolvedValue(mockProject);

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
          expect(mockClient.projects.createProject).toHaveBeenCalledWith({
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
      mockClient.projects.getProject.mockResolvedValue(mockProject);
      mockClient.projects.updateProject.mockResolvedValue(updatedProject);

      const result = await callTool('update', {
        id: 1,
        title: 'Updated Title',
      });

      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
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
      mockClient.projects.getProject.mockResolvedValue(childProject);
      mockClient.projects.getProjects.mockResolvedValue([mockProject, childProject]);
      mockClient.projects.updateProject.mockResolvedValue(updatedChild);

      await callTool('update', {
        id: 2,
        title: childProject.title,
        description: 'Updated description',
        // parentProjectId intentionally omitted
      });

      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(
        2,
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
      mockClient.projects.getProject.mockResolvedValue(rootProject);
      mockClient.projects.updateProject.mockResolvedValue({
        ...rootProject,
        description: 'updated description',
      });

      await callTool('update', {
        id: 5,
        description: 'updated description',
        // parentProjectId intentionally omitted, like a normal partial update
      });

      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          description: 'updated description',
          parent_project_id: 0,
        }),
      );
    });

    it('should preserve existing title when title is omitted (issue #44)', async () => {
      mockClient.projects.getProject.mockResolvedValue(mockProject);
      mockClient.projects.updateProject.mockResolvedValue({
        ...mockProject,
        description: 'new description',
      });

      // Title intentionally omitted — Vikunja rejects updates without a title
      await callTool('update', {
        id: 1,
        description: 'new description',
      });

      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(
        1,
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
      mockClient.projects.getProject.mockResolvedValue(childProject);
      mockClient.projects.getProjects.mockResolvedValue([mockProject, childProject, newParent]);
      mockClient.projects.updateProject.mockResolvedValue({
        ...childProject,
        parent_project_id: 3,
      });

      await callTool('update', {
        id: 2,
        parentProjectId: 3,
      });

      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(
        2,
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
      mockClient.projects.getProject.mockResolvedValue(mockProject);
      mockClient.projects.updateProject.mockResolvedValue(mockProject);
      mockClient.projects.getProjects.mockResolvedValue([
        mockProject,
        { id: 2, title: 'Parent', parent_project_id: undefined },
      ]); // Add this for depth validation

      await callTool('update', {
        id: 1,
        title: 'New Title',
        description: 'New Description',
        parentProjectId: 2,
        isArchived: true,
        hexColor: '#ff0000',
      });

      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
        ...mockProject,
        title: 'New Title',
        description: 'New Description',
        parent_project_id: 2,
        is_archived: true,
        hex_color: '#ff0000', // Already lowercase
      });
    });

    it('should handle 404 errors', async () => {
      const error: any = new Error('Not found');
      error.statusCode = 404;
      mockClient.projects.updateProject.mockRejectedValue(error);

      await expect(callTool('update', { id: 999, title: 'New Title' })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      mockClient.projects.updateProject.mockRejectedValue(new Error('API Error'));

      await expect(callTool('update', { id: 1, title: 'New Title' })).rejects.toThrow(
        'Failed to update project: API Error',
      );
    });

    it('should handle non-Error API errors in update', async () => {
      mockClient.projects.updateProject.mockRejectedValue(null);

      await expect(callTool('update', { id: 1, title: 'New Title' })).rejects.toThrow(
        'Failed to update project: Unknown error',
      );
    });

    describe('hex color validation', () => {
      it('should accept valid hex colors in update and normalize to lowercase', async () => {
        mockClient.projects.getProject.mockResolvedValue(mockProject);
        mockClient.projects.updateProject.mockResolvedValue(mockProject);

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
          expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
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
      mockClient.projects.getProject.mockResolvedValue(mockProject);
      mockClient.projects.deleteProject.mockResolvedValue({ message: 'Success' });

      const result = await callTool('delete', { id: 1 });

      expect(mockClient.projects.getProject).toHaveBeenCalledWith(1);
      expect(mockClient.projects.deleteProject).toHaveBeenCalledWith(1);
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
      const error: any = new Error('Not found');
      error.statusCode = 404;
      mockClient.projects.deleteProject.mockRejectedValue(error);

      await expect(callTool('delete', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      mockClient.projects.deleteProject.mockRejectedValue(new Error('API Error'));

      await expect(callTool('delete', { id: 1 })).rejects.toThrow(
        'Failed to delete project: API Error',
      );
    });

    it('should handle non-Error API errors in delete', async () => {
      mockClient.projects.deleteProject.mockRejectedValue(false);

      await expect(callTool('delete', { id: 1 })).rejects.toThrow(
        'Failed to delete project: Unknown error',
      );
    });
  });

  describe('archive subcommand', () => {
    it('should archive a project successfully', async () => {
      const archivedProject = { ...mockProject, is_archived: true };
      mockClient.projects.getProject.mockResolvedValue(mockProject); // Not archived yet
      mockClient.projects.updateProject.mockResolvedValue(archivedProject);

      const result = await callTool('archive', { id: 1 });

      expect(mockClient.projects.getProject).toHaveBeenCalledWith(1);
      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
        ...mockProject,
        is_archived: true
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
      mockClient.projects.getProject.mockResolvedValue(archivedProject);

      const result = await callTool('archive', { id: 1 });

      expect(mockClient.projects.getProject).toHaveBeenCalledWith(1);
      expect(mockClient.projects.updateProject).not.toHaveBeenCalled();
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
      const error: any = new Error('Not found');
      error.statusCode = 404;
      mockClient.projects.getProject.mockRejectedValue(error);

      await expect(callTool('archive', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      mockClient.projects.getProject.mockRejectedValue(new Error('API Error'));

      await expect(callTool('archive', { id: 1 })).rejects.toThrow(
        'Failed to archive project: API Error',
      );
    });

    it('should handle non-Error API errors', async () => {
      mockClient.projects.getProject.mockRejectedValue('string error');

      await expect(callTool('archive', { id: 1 })).rejects.toThrow(
        'Failed to archive project: string error',
      );
    });
  });

  describe('unarchive subcommand', () => {
    it('should unarchive a project successfully', async () => {
      const archivedProject = { ...mockProject, is_archived: true };
      const unarchivedProject = { ...mockProject, is_archived: false };
      mockClient.projects.getProject.mockResolvedValue(archivedProject); // Currently archived
      mockClient.projects.updateProject.mockResolvedValue(unarchivedProject);

      const result = await callTool('unarchive', { id: 1 });

      expect(mockClient.projects.getProject).toHaveBeenCalledWith(1);
      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
        ...archivedProject,
        is_archived: false
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
      mockClient.projects.getProject.mockResolvedValue(mockProject); // Not archived

      const result = await callTool('unarchive', { id: 1 });

      expect(mockClient.projects.getProject).toHaveBeenCalledWith(1);
      expect(mockClient.projects.updateProject).not.toHaveBeenCalled();
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
      const error: any = new Error('Not found');
      error.statusCode = 404;
      mockClient.projects.getProject.mockRejectedValue(error);

      await expect(callTool('unarchive', { id: 999 })).rejects.toThrow(
        'Project with ID 999 not found',
      );
    });

    it('should handle API errors', async () => {
      mockClient.projects.getProject.mockRejectedValue(new Error('API Error'));

      await expect(callTool('unarchive', { id: 1 })).rejects.toThrow(
        'Failed to unarchive project: API Error',
      );
    });

    it('should handle non-Error API errors', async () => {
      mockClient.projects.getProject.mockRejectedValue('string error');

      await expect(callTool('unarchive', { id: 1 })).rejects.toThrow(
        'Failed to unarchive project: string error',
      );
    });
  });

  describe('invalid subcommand', () => {
    it('should reject invalid subcommands', async () => {
      await expect(callTool('invalid')).rejects.toThrow('Unknown subcommand: invalid');
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      mockClient.projects.getProjects.mockRejectedValue('String error');

      await expect(callTool('list')).rejects.toThrow('Failed to list projects: String error');
    });

    it('should pass through MCPError instances', async () => {
      const customError = new Error('Custom API Error');
      mockClient.projects.getProjects.mockRejectedValue(customError);

      await expect(callTool('list')).rejects.toThrow('Failed to list projects: Custom API Error');
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
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const childProjects = [
        { ...mockProject, id: 2, title: 'Child 1', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Child 2', parent_project_id: 1 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce([mockProject, ...childProjects]);

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
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('get-children')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('get-children', { id: -1 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle API errors', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockRejectedValueOnce(new Error('API error'));
      await expect(callTool('get-children', { id: 1 })).rejects.toThrow('Failed to get project children');
    });

    it('should handle singular child project in message', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const childProject = { ...mockProject, id: 2, title: 'Only Child', parent_project_id: 1 };
      mockClient.projects.getProjects.mockResolvedValueOnce([mockProject, childProject]);

      const result = await callTool('get-children', { id: 1 });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Found 1 child project for project ID 1');
    });

    it('should handle non-Error API errors in get-children', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockRejectedValueOnce('String error');
      await expect(callTool('get-children', { id: 1 })).rejects.toThrow(
        'Failed to get project children: String error',
      );
    });
  });

  describe('get-tree subcommand', () => {
    it('should get project tree', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child 1', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Child 2', parent_project_id: 1 },
        { ...mockProject, id: 4, title: 'Grandchild', parent_project_id: 2 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

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
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 2 },
        { ...mockProject, id: 2, title: 'Project 2', parent_project_id: 1 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

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
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('get-tree')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('get-tree', { id: 0 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle project not found', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockResolvedValueOnce([]);
      await expect(callTool('get-tree', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle API errors', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockRejectedValueOnce(new Error('API error'));
      await expect(callTool('get-tree', { id: 1 })).rejects.toThrow('Failed to get project tree');
    });

    it('should handle projects without IDs', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: undefined, title: 'No ID', parent_project_id: 1 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Root');
    });

    it('should handle non-Error API errors in get-tree', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockRejectedValueOnce({ notAnError: true });
      await expect(callTool('get-tree', { id: 1 })).rejects.toThrow(
        'Failed to get project tree: Unknown error',
      );
    });

    it('should handle singular project in tree message', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      const result = await callTool('get-tree', { id: 1 });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Retrieved project tree with 1 nodes at depth 0');
    });

    it('should handle countProjects with null node', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      // Create a scenario where we have nested projects
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 1 },
        { ...mockProject, id: undefined, title: 'Child without ID', parent_project_id: 2 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

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
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Root', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Grandchild', parent_project_id: 2 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

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
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 2 },
        { ...mockProject, id: 2, title: 'Project 2', parent_project_id: 1 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow('Circular reference detected');
    });

    it('should handle orphaned projects', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 999 }, // Parent doesn't exist
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      const result = await callTool('get-breadcrumb', { id: 2 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Child');
    });

    it('should require project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('get-breadcrumb')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('get-breadcrumb', { id: -5 })).rejects.toThrow('id must be a positive integer');
    });

    it('should handle project not found', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockResolvedValueOnce([]);
      await expect(callTool('get-breadcrumb', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle API errors', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockRejectedValueOnce(new Error('API error'));
      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow('Failed to get project breadcrumb');
    });

    it('should handle non-Error API errors in get-breadcrumb', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockRejectedValueOnce(123);
      await expect(callTool('get-breadcrumb', { id: 1 })).rejects.toThrow(
        'Failed to get project breadcrumb: 123',
      );
    });
  });

  describe('move subcommand', () => {
    it('should move project to new parent', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Parent', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Project to Move', parent_project_id: undefined },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.updateProject.mockResolvedValueOnce({
        ...projects[1],
        parent_project_id: 1,
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
      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(2, {
        ...projects[1],
        parent_project_id: 1,
      });
    });

    it('should move project to root', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Project', parent_project_id: 2 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.updateProject.mockResolvedValueOnce({
        ...projects[0],
        parent_project_id: undefined,
      });

      const result = await callTool('move', { id: 1, parentProjectId: undefined });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Moved project "Project" to root level');
      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
        ...projects[0],
        parent_project_id: 0,
      });
    });

    it('should prevent self-parent', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Project', parent_project_id: undefined },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      await expect(callTool('move', { id: 1, parentProjectId: 1 })).rejects.toThrow('Cannot move a project to be its own parent');
    });

    it('should prevent circular references', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Parent', parent_project_id: undefined },
        { ...mockProject, id: 2, title: 'Child', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Grandchild', parent_project_id: 2 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.getProject.mockResolvedValueOnce(projects[0]); // Mock project 1 lookup

      await expect(callTool('move', { id: 1, parentProjectId: 3 })).rejects.toThrow('Move would create a circular reference in project hierarchy');
    });

    it('should prevent exceeding max depth', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
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

      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.getProject.mockResolvedValueOnce(projects.find(p => p.id === 10)); // Mock project 10 lookup

      await expect(callTool('move', { id: 10, parentProjectId: 9 })).rejects.toThrow('exceed the maximum depth');
    });

    it('should require project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('move')).rejects.toThrow('Project ID is required');
    });

    it('should validate project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      await expect(callTool('move', { id: 0 })).rejects.toThrow('id must be a positive integer');
    });

    it('should validate parent project ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProject.mockResolvedValueOnce(mockProject); // Mock the current project lookup
      mockClient.projects.getProjects.mockResolvedValueOnce([mockProject]); // Mock all projects lookup
      await expect(callTool('move', { id: 1, parentProjectId: -1 })).rejects.toThrow('parentProjectId must be a positive integer');
    });

    it('should handle project not found', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProjects.mockResolvedValueOnce([]);
      await expect(callTool('move', { id: 999 })).rejects.toThrow('Project with ID 999 not found');
    });

    it('should handle parent project not found', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Project', parent_project_id: undefined },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.getProject.mockResolvedValueOnce(mockProject); // Mock the current project lookup
      await expect(callTool('move', { id: 1, parentProjectId: 999 })).rejects.toThrow('Parent project with ID 999 not found');
    });

    it('should handle API errors', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProject.mockResolvedValueOnce(mockProject); // Mock the current project lookup
      mockClient.projects.getProjects.mockRejectedValueOnce(new Error('API error'));
      await expect(callTool('move', { id: 1 })).rejects.toThrow('Failed to move project');
    });

    it('should handle non-Error API errors in move', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      mockClient.projects.getProject.mockResolvedValueOnce(mockProject); // Mock the current project lookup
      mockClient.projects.getProjects.mockRejectedValueOnce(null);
      await expect(callTool('move', { id: 1 })).rejects.toThrow(
        'Failed to move project: Unknown error',
      );
    });
  });

  describe('depth validation edge cases', () => {
    it('should detect circular reference in calculateProjectDepth', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const circularProjects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 3 },
        { ...mockProject, id: 2, title: 'Project 2', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Project 3', parent_project_id: 2 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(circularProjects);

      await expect(callTool('create', { title: 'New Project', parentProjectId: 1 })).rejects.toThrow('Circular reference detected');
    });

    it('should handle edge case where project has multiple children with same ID', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
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

      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.getProject.mockResolvedValueOnce({
        ...mockProject,
        id: 5,
        title: 'Project to Move',
        parent_project_id: undefined,
      });
      mockClient.projects.updateProject.mockResolvedValueOnce({
        ...mockProject,
        id: 5,
        title: 'Project to Move',
        parent_project_id: 1,
      });

      const result = await callTool('move', { id: 5, parentProjectId: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
    });

    it('should handle projects without IDs in getMaxSubtreeDepth', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      // Create projects where some don't have IDs
      const projects = [
        { ...mockProject, id: 1, title: 'Project with mixed children', parent_project_id: undefined },
        { ...mockProject, id: undefined, title: 'Child without ID', parent_project_id: 1 },
        { ...mockProject, id: 3, title: 'Child with ID', parent_project_id: 1 },
        // Add a target parent
        { ...mockProject, id: 4, title: 'Target Parent', parent_project_id: undefined },
      ];

      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.getProject.mockResolvedValueOnce({
        ...mockProject,
        id: 1,
        title: 'Project with mixed children',
        parent_project_id: undefined,
      });
      mockClient.projects.updateProject.mockResolvedValueOnce({
        ...mockProject,
        id: 1,
        title: 'Project with mixed children',
        parent_project_id: 4,
      });

      const result = await callTool('move', { id: 1, parentProjectId: 4 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
    });

    it('should handle missing project in calculateProjectDepth', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, title: 'Project 1', parent_project_id: 999 }, // Parent doesn't exist
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.createProject.mockResolvedValueOnce({
        ...mockProject,
        id: 2,
        title: 'New Project',
        parent_project_id: 1,
      });

      const result = await callTool('create', { title: 'New Project', parentProjectId: 1 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('New Project');
    });

    it('should enforce max depth on create', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
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
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      await expect(callTool('create', { title: 'Too Deep', parentProjectId: 10 })).rejects.toThrow('Maximum allowed depth is 10 levels');
    });

    it('should enforce max depth on update', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(true);
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
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);

      await expect(callTool('update', { id: 11, parentProjectId: 10 })).rejects.toThrow('Maximum allowed depth is 10 levels');
    });

    it('should move a project under a sibling that is not its descendant', async () => {
      // Historical note: this case used to exercise a BFS isDescendant()
      // check implemented with an explicit queue and Array.prototype.shift().
      // That code path no longer exists (validateMoveConstraints now uses
      // recursive DFS — see getMaxSubtreeDepth), so this just verifies the
      // move itself succeeds and reports the new parent.
      mockAuthManager.isAuthenticated.mockReturnValue(true);
      const projects = [
        { ...mockProject, id: 1, parent_project_id: undefined },
        { ...mockProject, id: 2, parent_project_id: undefined },
        { ...mockProject, id: 3, parent_project_id: 1 },
        { ...mockProject, id: 4, parent_project_id: 1 },
      ];
      mockClient.projects.getProjects.mockResolvedValueOnce(projects);
      mockClient.projects.updateProject.mockResolvedValueOnce({
        ...projects[0],
        parent_project_id: 2,
      });

      // Move project 1 to be under project 2 (not a descendant, so should succeed)
      const result = await callTool('move', { id: 1, parentProjectId: 2 });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('move_project');
      expect(mockClient.projects.updateProject).toHaveBeenCalledWith(1, {
        ...projects[0],
        parent_project_id: 2,
      });
    });
  });
});
