/**
 * Tests for the attachments read-side subcommands (`list-attachments`,
 * `get-attachment-info`, `delete-attachment`, `download-attachment`).
 *
 * Covers request path/verb correctness against the real spec shapes
 * (`GET /tasks/{id}/attachments`, `DELETE
 * /tasks/{id}/attachments/{attachmentID}`), pagination forwarding,
 * fetch-list-and-filter behavior for get-attachment-info, and the
 * honest no-binary-delivery shape of download-attachment.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import {
  listAttachments,
  getAttachmentInfo,
  deleteAttachment,
  downloadAttachment,
} from '../../../src/tools/tasks/attachments';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

describe('Attachments read-side subcommands', () => {
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;
  let authManager: AuthManager;

  const restOk = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn(async () => JSON.stringify(body)),
    }) as unknown as Response;

  const restError = (status: number, statusText: string, text = ''): Response =>
    ({
      ok: false,
      status,
      statusText,
      text: jest.fn(async () => text),
    }) as unknown as Response;

  /** A TaskAttachment list payload matching the real models.TaskAttachment shape. */
  const attachmentsPayload = [
    {
      id: 1,
      task_id: 42,
      created: '2026-01-01T00:00:00Z',
      created_by: { id: 7, username: 'alice', name: 'Alice' },
      file: { id: 100, name: 'notes.txt', size: 1234, mime: 'text/plain' },
    },
    {
      id: 2,
      task_id: 42,
      created: '2026-01-02T00:00:00Z',
      created_by: { id: 8, username: 'bob', name: 'Bob' },
      file: { id: 101, name: 'plan.pdf', size: 5678, mime: 'application/pdf' },
    },
  ];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('listAttachments', () => {
    it('lists attachments for a task', async () => {
      fetchMock.mockResolvedValue(restOk(attachmentsPayload));

      const result = await listAttachments({ id: 42 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/42/attachments',
        expect.objectContaining({ method: 'GET' }),
      );

      const text = result.content[0].text;
      expect(text).toContain('Task 42 has 2 attachment(s)');
      expect(text).toContain('notes.txt');
      expect(text).toContain('plan.pdf');
    });

    it('forwards page/perPage as page/per_page query params', async () => {
      fetchMock.mockResolvedValue(restOk([]));

      await listAttachments({ id: 42, page: 2, perPage: 10 }, authManager);

      const [url] = fetchMock.mock.calls[0] as [string];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/api/v1/tasks/42/attachments');
      expect(parsed.searchParams.get('page')).toBe('2');
      expect(parsed.searchParams.get('per_page')).toBe('10');
    });

    it('omits the query string when no pagination is supplied', async () => {
      fetchMock.mockResolvedValue(restOk([]));

      await listAttachments({ id: 42 }, authManager);

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://vikunja.test/api/v1/tasks/42/attachments',
      );
    });

    it('treats a non-array response as an empty list', async () => {
      fetchMock.mockResolvedValue(restOk(null));

      const result = await listAttachments({ id: 42 }, authManager);
      expect(result.content[0].text).toContain('Task 42 has 0 attachment(s)');
    });

    it('falls back to null for every field a minimal attachment payload omits', async () => {
      // No id/file/created/created_by at all — every `?? null` fallback in
      // summarizeAttachment must produce null rather than throw.
      fetchMock.mockResolvedValue(restOk([{}]));

      const result = await listAttachments({ id: 42 }, authManager);
      expect(result.content[0].text).toContain('Task 42 has 1 attachment(s)');
      expect(result.content[0].text).toContain('"filename": null');
      expect(result.content[0].text).toContain('"createdBy": null');
    });

    it('requires a task id', async () => {
      await expect(listAttachments({}, authManager)).rejects.toThrow(
        'Task id is required for list-attachments operation',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a non-positive task id', async () => {
      await expect(listAttachments({ id: 0 }, authManager)).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('rejects a non-positive page', async () => {
      await expect(listAttachments({ id: 42, page: -1 }, authManager)).rejects.toThrow(
        'page must be a positive integer',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a non-positive perPage', async () => {
      await expect(listAttachments({ id: 42, perPage: 0 }, authManager)).rejects.toThrow(
        'perPage must be a positive integer',
      );
    });

    it('propagates a non-OK HTTP response', async () => {
      fetchMock.mockResolvedValue(restError(403, 'Forbidden', 'no access'));

      await expect(listAttachments({ id: 42 }, authManager)).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/42/attachments): HTTP 403 Forbidden — no access',
      );
    });
  });

  describe('getAttachmentInfo', () => {
    it('returns metadata for the matching attachment', async () => {
      fetchMock.mockResolvedValue(restOk(attachmentsPayload));

      const result = await getAttachmentInfo({ id: 42, attachmentId: 2 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/42/attachments',
        expect.objectContaining({ method: 'GET' }),
      );

      const text = result.content[0].text;
      expect(text).toContain('plan.pdf');
      expect(text).toContain('5678');
      expect(text).toContain('bob');
      expect(text).not.toContain('notes.txt');
    });

    it('throws NOT_FOUND when the attachment id is not in the list', async () => {
      fetchMock.mockResolvedValue(restOk(attachmentsPayload));

      await expect(
        getAttachmentInfo({ id: 42, attachmentId: 999 }, authManager),
      ).rejects.toThrow(
        'Attachment 999 not found on task 42 on the default page — pass page/perPage to search further pages if the task has many attachments',
      );
    });

    it('gives page-specific guidance in the NOT_FOUND message when a page was requested', async () => {
      fetchMock.mockResolvedValue(restOk(attachmentsPayload));

      await expect(
        getAttachmentInfo({ id: 42, attachmentId: 999, page: 2 }, authManager),
      ).rejects.toThrow(
        'Attachment 999 not found on task 42 on the requested page — pass a different page/perPage to search elsewhere',
      );
    });

    it('requires a task id', async () => {
      await expect(getAttachmentInfo({ attachmentId: 1 }, authManager)).rejects.toThrow(
        'Task id is required for get-attachment-info operation',
      );
    });

    it('requires an attachment id', async () => {
      await expect(getAttachmentInfo({ id: 42 }, authManager)).rejects.toThrow(
        'attachmentId is required for get-attachment-info operation',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a non-positive attachment id', async () => {
      await expect(
        getAttachmentInfo({ id: 42, attachmentId: 0 }, authManager),
      ).rejects.toThrow('attachmentId must be a positive integer');
    });

    it('handles an attachment with no created_by (omitted, not thrown)', async () => {
      fetchMock.mockResolvedValue(
        restOk([{ id: 5, file: { name: 'x.txt', size: 1, mime: 'text/plain' } }]),
      );

      const result = await getAttachmentInfo({ id: 42, attachmentId: 5 }, authManager);
      expect(result.content[0].text).toContain('x.txt');
    });

    it('falls back to null for created_by sub-fields it omits', async () => {
      fetchMock.mockResolvedValue(restOk([{ id: 5, created_by: {} }]));

      const result = await getAttachmentInfo({ id: 42, attachmentId: 5 }, authManager);
      const text = result.content[0].text;
      expect(text).toContain('"id": null');
      expect(text).toContain('"username": null');
    });
  });

  describe('deleteAttachment', () => {
    it('deletes an attachment', async () => {
      fetchMock.mockResolvedValue(restOk({ message: 'deleted' }));

      const result = await deleteAttachment({ id: 42, attachmentId: 1 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/42/attachments/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.content[0].text).toContain('Deleted attachment 1 from task 42');
    });

    it('requires a task id', async () => {
      await expect(deleteAttachment({ attachmentId: 1 }, authManager)).rejects.toThrow(
        'Task id is required for delete-attachment operation',
      );
    });

    it('requires an attachment id', async () => {
      await expect(deleteAttachment({ id: 42 }, authManager)).rejects.toThrow(
        'attachmentId is required for delete-attachment operation',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('propagates a non-OK HTTP response', async () => {
      fetchMock.mockResolvedValue(restError(404, 'Not Found', 'no such attachment'));

      await expect(
        deleteAttachment({ id: 42, attachmentId: 999 }, authManager),
      ).rejects.toThrow(
        'Vikunja REST request failed (DELETE /tasks/42/attachments/999): HTTP 404 Not Found — no such attachment',
      );
    });
  });

  describe('downloadAttachment', () => {
    it('returns the direct download URL and auth guidance instead of file bytes', () => {
      const result = downloadAttachment({ id: 42, attachmentId: 1 }, authManager);

      // No network call at all — this never hits the octet-stream endpoint.
      expect(fetchMock).not.toHaveBeenCalled();

      const text = result.content[0].text;
      expect(text).toContain('https://vikunja.test/api/v1/tasks/42/attachments/1');
      expect(text).toContain('application/octet-stream');
      expect(text).toContain('Authorization: Bearer');
      expect(text).toContain('deliveredThroughThisTool:** false');
    });

    it('includes preview_size in the URL when supplied', () => {
      const result = downloadAttachment(
        { id: 42, attachmentId: 1, previewSize: 'lg' },
        authManager,
      );

      expect(result.content[0].text).toContain(
        'https://vikunja.test/api/v1/tasks/42/attachments/1?preview_size=lg',
      );
    });

    it('normalizes a trailing-slash apiUrl', () => {
      authManager.connect('https://vikunja.test/api/v1///', 'tk_test-token');

      const result = downloadAttachment({ id: 42, attachmentId: 1 }, authManager);
      expect(result.content[0].text).toContain(
        'https://vikunja.test/api/v1/tasks/42/attachments/1',
      );
    });

    it('requires a task id', () => {
      expect(() => downloadAttachment({ attachmentId: 1 }, authManager)).toThrow(
        'Task id is required for download-attachment operation',
      );
    });

    it('requires an attachment id', () => {
      expect(() => downloadAttachment({ id: 42 }, authManager)).toThrow(
        'attachmentId is required for download-attachment operation',
      );
    });
  });
});
