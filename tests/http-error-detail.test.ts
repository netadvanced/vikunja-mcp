/**
 * Tests for `src/utils/http-error-detail.ts` and the integration with
 * `updateTaskLabels` in `TaskUpdateService`.
 *
 * Verifies that a label-update failure surfaces the real HTTP status + body
 * of the underlying Vikunja error instead of being replaced with the
 * generic LABEL_UPDATE "known limitation" message.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { extractHttpErrorDetail, extractHttpStatus } from '../src/utils/http-error-detail';
import { updateTask } from '../src/tools/tasks/crud/TaskUpdateService';
import { getClientFromContext, getAuthManagerFromContext } from '../src/client';
import { vikunjaRestRequest } from '../src/utils/vikunja-rest';
import { isAuthenticationError } from '../src/utils/auth-error-handler';
import { MCPError } from '../src/types';
import type { AuthManager } from '../src/auth/AuthManager';

jest.mock('../src/client');
jest.mock('../src/utils/vikunja-rest');
jest.mock('../src/utils/auth-error-handler');
jest.mock('../src/utils/logger');

describe('extractHttpStatus', () => {
  it('reads `.status` when present', () => {
    const err = Object.assign(new Error('boom'), { status: 403 });
    expect(extractHttpStatus(err)).toBe(403);
  });

  it('reads `.statusCode` as a fallback', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 422 });
    expect(extractHttpStatus(err)).toBe(422);
  });

  it('reads `.response.status` (axios-style)', () => {
    const err = Object.assign(new Error('boom'), { response: { status: 401 } });
    expect(extractHttpStatus(err)).toBe(401);
  });

  it('returns null when no HTTP signal is available', () => {
    expect(extractHttpStatus(new Error('plain'))).toBeNull();
  });

  it('returns null for non-Error values', () => {
    expect(extractHttpStatus('nope')).toBeNull();
    expect(extractHttpStatus(undefined)).toBeNull();
  });
});

describe('extractHttpErrorDetail', () => {
  it('includes status and JSON-stringified response.data', () => {
    const err = Object.assign(new Error('Request failed'), {
      status: 403,
      response: { status: 403, data: { code: 1004, message: 'forbidden' } },
    });
    const detail = extractHttpErrorDetail(err);
    expect(detail).toContain('HTTP 403');
    expect(detail).toContain('forbidden');
    expect(detail).toMatch(/^\(HTTP 403:/);
  });

  it('falls back to error message when no body is present', () => {
    const err = Object.assign(new Error('Request failed with status code 422'), {
      status: 422,
    });
    const detail = extractHttpErrorDetail(err);
    expect(detail).toContain('HTTP 422');
    expect(detail).toContain('Request failed with status code 422');
  });

  it('truncates very long bodies', () => {
    const longBody = 'x'.repeat(2000);
    const err = Object.assign(new Error('boom'), {
      status: 500,
      response: { status: 500, data: longBody },
    });
    const detail = extractHttpErrorDetail(err);
    expect(detail.length).toBeLessThan(500);
    expect(detail).toContain('HTTP 500');
    expect(detail.endsWith('…)')).toBe(true);
  });

  it('returns empty string when no status can be inferred', () => {
    expect(extractHttpErrorDetail(new Error('plain'))).toBe('');
    expect(extractHttpErrorDetail('nope')).toBe('');
  });
});

describe('updateTaskLabels surfaces real HTTP status', () => {
  const TASK_ID = 4242;
  const baseTask = {
    id: TASK_ID,
    title: 'pinned task',
    description: 'existing description',
    project_id: 7,
    priority: 2,
    done: false,
    due_date: '0001-01-01T00:00:00Z',
    labels: [],
    assignees: [],
  } as Record<string, unknown>;

  const mockClient = {
    tasks: {
      getTask: jest.fn(),
      updateTask: jest.fn(),
      bulkAssignUsersToTask: jest.fn(),
      removeUserFromTask: jest.fn(),
    },
  } as Record<string, Record<string, jest.Mock>>;

  const mockAuthManager = {} as AuthManager;

  // Both the core task GET/POST and setTaskLabels' POST /tasks/{id}/labels/bulk
  // (src/utils/label-bulk.ts, migrated to direct REST) flow through the mocked
  // vikunjaRestRequest. Core calls resolve the base task; label failures are
  // injected per-test by rejecting the /labels/bulk path.
  const mockRestRejectingLabels = (err: unknown): void => {
    (vikunjaRestRequest as jest.Mock).mockImplementation(async (_am: unknown, _method: string, path?: unknown) => {
      if (typeof path === 'string' && path.includes('/labels/bulk')) {
        throw err;
      }
      return { ...baseTask };
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue({
      getSession: () => ({ apiUrl: 'https://vikunja.test', apiToken: 'tk_test-token' }),
    });
    // Core task fetch/update and the label-bulk POST all flow through the
    // mocked vikunjaRestRequest; default to resolving the base task.
    (vikunjaRestRequest as jest.Mock).mockResolvedValue({ ...baseTask });
    mockClient.tasks.getTask.mockResolvedValue({ ...baseTask });
    mockClient.tasks.updateTask.mockResolvedValue({ ...baseTask });
  });

  it('propagates HTTP 403 status + body for an auth-classified label failure', async () => {
    (isAuthenticationError as jest.Mock).mockReturnValue(true);
    // vikunjaRestRequest throws an error carrying a top-level `.status`;
    // setTaskLabels rethrows it as a plain Error preserving message + status,
    // so extractHttpErrorDetail can surface "HTTP 403" + the body message.
    mockRestRejectingLabels(Object.assign(new Error('You do not have access'), { status: 403 }));

    let captured: MCPError | null = null;
    try {
      await updateTask({ id: TASK_ID, labels: [5] }, mockAuthManager);
    } catch (err) {
      captured = err instanceof MCPError ? err : null;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain('HTTP 403');
    expect(captured!.message).toContain('You do not have access');
  });

  it('propagates HTTP 422 status + body for a non-auth label failure', async () => {
    (isAuthenticationError as jest.Mock).mockReturnValue(false);
    mockRestRejectingLabels(Object.assign(new Error('Invalid label id'), { status: 422 }));

    let capturedMessage = '';
    try {
      await updateTask({ id: TASK_ID, labels: [99999] }, mockAuthManager);
    } catch (err) {
      capturedMessage = err instanceof MCPError ? err.message : String(err);
    }
    expect(capturedMessage).toContain('Failed to update task labels');
    expect(capturedMessage).toContain('HTTP 422');
    expect(capturedMessage).toContain('Invalid label id');
    expect(capturedMessage).not.toMatch(/^Label operations may have authentication issues/);
  });

  it('preserves the original error when no HTTP status can be inferred', async () => {
    (isAuthenticationError as jest.Mock).mockReturnValue(false);
    // A network-level failure carries no `.status` — this is the "no HTTP
    // status can be inferred" case, distinct from the HTTP-error-response
    // cases above. setTaskLabels rethrows it as a plain status-less Error,
    // so updateTaskLabels preserves the original message unchanged.
    mockRestRejectingLabels(new Error('network blip'));

    let capturedMessage = '';
    try {
      await updateTask({ id: TASK_ID, labels: [5] }, mockAuthManager);
    } catch (err) {
      capturedMessage = err instanceof Error ? err.message : String(err);
    }
    expect(capturedMessage).toContain('network blip');
  });
});
