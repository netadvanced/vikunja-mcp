/**
 * Comment operations service
 * Handles core business logic for task comment management
 */

import type { Message, TaskComment } from '../../../types/vikunja';
import { getClientFromContext } from '../../../client';

/**
 * Service for managing task comment operations
 */
export const CommentOperationsService = {
  /**
   * Create a new comment on a task
   */
  async createComment(taskId: number, commentText: string): Promise<TaskComment> {
    const client = await getClientFromContext();
    return await client.tasks.createTaskComment(taskId, {
      task_id: taskId,
      comment: commentText,
    });
  },

  /**
   * Fetch all comments for a task
   */
  async fetchTaskComments(taskId: number): Promise<TaskComment[]> {
    const client = await getClientFromContext();
    return await client.tasks.getTaskComments(taskId);
  },

  /**
   * Fetch a single comment on a task
   */
  async getComment(taskId: number, commentId: number): Promise<TaskComment> {
    const client = await getClientFromContext();
    return await client.tasks.getTaskComment(taskId, commentId);
  },

  /**
   * Update an existing comment on a task
   */
  async updateComment(
    taskId: number,
    commentId: number,
    commentText: string,
  ): Promise<TaskComment> {
    const client = await getClientFromContext();
    return await client.tasks.updateTaskComment(taskId, commentId, {
      id: commentId,
      task_id: taskId,
      comment: commentText,
    });
  },

  /**
   * Delete a comment from a task
   */
  async deleteComment(taskId: number, commentId: number): Promise<Message> {
    const client = await getClientFromContext();
    return await client.tasks.deleteTaskComment(taskId, commentId);
  },

  /**
   * Get comment count from comments array
   */
  getCommentCount(comments: TaskComment[]): number {
    return comments.length;
  },
};