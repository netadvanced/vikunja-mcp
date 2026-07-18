import { applyLabels, removeLabels, listTaskLabels } from '../../../src/tools/tasks/labels';
import { getClientFromContext } from '../../../src/client';
import { AuthManager } from '../../../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../../../src/utils/retry';
import { MCPError } from '../../../src/types/index';

// applyLabels/removeLabels/listTaskLabels now call the direct-REST helper
// (vikunjaRestRequest) for the label-on-task endpoints, but still fetch the
// task itself via node-vikunja's client.tasks.getTask (a deliberate
// leftover — GET /tasks/{id} is task CRUD, owned by a different wave item),
// so both a mocked client and a mocked global fetch are needed.
jest.mock('../../../src/client', () => ({
  getClientFromContext: jest.fn(),
}));

// Mock withRetry to call the operation directly without circuit breaker caching
jest.mock('../../../src/utils/retry', () => ({
  ...jest.requireActual('../../../src/utils/retry'),
  withRetry: async <T>(operation: () => Promise<T>) => operation(),
}));
const mockGetClientFromContext = jest.mocked(getClientFromContext);

describe('Label operations', () => {
  const mockClient = {
    tasks: {
      getTask: jest.fn(),
    },
  };

  let authManager: AuthManager;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  const restOk = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn(async () => JSON.stringify(body)),
    }) as unknown as Response;

  const restError = (status: number, statusText: string, body = ''): Response =>
    ({
      ok: false,
      status,
      statusText,
      text: jest.fn(async () => body),
    }) as unknown as Response;

  beforeEach(() => {
    // Use resetAllMocks to also reset mock implementations (not just call history)
    jest.resetAllMocks();
    circuitBreakerRegistry.clear();
    mockGetClientFromContext.mockResolvedValue(mockClient as any);

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Default: task has no labels yet, and label writes succeed.
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/labels')) {
        return Promise.resolve(restOk([]));
      }
      return Promise.resolve(restOk({}));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('applyLabels', () => {
    it('should apply labels to a task successfully', async () => {
      const mockTask = {
        id: 1,
        title: 'Test Task',
        labels: [{ id: 1, title: 'research', hex_color: '3498db' }],
      };

      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await applyLabels({ id: 1, labels: [1] }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/labels',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ label_id: 1 }) }),
      );
      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain('Label applied to task successfully');
    });

    it('should throw error if task id is missing', async () => {
      await expect(applyLabels({ labels: [1] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should throw error if labels array is empty', async () => {
      await expect(applyLabels({ id: 1, labels: [] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should handle multiple labels', async () => {
      const mockTask = { id: 1, title: 'Test Task', labels: [] };
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(2);
      expect(result.content[0].text).toContain('Labels applied to task successfully');
    });

    it('should skip labels already present on the task', async () => {
      const mockTask = { id: 1, title: 'Test Task', labels: [] };
      // Label 1 is already on the task; only label 2 should be applied.
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([{ id: 1, title: 'research' }]));
        }
        return Promise.resolve(restOk({}));
      });
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.[1]).toMatchObject({ body: JSON.stringify({ label_id: 2 }) });
      expect(result.content[0].text).toContain('already present');
    });

    it('should not abort when a label is already on the task', async () => {
      const mockTask = { id: 1, title: 'Test Task', labels: [] };
      // GET /labels reports nothing, but the first PUT races and rejects the
      // first label as a duplicate; the rest must still be applied.
      let putCalls = 0;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([]));
        }
        if (init?.method === 'PUT') {
          putCalls += 1;
          if (putCalls === 1) {
            return Promise.resolve(restError(400, 'Bad Request', 'This label already exists on the task'));
          }
          return Promise.resolve(restOk({}));
        }
        return Promise.resolve(restOk({}));
      });
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      expect(putCalls).toBe(2);
      expect(result.content[0].text).toContain('Label applied to task successfully');
    });

    it('should report when every requested label is already present', async () => {
      const mockTask = { id: 1, title: 'Test Task', labels: [] };
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(
            restOk([
              { id: 1, title: 'research' },
              { id: 2, title: 'ops' },
            ]),
          );
        }
        return Promise.resolve(restOk({}));
      });
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(0);
      expect(result.content[0].text).toContain('No labels applied');
    });

    it('should handle API errors gracefully', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([]));
        }
        return Promise.resolve(restError(400, 'Bad Request', 'API Error'));
      });

      await expect(applyLabels({ id: 1, labels: [1] }, authManager)).rejects.toThrow(MCPError);
    });
  });

  describe('removeLabels', () => {
    it('should remove labels from a task successfully', async () => {
      const mockTask = { id: 1, title: 'Test Task', labels: null };
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await removeLabels({ id: 1, labels: [1] }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/labels/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.content[0].text).toContain('Label removed from task successfully');
    });

    it('should throw error if task id is missing', async () => {
      await expect(removeLabels({ labels: [1] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should throw error if labels array is empty', async () => {
      await expect(removeLabels({ id: 1, labels: [] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should handle multiple labels removal', async () => {
      const mockTask = { id: 1, title: 'Test Task', labels: null };
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await removeLabels({ id: 1, labels: [1, 2] }, authManager);

      const deleteCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(2);
      expect(result.content[0].text).toContain('Labels removed from task successfully');
    });
  });

  describe('listTaskLabels', () => {
    it('should list labels for a task successfully', async () => {
      const mockTask = { id: 1, title: 'Test Task' };
      fetchMock.mockResolvedValue(restOk([{ id: 1, title: 'research', hex_color: '3498db' }]));
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await listTaskLabels({ id: 1 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/labels',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].text).toContain('Task has 1 label(s)');
    });

    it('should throw error if task id is missing', async () => {
      await expect(listTaskLabels({}, authManager)).rejects.toThrow(MCPError);
    });

    it('should handle task with no labels', async () => {
      const mockTask = { id: 1, title: 'Test Task' };
      fetchMock.mockResolvedValue(restOk([]));
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await listTaskLabels({ id: 1 }, authManager);

      expect(result.content[0].text).toContain('Task has 0 label(s)');
    });

    it('should handle undefined task id', async () => {
      await expect(listTaskLabels({ id: undefined }, authManager)).rejects.toThrow(MCPError);
    });
  });
});
