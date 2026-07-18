import { TaskCreationService } from '../../src/services/TaskCreationService';
import { MCPError, ErrorCode } from '../../src/types';
import type { TypedVikunjaClient } from '../../src/types/node-vikunja-extended';
import type { ImportedTask } from '../../src/parsers/InputParserFactory';
import type { Task, Label, User } from 'node-vikunja';
import { isAuthenticationError } from '../../src/utils/auth-error-handler';
import { AuthManager } from '../../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Mock dependencies
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/auth-error-handler');

// Import mocked logger for assertions
import { logger } from '../../src/utils/logger';

// `createBaseTask` is migrated off node-vikunja onto the direct-REST helper
// (`PUT /projects/{id}/tasks`); label/assignee/reminder handling stays on
// the node-vikunja client (`mockClient`) — those domains' node-vikunja
// retirement is a separate item's scope.
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

/** URL and method used on the Nth `fetch` call. */
function fetchCall(callIndex: number): { url: string; method: string } {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return { url: call[0], method: call[1].method as string };
}

/** Parses the JSON body sent on the Nth `fetch` call. */
function fetchBody(callIndex: number): any {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

describe('TaskCreationService', () => {
  let taskCreationService: TaskCreationService;
  let mockClient: jest.Mocked<TypedVikunjaClient>;
  let authManager: AuthManager;
  let mockEntityMaps: any;
  let mockTask: ImportedTask;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats so one test's deliberately
    // failing scenario doesn't trip the breaker for a later test.
    circuitBreakerRegistry.clear();

    taskCreationService = new TaskCreationService();

    // Setup mock client
    mockClient = {
      tasks: {
        getTask: jest.fn(),
        updateTaskLabels: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        assignUserToTask: jest.fn(),
      },
    } as jest.Mocked<TypedVikunjaClient>;

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    // Setup mock entity maps
    mockEntityMaps = {
      labelMap: new Map([
        ['urgent', 1],
        ['bug', 2],
        ['feature', 3],
      ]),
      userMap: new Map([
        ['john', 101],
        ['jane', 102],
      ]),
      projectUsers: [
        { id: 101, username: 'john' } as User,
        { id: 102, username: 'jane' } as User,
      ],
    };

    // Setup mock task
    mockTask = {
      title: 'Test Task',
      description: 'Test description',
      priority: 3,
      done: false,
      labels: ['urgent', 'bug'],
      assignees: ['john', 'jane'],
      dueDate: '2024-12-31',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      hexColor: '#ff0000',
      repeatAfter: 3600,
      repeatMode: 1, // week
      percentDone: 50,
    };
  });

  describe('createTask', () => {
    it('should create a task successfully with all properties', async () => {
      // Arrange
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
        percent_done: 50,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockResolvedValue({});
      mockClient.tasks.getTask.mockResolvedValue({
        ...createdTask,
        labels: [
          { id: 1, title: 'urgent' } as Label,
          { id: 2, title: 'bug' } as Label,
        ],
      });
      mockClient.tasks.assignUserToTask.mockResolvedValue({});

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.taskId).toBe(123);
      expect(result.title).toBe('Test Task');
      expect(result.warnings).toBeUndefined();

      expect(fetchCall(0)).toEqual({
        url: 'https://vikunja.test/api/v1/projects/456/tasks',
        method: 'PUT',
      });
      expect(fetchBody(0)).toEqual({
        project_id: 456,
        title: 'Test Task',
        done: false,
        priority: 3,
        percent_done: 50,
        description: 'Test description',
        due_date: '2024-12-31',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        hex_color: '#ff0000',
        repeat_after: 3600,
        repeat_mode: 'week',
      });
    });

    it('should handle task creation with minimal properties', async () => {
      // Arrange
      const minimalTask: ImportedTask = {
        title: 'Minimal Task',
      };
      const createdTask: Task = {
        id: 124,
        title: 'Minimal Task',
        done: false,
        priority: 0,
        percent_done: 0,
      } as Task;

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        minimalTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.taskId).toBe(124);
      expect(fetchBody(0)).toEqual({
        project_id: 456,
        title: 'Minimal Task',
        done: false,
        priority: 0,
        percent_done: 0,
      });
    });

    it('should handle authentication error during task creation', async () => {
      // Arrange
      const authError = new Error('Authentication failed');
      (isAuthenticationError as jest.Mock).mockReturnValue(true);

      mockFetch.mockRejectedValue(authError);

      // Act & Assert
      await expect(
        taskCreationService.createTask(mockTask, 456, mockClient, authManager, mockEntityMaps)
      ).rejects.toThrow(MCPError);

      // isAuthenticationError is called with the original network-level
      // error during vikunjaRestRequest's own transient-failure
      // classification, before createBaseTask's catch runs.
      expect(isAuthenticationError).toHaveBeenCalledWith(authError);
    });

    it('should bubble up MCPError exceptions regardless of catchErrors parameter', async () => {
      // Post-migration, createBaseTask can only ever throw a real MCPError
      // via its deliberate authentication-error branch — any other
      // transport failure is unwrapped back to a plain Error so it respects
      // `catchErrors` (see the comment on that branch). Exercise the
      // MCPError-bypasses-catchErrors mechanism through that branch.
      (isAuthenticationError as jest.Mock).mockReturnValue(true);
      mockFetch.mockRejectedValue(new Error('Authentication failed'));

      // Act & Assert - Should bubble up even with catchErrors=true
      await expect(
        taskCreationService.createTask(mockTask, 456, mockClient, authManager, mockEntityMaps, true)
      ).rejects.toThrow(MCPError);

      // Act & Assert - Should also bubble up with catchErrors=false
      await expect(
        taskCreationService.createTask(mockTask, 456, mockClient, authManager, mockEntityMaps, false)
      ).rejects.toThrow(MCPError);
    });

    it('should let errors bubble up when catchErrors is false', async () => {
      // Arrange
      const apiError = new Error('API rate limit exceeded');
      (isAuthenticationError as jest.Mock).mockReturnValue(false);

      mockFetch.mockRejectedValue(apiError);

      // Act & Assert
      await expect(
        taskCreationService.createTask(mockTask, 456, mockClient, authManager, mockEntityMaps, false)
      ).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle general API error during task creation', async () => {
      // Arrange
      const apiError = new Error('API rate limit exceeded');
      (isAuthenticationError as jest.Mock).mockReturnValue(false);

      mockFetch.mockRejectedValue(apiError);

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(false);
      // The direct-REST helper prefixes the original message with its own
      // "Vikunja REST request failed (...)" context, so this is now a
      // substring match rather than an exact one.
      expect(result.error).toContain('API rate limit exceeded');
    });
  });

  describe('Label Assignment', () => {
    it('should successfully assign and verify labels', async () => {
      // Arrange
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockResolvedValue({});
      mockClient.tasks.getTask.mockResolvedValue({
        ...createdTask,
        labels: [
          { id: 1, title: 'urgent' } as Label,
          { id: 2, title: 'bug' } as Label,
        ],
      });

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
      expect(mockClient.tasks.updateTaskLabels).toHaveBeenCalledWith(123, {
        labels: [{ id: 1 }, { id: 2 }],
      });
      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(123);
    });

    it('should handle silent label assignment failure', async () => {
      // Arrange
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockResolvedValue({});
      mockClient.tasks.getTask.mockResolvedValue({
        ...createdTask,
        labels: [], // No labels assigned despite successful API call
      });

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Labels specified but not assigned');
    });

    it('should handle label assignment authentication error', async () => {
      // Arrange
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;
      const labelError = new Error('Insufficient permissions');
      (isAuthenticationError as jest.Mock).mockReturnValue(true);

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockRejectedValue(labelError);

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Label assignment requires JWT authentication');
    });

    it('should handle label assignment general error', async () => {
      // Arrange
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;
      const labelError = new Error('Network error');
      (isAuthenticationError as jest.Mock).mockReturnValue(false);

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockRejectedValue(labelError);

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Failed to assign labels: Network error');
    });

    it('should handle labels that are not found', async () => {
      // Arrange
      const taskWithUnknownLabels: ImportedTask = {
        ...mockTask,
        labels: ['urgent', 'unknown', 'bug'],
      };
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockResolvedValue({});
      mockClient.tasks.getTask.mockResolvedValue({
        ...createdTask,
        labels: [
          { id: 1, title: 'urgent' } as Label,
          { id: 2, title: 'bug' } as Label,
        ],
      });

      // Act
      const result = await taskCreationService.createTask(
        taskWithUnknownLabels,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Labels not found: unknown');
    });

    it('should handle label verification failure', async () => {
      // Arrange
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockResolvedValue({});
      mockClient.tasks.getTask.mockRejectedValue(new Error('Verification failed'));

      // Act
      const result = await taskCreationService.createTask(
        mockTask,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Labels specified but not assigned');
    });
  });

  describe('User Assignment', () => {
    it('should successfully assign users', async () => {
      // Arrange
      const taskWithoutLabels: ImportedTask = {
        ...mockTask,
        labels: [], // Remove labels to isolate user assignment testing
      };
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        taskWithoutLabels,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(123, 101);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(123, 102);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle user assignment when no users are available', async () => {
      // Arrange
      const taskWithoutLabels: ImportedTask = {
        ...mockTask,
        labels: [], // Remove labels to isolate user assignment testing
      };
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;
      const entityMapsWithNoUsers = {
        ...mockEntityMaps,
        projectUsers: [],
      };

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        taskWithoutLabels,
        456,
        mockClient,
        authManager,
        entityMapsWithNoUsers
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Assignees skipped due to user fetch failure');
      expect(mockClient.tasks.assignUserToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle user assignment error', async () => {
      // Arrange
      const taskWithoutLabels: ImportedTask = {
        ...mockTask,
        labels: [], // Remove labels to isolate user assignment testing
      };
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.assignUserToTask.mockRejectedValue(new Error('User assignment failed'));

      // Act
      const result = await taskCreationService.createTask(
        taskWithoutLabels,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Failed to assign users: User assignment failed');
    });

    it('should handle users that are not found', async () => {
      // Arrange
      const taskWithUnknownUsers: ImportedTask = {
        ...mockTask,
        assignees: ['john', 'unknown', 'jane'],
        labels: [], // Remove labels to isolate user assignment testing
      };
      const createdTask: Task = {
        id: 123,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.assignUserToTask.mockResolvedValue({});

      // Act
      const result = await taskCreationService.createTask(
        taskWithUnknownUsers,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Users not found: unknown');
      // Only found users are assigned, one additive call each
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(123, 101);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(123, 102);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });
  });

  describe('Reminder Handling', () => {
    it('should handle reminders with API limitation warning', async () => {
      // Arrange
      const taskWithReminders: ImportedTask = {
        title: 'Test Task with Reminders',
        reminders: [
          { reminder: '2024-12-31T10:00:00Z' },
          { reminder: '2024-11-30T09:00:00Z' },
        ],
        labels: [], // Remove labels to isolate reminder testing
        assignees: [], // Remove assignees to isolate reminder testing
      };
      const createdTask: Task = {
        id: 123,
        title: 'Test Task with Reminders',
        done: false,
        priority: 0,
      } as Task;

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        taskWithReminders,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings![0]).toContain('Reminders cannot be added after task creation');
      expect(logger.warn).toHaveBeenCalledWith('Reminders cannot be added after task creation', {
        taskId: 123,
        reminders: [
          { reminder: '2024-12-31T10:00:00Z' },
          { reminder: '2024-11-30T09:00:00Z' },
        ],
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty arrays for optional properties', async () => {
      // Arrange
      const taskWithEmptyArrays: ImportedTask = {
        title: 'Task with empty arrays',
        labels: [],
        assignees: [],
        reminders: [],
      };
      const createdTask: Task = {
        id: 125,
        title: 'Task with empty arrays',
        done: false,
        priority: 0,
      } as Task;

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        taskWithEmptyArrays,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
      expect(mockClient.tasks.updateTaskLabels).not.toHaveBeenCalled();
      expect(mockClient.tasks.assignUserToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle undefined optional properties', async () => {
      // Arrange
      const taskWithUndefined: ImportedTask = {
        title: 'Task with undefined properties',
        description: undefined,
        labels: undefined,
        assignees: undefined,
        reminders: undefined,
      };
      const createdTask: Task = {
        id: 126,
        title: 'Task with undefined properties',
        done: false,
        priority: 0,
      } as Task;

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        taskWithUndefined,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
      expect(fetchBody(0)).toEqual({
        project_id: 456,
        title: 'Task with undefined properties',
        done: false,
        priority: 0,
        percent_done: 0,
      });
    });

    it('should handle invalid repeat mode', async () => {
      // Arrange
      const taskWithInvalidRepeatMode: ImportedTask = {
        ...mockTask,
        repeatMode: 10, // Invalid mode
      };
      const createdTask: Task = {
        id: 127,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);

      // Act
      const result = await taskCreationService.createTask(
        taskWithInvalidRepeatMode,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      // repeat_mode should not be included in the call
      expect(fetchBody(0)).not.toHaveProperty('repeat_mode');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle multiple warnings from different operations', async () => {
      // Arrange
      const taskWithMultipleIssues: ImportedTask = {
        ...mockTask,
        labels: ['urgent', 'unknown'], // One valid, one not found
        assignees: ['john', 'unknown'], // One valid, one not found
        reminders: [{ reminder: '2024-12-31T10:00:00Z' }],
      };
      const createdTask: Task = {
        id: 128,
        title: 'Test Task',
        done: false,
        priority: 3,
      } as Task;

      fetchOkOnce(createdTask);
      mockClient.tasks.updateTaskLabels.mockResolvedValue({});
      mockClient.tasks.getTask.mockResolvedValue(createdTask); // Simulate label verification failure
      mockClient.tasks.assignUserToTask.mockResolvedValue({});

      // Act
      const result = await taskCreationService.createTask(
        taskWithMultipleIssues,
        456,
        mockClient,
        authManager,
        mockEntityMaps
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(4);
      expect(result.warnings![0]).toContain('Labels not found: unknown');
      expect(result.warnings![1]).toContain('Labels specified but not assigned'); // Due to verification failure
      expect(result.warnings![2]).toContain('Users not found: unknown');
      expect(result.warnings![3]).toContain('Reminders cannot be added after task creation');
    });
  });
});
