/**
 * Tests for project Kanban bucket operations (`list-buckets`,
 * `create-bucket`, `update-bucket`, `delete-bucket`, `list-view-tasks`).
 *
 * Covers id validation, view auto-resolution vs an explicit viewId, empty and
 * non-array bucket responses, optional bucket fields, bucketTitle resolution
 * for update/delete, fetch-merge-POST payload assertions for update-bucket,
 * and error propagation.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import {
  listBuckets,
  createBucket,
  updateBucket,
  deleteBucket,
  listViewTasks,
} from '../../../src/tools/projects/buckets';
import { MCPError, ErrorCode } from '../../../src/types';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

// Mock global fetch
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

/** A views payload containing a Kanban view (id 11) whose done bucket is 101. */
const kanbanViews = JSON.stringify([
  { id: 10, title: 'List', project_id: 5, view_kind: 'list' },
  { id: 11, title: 'Kanban', project_id: 5, view_kind: 'kanban', done_bucket_id: 101 },
]);

describe('listBuckets', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats between tests so a
    // deliberately failing scenario doesn't trip the breaker for a later
    // test sharing the same auto-derived breaker name.
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  describe('validation', () => {
    it('throws a VALIDATION_ERROR when the project id is missing', async () => {
      await expect(listBuckets({}, authManager)).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'Project id is required for list-buckets operation',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws a VALIDATION_ERROR when the project id is zero (falsy)', async () => {
      await expect(listBuckets({ id: 0 }, authManager)).rejects.toThrow(
        'Project id is required for list-buckets operation',
      );
    });

    it('throws when the project id is not a positive integer', async () => {
      await expect(listBuckets({ id: -3 }, authManager)).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('throws when an explicit viewId is invalid', async () => {
      await expect(listBuckets({ id: 5, viewId: 0 }, authManager)).rejects.toThrow(
        'viewId must be a positive integer',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('view resolution', () => {
    it('resolves the Kanban view id when viewId is omitted', async () => {
      // 1) GET /projects/:id/views  2) GET buckets
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: kanbanViews }))
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify([
              {
                id: 100,
                title: 'Backlog',
                project_view_id: 11,
                position: 0,
                limit: 0,
              },
              {
                id: 101,
                title: 'Done',
                project_view_id: 11,
                position: 1,
                limit: 5,
              },
            ]),
          }),
        );

      const result = await listBuckets({ id: 5 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const urls = mockFetch.mock.calls.map((c) => c[0]);
      expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views');
      expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');

      const text = result.content[0].text;
      expect(text).toContain('Found 2 buckets in the Kanban view of project 5');
      expect(text).toContain('Backlog');
      expect(text).toContain('Done');
    });

    it('flags the bucket matching the view done_bucket_id as isDoneBucket, and no others', async () => {
      // The Kanban view (id 11) has done_bucket_id 101 — bucket.is_done_bucket
      // does not exist on models.Bucket, so this must be resolved from the view.
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: kanbanViews }))
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify([
              { id: 100, title: 'Backlog', project_view_id: 11, position: 0 },
              { id: 101, title: 'Done', project_view_id: 11, position: 1 },
            ]),
          }),
        );

      const result = await listBuckets({ id: 5 }, authManager);
      const text = result.content[0].text;

      // Bucket 101 ("Done") matches the view's done_bucket_id.
      const doneIndex = text.indexOf('"id": 101');
      const backlogIndex = text.indexOf('"id": 100');
      expect(doneIndex).toBeGreaterThan(-1);
      expect(backlogIndex).toBeGreaterThan(-1);
      // The bucket with id 101 is flagged done; the one with id 100 is not.
      expect(text.slice(doneIndex, doneIndex + 120)).toContain('"isDoneBucket": true');
      expect(text.slice(backlogIndex, backlogIndex + 120)).toContain('"isDoneBucket": false');
    });

    it('uses an explicit viewId without resolving the Kanban view', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify([{ id: 100, title: 'Backlog' }]),
        }),
      );

      const result = await listBuckets({ id: 5, viewId: 42 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v1/projects/5/views/42/buckets');
      expect(result.content[0].text).toContain('Found 1 buckets');
    });

    it('throws NOT_FOUND when the project has no Kanban view', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify([
            { id: 10, title: 'List', project_id: 5, view_kind: 'list' },
          ]),
        }),
      );

      await expect(listBuckets({ id: 5 }, authManager)).rejects.toThrow(
        'Project 5 has no Kanban view, so it has no buckets',
      );
    });
  });

  describe('bucket response handling', () => {
    it('returns an empty bucket list when the API returns an empty array', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

      const result = await listBuckets({ id: 5, viewId: 11 }, authManager);

      expect(result.content[0].text).toContain('Found 0 buckets');
    });

    it('treats a non-array bucket response as an empty list', async () => {
      // An empty 2xx body resolves to null inside vikunjaRestRequest.
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      const result = await listBuckets({ id: 5, viewId: 11 }, authManager);

      expect(result.content[0].text).toContain('Found 0 buckets');
    });

    it('defaults isDoneBucket to false when the field is absent', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify([{ id: 100, title: 'Backlog' }]),
        }),
      );

      const result = await listBuckets({ id: 5, viewId: 11 }, authManager);

      const text = result.content[0].text;
      expect(text).toContain('Found 1 buckets');
      expect(text).toContain('"isDoneBucket": false');
    });

    it('passes a session id through to the response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

      const result = await listBuckets(
        { id: 5, viewId: 11, sessionId: 'sess-9' },
        authManager,
      );

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Success');
    });
  });

  describe('error propagation', () => {
    it('propagates an HTTP error from the buckets request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: 'view does not exist',
        }),
      );

      await expect(
        listBuckets({ id: 5, viewId: 11 }, authManager),
      ).rejects.toThrow(MCPError);
    });

    it('propagates a network error raised while resolving the view', async () => {
      mockFetch.mockRejectedValueOnce(new Error('offline'));

      await expect(listBuckets({ id: 5 }, authManager)).rejects.toThrow(
        'Vikunja REST request failed (GET /projects/5/views): offline',
      );
    });
  });
});

describe('createBucket', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  it('throws a VALIDATION_ERROR when the project id is missing', async () => {
    await expect(createBucket({ title: 'Doing' }, authManager)).rejects.toThrow(
      'Project id is required for create-bucket operation',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a VALIDATION_ERROR when title is missing', async () => {
    await expect(createBucket({ id: 5 }, authManager)).rejects.toThrow(
      'title is required for create-bucket operation',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when limit is negative', async () => {
    await expect(
      createBucket({ id: 5, viewId: 11, title: 'Doing', limit: -1 }, authManager),
    ).rejects.toThrow('limit must be a non-negative integer');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('resolves the Kanban view id and sends the exact title payload', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: kanbanViews }))
      .mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 200, title: 'Doing', position: 2 }) }),
      );

    const result = await createBucket({ id: 5, title: '  Doing  ' }, authManager);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views');
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ title: 'Doing' }));

    expect(result.content[0].text).toContain(
      'Bucket "Doing" created in the Kanban view of project 5',
    );
  });

  it('includes limit in the payload when provided, using an explicit viewId', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ text: JSON.stringify({ id: 201, title: 'Doing', limit: 5 }) }),
    );

    await createBucket({ id: 5, viewId: 11, title: 'Doing', limit: 5 }, authManager);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');
    expect(init.body).toBe(JSON.stringify({ title: 'Doing', limit: 5 }));
  });

  it('throws when position is negative', async () => {
    await expect(
      createBucket({ id: 5, viewId: 11, title: 'Blocked', position: -1 }, authManager),
    ).rejects.toThrow('position must be a non-negative number');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes position in the payload when provided (fractional values allowed)', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ text: JSON.stringify({ id: 202, title: 'Blocked', position: 250.5 }) }),
    );

    await createBucket({ id: 5, viewId: 11, title: 'Blocked', position: 250.5 }, authManager);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');
    expect(init.body).toBe(JSON.stringify({ title: 'Blocked', position: 250.5 }));
  });

  it('propagates an HTTP error from the create request', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 400, statusText: 'Bad Request', text: 'invalid bucket' }),
    );

    await expect(
      createBucket({ id: 5, viewId: 11, title: 'Doing' }, authManager),
    ).rejects.toThrow(MCPError);
  });
});

describe('updateBucket', () => {
  let authManager: AuthManager;

  const currentBuckets = JSON.stringify([
    { id: 100, title: 'Backlog', project_view_id: 11, position: 0, limit: 0 },
    { id: 101, title: 'Done', project_view_id: 11, position: 1, limit: 5 },
  ]);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  it('throws a VALIDATION_ERROR when the project id is missing', async () => {
    await expect(updateBucket({ bucketId: 100, title: 'x' }, authManager)).rejects.toThrow(
      'Project id is required for update-bucket operation',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a VALIDATION_ERROR when no update fields are provided', async () => {
    await expect(
      updateBucket({ id: 5, viewId: 11, bucketId: 100 }, authManager),
    ).rejects.toThrow('No fields to update provided for update-bucket operation');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when limit is negative', async () => {
    await expect(
      updateBucket({ id: 5, viewId: 11, bucketId: 100, limit: -1 }, authManager),
    ).rejects.toThrow('limit must be a non-negative integer');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a VALIDATION_ERROR when neither bucketId nor bucketTitle is provided', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: currentBuckets }));

    await expect(
      updateBucket({ id: 5, viewId: 11, title: 'Renamed' }, authManager),
    ).rejects.toThrow('bucketId or bucketTitle is required');
  });

  it('fetches the current bucket by id, merges, and POSTs the full model', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 100, title: 'Renamed', limit: 0 }) }),
      );

    const result = await updateBucket(
      { id: 5, viewId: 11, bucketId: 100, title: 'Renamed' },
      authManager,
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets/100');

    const [, postInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(postInit.method).toBe('POST');
    // Full merged bucket: id/project_view_id/position/limit preserved from
    // the fetched bucket, only title overlaid.
    expect(postInit.body).toBe(
      JSON.stringify({
        id: 100,
        title: 'Renamed',
        project_view_id: 11,
        position: 0,
        limit: 0,
      }),
    );
    expect(result.content[0].text).toContain(
      'Bucket 100 in the Kanban view of project 5 updated',
    );
  });

  it('resolves a bucket by bucketTitle when bucketId is omitted', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 101, limit: 10 }) }));

    await updateBucket({ id: 5, viewId: 11, bucketTitle: 'Done', limit: 10 }, authManager);

    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets/101');
  });

  it('throws NOT_FOUND when bucketTitle matches no bucket', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: currentBuckets }));

    await expect(
      updateBucket({ id: 5, viewId: 11, bucketTitle: 'Nope', title: 'x' }, authManager),
    ).rejects.toThrow('No bucket titled "Nope" found in project 5\'s Kanban view');
  });

  it('throws NOT_FOUND when bucketId matches no bucket', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: currentBuckets }));

    await expect(
      updateBucket({ id: 5, viewId: 11, bucketId: 999, title: 'x' }, authManager),
    ).rejects.toThrow("Bucket 999 not found in project 5's Kanban view");
  });

  it('resolves the Kanban view id when viewId is omitted', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: kanbanViews }))
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 100, limit: 3 }) }));

    await updateBucket({ id: 5, bucketId: 100, limit: 3 }, authManager);

    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views');
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');
    expect(urls[2]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets/100');
  });

  it('throws when position is negative', async () => {
    await expect(
      updateBucket({ id: 5, viewId: 11, bucketId: 100, position: -0.5 }, authManager),
    ).rejects.toThrow('position must be a non-negative number');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts position as the sole update field and overlays it on the merged model', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 100, title: 'Backlog', position: 250 }) }),
      );

    await updateBucket({ id: 5, viewId: 11, bucketId: 100, position: 250 }, authManager);

    const [, postInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(postInit.body).toBe(
      JSON.stringify({
        id: 100,
        title: 'Backlog',
        project_view_id: 11,
        position: 250,
        limit: 0,
      }),
    );
  });
});

describe('deleteBucket', () => {
  let authManager: AuthManager;

  const currentBuckets = JSON.stringify([
    { id: 100, title: 'Backlog', project_view_id: 11, position: 0 },
    { id: 101, title: 'Done', project_view_id: 11, position: 1 },
  ]);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  it('throws a VALIDATION_ERROR when the project id is missing', async () => {
    await expect(deleteBucket({ bucketId: 100 }, authManager)).rejects.toThrow(
      'Project id is required for delete-bucket operation',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('resolves a bucket by id and sends a DELETE', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ message: 'ok' }) }));

    const result = await deleteBucket({ id: 5, viewId: 11, bucketId: 100 }, authManager);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets');
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets/100');

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(result.content[0].text).toContain(
      'Bucket 100 ("Backlog") deleted from the Kanban view of project 5',
    );
  });

  it('resolves a bucket by bucketTitle', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(mockResponse({ text: '' }));

    await deleteBucket({ id: 5, viewId: 11, bucketTitle: 'Done' }, authManager);

    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets/101');
  });

  it('throws NOT_FOUND when the bucket does not exist', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: currentBuckets }));

    await expect(
      deleteBucket({ id: 5, viewId: 11, bucketId: 999 }, authManager),
    ).rejects.toThrow("Bucket 999 not found in project 5's Kanban view");
  });

  it('propagates an HTTP error from the delete request', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: currentBuckets }))
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: 'gone' }),
      );

    await expect(
      deleteBucket({ id: 5, viewId: 11, bucketId: 100 }, authManager),
    ).rejects.toThrow(MCPError);
  });
});

describe('listViewTasks', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  it('throws a VALIDATION_ERROR when the project id is missing', async () => {
    await expect(listViewTasks({}, authManager)).rejects.toThrow(
      'Project id is required for list-view-tasks operation',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('resolves the Kanban view id and lists tasks with no query string when unpaginated', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ text: kanbanViews }))
      .mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify([{ id: 1, title: 'Task 1' }]) }),
      );

    const result = await listViewTasks({ id: 5 }, authManager);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views');
    expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views/11/tasks');

    expect(result.content[0].text).toContain('Found 1 item(s) in view 11 of project 5');
  });

  it('passes page and per_page as query params, and an explicit viewId', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

    await listViewTasks({ id: 5, viewId: 11, page: 2, perPage: 25 }, authManager);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      'https://vikunja.test/api/v1/projects/5/views/11/tasks?page=2&per_page=25',
    );
  });

  it('treats a non-array response as an empty list', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

    const result = await listViewTasks({ id: 5, viewId: 11 }, authManager);

    expect(result.content[0].text).toContain('Found 0 item(s)');
  });

  it('propagates an HTTP error from the tasks request', async () => {
    // 500 is retryable under the default policy, so every retry attempt
    // must see the same response.
    mockFetch.mockResolvedValue(
      mockResponse({ ok: false, status: 500, statusText: 'Server Error', text: 'boom' }),
    );

    await expect(listViewTasks({ id: 5, viewId: 11 }, authManager)).rejects.toThrow(MCPError);
  });
});
