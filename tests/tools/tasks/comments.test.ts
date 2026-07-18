import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  handleComment,
  removeComment,
  listComments,
  getComment,
  updateComment,
} from '../../../src/tools/tasks/comments';
import { AuthManager } from '../../../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../../../src/utils/retry';
import { parseMarkdown } from '../../utils/markdown';

jest.mock('../../../src/utils/logger');

describe('Comment operations', () => {
  // handleComment/listComments/getComment/updateComment/removeComment all go
  // through the direct-REST helper (vikunjaRestRequest) now, so tests drive
  // a mocked global fetch and a real AuthManager session.
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
    jest.clearAllMocks();
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('handleComment', () => {
    it('should create a comment successfully', async () => {
      fetchMock.mockResolvedValue(
        restOk({ id: 1, comment: 'Test comment', created: new Date().toISOString() }),
      );

      const result = await handleComment(
        {
          id: 123,
          comment: 'Test comment',
        },
        authManager,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ comment: 'Test comment' }),
        }),
      );

      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('comment');
      expect(markdown).toContain('Comment added successfully');
    });

    it('should list comments when comment text is missing', async () => {
      fetchMock.mockResolvedValue(restOk([{ id: 1, comment: 'First comment', created: '2024-01-01' }]));

      const result = await handleComment({ id: 123 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 1 comments');
    });

    it('should throw error when id is missing', async () => {
      await expect(handleComment({ comment: 'Test' }, authManager)).rejects.toThrow(
        'Failed to handle comment: Task id is required for comment operation'
      );
    });

    it('should throw error when id is zero', async () => {
      // id: 0 is falsy, so it's treated as missing
      await expect(handleComment({ id: 0, comment: 'Test' }, authManager)).rejects.toThrow(
        'Failed to handle comment: Task id is required for comment operation'
      );
    });

    it('should throw error when id is negative', async () => {
      // Negative IDs fail validation
      await expect(handleComment({ id: -1, comment: 'Test' }, authManager)).rejects.toThrow(
        'Failed to handle comment: id must be a positive integer'
      );
    });

    it('should handle API errors when creating comment', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'API Error'));

      await expect(handleComment({ id: 123, comment: 'Test' }, authManager)).rejects.toThrow(
        'Failed to handle comment:'
      );
    });

    it('should handle API errors when listing comments', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'API Error'));

      await expect(handleComment({ id: 123 }, authManager)).rejects.toThrow(
        'Failed to handle comment:'
      );
    });

    it('should list comments when empty string is provided', async () => {
      // Empty string is falsy, so it lists comments instead
      fetchMock.mockResolvedValue(restOk([]));

      const result = await handleComment(
        {
          id: 123,
          comment: '',
        },
        authManager,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 0 comments');
    });
  });

  describe('removeComment', () => {
    it('should delete a comment successfully', async () => {
      fetchMock.mockResolvedValue(restOk({ message: 'Successfully deleted.' }));

      const result = await removeComment({ id: 123, commentId: 45 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments/45',
        expect.objectContaining({ method: 'DELETE' }),
      );
      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('delete');
      expect(markdown).toContain('Comment 45 deleted from task 123');
    });

    it('should throw when task id is missing', async () => {
      await expect(removeComment({ commentId: 1 }, authManager)).rejects.toThrow(
        'Failed to delete comment: Task id is required for delete-comment operation'
      );
    });

    it('should throw when commentId is missing', async () => {
      await expect(removeComment({ id: 1 }, authManager)).rejects.toThrow(
        'Failed to delete comment: Comment id is required for delete-comment operation'
      );
    });

    it('should throw when task id is invalid', async () => {
      await expect(removeComment({ id: -1, commentId: 2 }, authManager)).rejects.toThrow(
        'Failed to delete comment: id must be a positive integer'
      );
    });

    it('should throw when commentId is invalid', async () => {
      await expect(removeComment({ id: 1, commentId: -2 }, authManager)).rejects.toThrow(
        'Failed to delete comment: commentId must be a positive integer'
      );
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'API Error'));

      await expect(removeComment({ id: 1, commentId: 2 }, authManager)).rejects.toThrow(
        'Failed to delete comment:'
      );
    });
  });

  describe('getComment', () => {
    it('should fetch a single comment', async () => {
      fetchMock.mockResolvedValue(
        restOk({ id: 45, comment: 'Hi', created: '2026-01-01' }),
      );

      const result = await getComment({ id: 123, commentId: 45 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments/45',
        expect.objectContaining({ method: 'GET' }),
      );
      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('get');
      expect(markdown).toContain('Comment retrieved successfully');
    });

    it('should throw when task id is missing', async () => {
      await expect(getComment({ commentId: 1 }, authManager)).rejects.toThrow(
        'Failed to get comment: Task id is required for get-comment operation'
      );
    });

    it('should throw when commentId is missing', async () => {
      await expect(getComment({ id: 1 }, authManager)).rejects.toThrow(
        'Failed to get comment: Comment id is required for get-comment operation'
      );
    });

    it('should throw when task id is invalid', async () => {
      await expect(getComment({ id: -1, commentId: 2 }, authManager)).rejects.toThrow(
        'Failed to get comment: id must be a positive integer'
      );
    });

    it('should throw when commentId is invalid', async () => {
      await expect(getComment({ id: 1, commentId: -2 }, authManager)).rejects.toThrow(
        'Failed to get comment: commentId must be a positive integer'
      );
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValue(restError(404, 'Not Found', 'Not found'));

      await expect(getComment({ id: 1, commentId: 999 }, authManager)).rejects.toThrow(
        'Failed to get comment:'
      );
    });
  });

  describe('updateComment', () => {
    it('should update a comment successfully', async () => {
      fetchMock.mockResolvedValue(
        restOk({
          id: 45,
          comment: 'Updated text',
          created: '2026-01-01',
          updated: '2026-01-02',
        }),
      );

      const result = await updateComment(
        {
          id: 123,
          commentId: 45,
          comment: 'Updated text',
        },
        authManager,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments/45',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ comment: 'Updated text' }),
        }),
      );
      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('update');
      expect(markdown).toContain('Comment updated successfully');
      expect(markdown).toContain('comment'); // affectedFields entry
    });

    it('should throw when task id is missing', async () => {
      await expect(updateComment({ commentId: 1, comment: 'x' }, authManager)).rejects.toThrow(
        'Failed to update comment: Task id is required for update-comment operation'
      );
    });

    it('should throw when commentId is missing', async () => {
      await expect(updateComment({ id: 1, comment: 'x' }, authManager)).rejects.toThrow(
        'Failed to update comment: Comment id is required for update-comment operation'
      );
    });

    it('should throw when comment text is missing', async () => {
      await expect(updateComment({ id: 1, commentId: 2 }, authManager)).rejects.toThrow(
        'Failed to update comment: Comment text is required for update-comment operation'
      );
    });

    it('should throw when comment text is whitespace', async () => {
      await expect(updateComment({ id: 1, commentId: 2, comment: '   ' }, authManager)).rejects.toThrow(
        'Failed to update comment: Comment text is required for update-comment operation'
      );
    });

    it('should throw when task id is invalid', async () => {
      await expect(
        updateComment({ id: -1, commentId: 2, comment: 'x' }, authManager),
      ).rejects.toThrow('Failed to update comment: id must be a positive integer');
    });

    it('should throw when commentId is invalid', async () => {
      await expect(
        updateComment({ id: 1, commentId: -2, comment: 'x' }, authManager),
      ).rejects.toThrow('Failed to update comment: commentId must be a positive integer');
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValue(restError(403, 'Forbidden', 'Forbidden'));

      await expect(
        updateComment({ id: 1, commentId: 2, comment: 'x' }, authManager),
      ).rejects.toThrow('Failed to update comment:');
    });
  });

  describe('listComments', () => {
    it('should list comments successfully', async () => {
      fetchMock.mockResolvedValue(
        restOk([
          { id: 1, comment: 'First comment', created: '2024-01-01' },
          { id: 2, comment: 'Second comment', created: '2024-01-02' },
        ]),
      );

      const result = await listComments({ id: 123 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/comments',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 2 comments');
    });

    it('should throw error when id is missing', async () => {
      await expect(listComments({}, authManager)).rejects.toThrow(
        'Failed to list comments: Task id is required for list-comments operation'
      );
    });

    it('should throw error when id is invalid', async () => {
      await expect(listComments({ id: -1 }, authManager)).rejects.toThrow(
        'Failed to list comments: id must be a positive integer'
      );
    });

    it('should handle empty comments list', async () => {
      fetchMock.mockResolvedValue(restOk([]));

      const result = await listComments({ id: 123 }, authManager);

      const markdown = result.content[0].text;
      parseMarkdown(markdown);
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 0 comments');
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'API Error'));

      await expect(listComments({ id: 123 }, authManager)).rejects.toThrow(
        'Failed to list comments:'
      );
    });
  });
});
