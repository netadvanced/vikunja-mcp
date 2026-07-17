import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  handleComment,
  removeComment,
  listComments,
  getComment,
  updateComment,
} from '../../../src/tools/tasks/comments';
import { getClientFromContext } from '../../../src/client';
import { parseMarkdown } from '../../utils/markdown';

jest.mock('../../../src/client');
jest.mock('../../../src/utils/logger');

describe('Comment operations', () => {
  const mockClient = {
    tasks: {
      createTaskComment: jest.fn(),
      getTaskComments: jest.fn(),
      getTaskComment: jest.fn(),
      updateTaskComment: jest.fn(),
      deleteTaskComment: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
  });

  describe('handleComment', () => {
    it('should create a comment successfully', async () => {
      const mockComment = {
        id: 1,
        comment: 'Test comment',
        created: new Date().toISOString(),
      };
      mockClient.tasks.createTaskComment.mockResolvedValue(mockComment);

      const result = await handleComment({
        id: 123,
        comment: 'Test comment',
      });

      expect(mockClient.tasks.createTaskComment).toHaveBeenCalledWith(123, {
        comment: 'Test comment',
        task_id: 123,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('comment');
      expect(markdown).toContain('Comment added successfully');
    });

    it('should list comments when comment text is missing', async () => {
      const mockComments = [
        { id: 1, comment: 'First comment', created: '2024-01-01' },
      ];
      mockClient.tasks.getTaskComments.mockResolvedValue(mockComments);

      const result = await handleComment({ id: 123 });

      expect(mockClient.tasks.getTaskComments).toHaveBeenCalledWith(123);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 1 comments');
    });

    it('should throw error when id is missing', async () => {
      await expect(handleComment({ comment: 'Test' })).rejects.toThrow(
        'Failed to handle comment: Task id is required for comment operation'
      );
    });

    it('should throw error when id is zero', async () => {
      // id: 0 is falsy, so it's treated as missing
      await expect(handleComment({ id: 0, comment: 'Test' })).rejects.toThrow(
        'Failed to handle comment: Task id is required for comment operation'
      );
    });

    it('should throw error when id is negative', async () => {
      // Negative IDs fail validation
      await expect(handleComment({ id: -1, comment: 'Test' })).rejects.toThrow(
        'Failed to handle comment: id must be a positive integer'
      );
    });

    it('should handle API errors when creating comment', async () => {
      mockClient.tasks.createTaskComment.mockRejectedValue(new Error('API Error'));

      await expect(handleComment({ id: 123, comment: 'Test' })).rejects.toThrow(
        'Failed to handle comment: API Error'
      );
    });

    it('should handle API errors when listing comments', async () => {
      mockClient.tasks.getTaskComments.mockRejectedValue(new Error('API Error'));

      await expect(handleComment({ id: 123 })).rejects.toThrow(
        'Failed to handle comment: API Error'
      );
    });

    it('should list comments when empty string is provided', async () => {
      // Empty string is falsy, so it lists comments instead
      const mockComments = [];
      mockClient.tasks.getTaskComments.mockResolvedValue(mockComments);

      const result = await handleComment({
        id: 123,
        comment: '',
      });

      expect(mockClient.tasks.getTaskComments).toHaveBeenCalledWith(123);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 0 comments');
    });
  });

  describe('removeComment', () => {
    it('should delete a comment successfully', async () => {
      mockClient.tasks.deleteTaskComment.mockResolvedValue({ message: 'Successfully deleted.' });

      const result = await removeComment({ id: 123, commentId: 45 });

      expect(mockClient.tasks.deleteTaskComment).toHaveBeenCalledWith(123, 45);
      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('delete');
      expect(markdown).toContain('Comment 45 deleted from task 123');
    });

    it('should throw when task id is missing', async () => {
      await expect(removeComment({ commentId: 1 })).rejects.toThrow(
        'Failed to delete comment: Task id is required for delete-comment operation'
      );
    });

    it('should throw when commentId is missing', async () => {
      await expect(removeComment({ id: 1 })).rejects.toThrow(
        'Failed to delete comment: Comment id is required for delete-comment operation'
      );
    });

    it('should throw when task id is invalid', async () => {
      await expect(removeComment({ id: -1, commentId: 2 })).rejects.toThrow(
        'Failed to delete comment: id must be a positive integer'
      );
    });

    it('should throw when commentId is invalid', async () => {
      await expect(removeComment({ id: 1, commentId: -2 })).rejects.toThrow(
        'Failed to delete comment: commentId must be a positive integer'
      );
    });

    it('should handle API errors', async () => {
      mockClient.tasks.deleteTaskComment.mockRejectedValue(new Error('API Error'));

      await expect(removeComment({ id: 1, commentId: 2 })).rejects.toThrow(
        'Failed to delete comment: API Error'
      );
    });

    it('should handle non-Error rejections', async () => {
      mockClient.tasks.deleteTaskComment.mockRejectedValue(false);

      await expect(removeComment({ id: 1, commentId: 2 })).rejects.toThrow(
        'Failed to delete comment: false'
      );
    });
  });

  describe('getComment', () => {
    it('should fetch a single comment', async () => {
      const mockComment = {
        id: 45,
        task_id: 123,
        comment: 'Hi',
        created: '2026-01-01',
      };
      mockClient.tasks.getTaskComment.mockResolvedValue(mockComment);

      const result = await getComment({ id: 123, commentId: 45 });

      expect(mockClient.tasks.getTaskComment).toHaveBeenCalledWith(123, 45);
      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('get');
      expect(markdown).toContain('Comment retrieved successfully');
    });

    it('should throw when task id is missing', async () => {
      await expect(getComment({ commentId: 1 })).rejects.toThrow(
        'Failed to get comment: Task id is required for get-comment operation'
      );
    });

    it('should throw when commentId is missing', async () => {
      await expect(getComment({ id: 1 })).rejects.toThrow(
        'Failed to get comment: Comment id is required for get-comment operation'
      );
    });

    it('should throw when task id is invalid', async () => {
      await expect(getComment({ id: -1, commentId: 2 })).rejects.toThrow(
        'Failed to get comment: id must be a positive integer'
      );
    });

    it('should throw when commentId is invalid', async () => {
      await expect(getComment({ id: 1, commentId: -2 })).rejects.toThrow(
        'Failed to get comment: commentId must be a positive integer'
      );
    });

    it('should handle API errors', async () => {
      mockClient.tasks.getTaskComment.mockRejectedValue(new Error('Not found'));

      await expect(getComment({ id: 1, commentId: 999 })).rejects.toThrow(
        'Failed to get comment: Not found'
      );
    });

    it('should handle non-Error rejections', async () => {
      mockClient.tasks.getTaskComment.mockRejectedValue(null);

      await expect(getComment({ id: 1, commentId: 2 })).rejects.toThrow(
        'Failed to get comment: null'
      );
    });
  });

  describe('updateComment', () => {
    it('should update a comment successfully', async () => {
      const mockComment = {
        id: 45,
        task_id: 123,
        comment: 'Updated text',
        created: '2026-01-01',
        updated: '2026-01-02',
      };
      mockClient.tasks.updateTaskComment.mockResolvedValue(mockComment);

      const result = await updateComment({
        id: 123,
        commentId: 45,
        comment: 'Updated text',
      });

      expect(mockClient.tasks.updateTaskComment).toHaveBeenCalledWith(123, 45, {
        id: 45,
        task_id: 123,
        comment: 'Updated text',
      });
      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('update');
      expect(markdown).toContain('Comment updated successfully');
      expect(markdown).toContain('comment'); // affectedFields entry
    });

    it('should throw when task id is missing', async () => {
      await expect(updateComment({ commentId: 1, comment: 'x' })).rejects.toThrow(
        'Failed to update comment: Task id is required for update-comment operation'
      );
    });

    it('should throw when commentId is missing', async () => {
      await expect(updateComment({ id: 1, comment: 'x' })).rejects.toThrow(
        'Failed to update comment: Comment id is required for update-comment operation'
      );
    });

    it('should throw when comment text is missing', async () => {
      await expect(updateComment({ id: 1, commentId: 2 })).rejects.toThrow(
        'Failed to update comment: Comment text is required for update-comment operation'
      );
    });

    it('should throw when comment text is whitespace', async () => {
      await expect(updateComment({ id: 1, commentId: 2, comment: '   ' })).rejects.toThrow(
        'Failed to update comment: Comment text is required for update-comment operation'
      );
    });

    it('should throw when task id is invalid', async () => {
      await expect(updateComment({ id: -1, commentId: 2, comment: 'x' })).rejects.toThrow(
        'Failed to update comment: id must be a positive integer'
      );
    });

    it('should throw when commentId is invalid', async () => {
      await expect(updateComment({ id: 1, commentId: -2, comment: 'x' })).rejects.toThrow(
        'Failed to update comment: commentId must be a positive integer'
      );
    });

    it('should handle API errors', async () => {
      mockClient.tasks.updateTaskComment.mockRejectedValue(new Error('Forbidden'));

      await expect(
        updateComment({ id: 1, commentId: 2, comment: 'x' }),
      ).rejects.toThrow('Failed to update comment: Forbidden');
    });

    it('should handle non-Error rejections', async () => {
      mockClient.tasks.updateTaskComment.mockRejectedValue(42);

      await expect(
        updateComment({ id: 1, commentId: 2, comment: 'x' }),
      ).rejects.toThrow('Failed to update comment: 42');
    });
  });

  describe('listComments', () => {
    it('should list comments successfully', async () => {
      const mockComments = [
        { id: 1, comment: 'First comment', created: '2024-01-01' },
        { id: 2, comment: 'Second comment', created: '2024-01-02' },
      ];
      mockClient.tasks.getTaskComments.mockResolvedValue(mockComments);

      const result = await listComments({ id: 123 });

      expect(mockClient.tasks.getTaskComments).toHaveBeenCalledWith(123);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 2 comments');
    });

    it('should throw error when id is missing', async () => {
      await expect(listComments({})).rejects.toThrow(
        'Failed to list comments: Task id is required for list-comments operation'
      );
    });

    it('should throw error when id is invalid', async () => {
      await expect(listComments({ id: -1 })).rejects.toThrow(
        'Failed to list comments: id must be a positive integer'
      );
    });

    it('should handle empty comments list', async () => {
      mockClient.tasks.getTaskComments.mockResolvedValue([]);

      const result = await listComments({ id: 123 });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list');
      expect(markdown).toContain('Found 0 comments');
    });

    it('should handle API errors', async () => {
      mockClient.tasks.getTaskComments.mockRejectedValue(new Error('API Error'));

      await expect(listComments({ id: 123 })).rejects.toThrow(
        'Failed to list comments: API Error'
      );
    });
  });
});