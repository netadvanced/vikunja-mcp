/**
 * Comment operations service
 * Handles core business logic for task comment management
 */

import type { Message, TaskComment } from '../../../types/vikunja';
import type { AuthManager } from '../../../auth/AuthManager';
import { vikunjaRestRequest } from '../../../utils/vikunja-rest';
import type { components } from '../../../types/generated/vikunja-openapi';

/** `models.TaskComment` per the OpenAPI spec — note there is no `task_id` field. */
type VikunjaTaskComment = components['schemas']['models.TaskComment'];

/**
 * Maps the REST response shape (`models.TaskComment`, no `task_id`) onto
 * this codebase's local `TaskComment` type (which carries `task_id` for
 * caller convenience). `task_id` is always known from the URL path the
 * request was made against, so it's injected here rather than expected on
 * the wire.
 */
function toTaskComment(taskId: number, raw: VikunjaTaskComment): TaskComment {
  const comment: TaskComment = {
    task_id: taskId,
    comment: raw.comment ?? '',
  };
  if (raw.id !== undefined) comment.id = raw.id;
  if (raw.author !== undefined) {
    comment.author = raw.author as unknown as NonNullable<TaskComment['author']>;
  }
  if (raw.created !== undefined) comment.created = raw.created;
  if (raw.updated !== undefined) comment.updated = raw.updated;
  return comment;
}

/**
 * Service for managing task comment operations
 */
export const CommentOperationsService = {
  /**
   * Create a new comment on a task via `PUT /tasks/{taskID}/comments`. The
   * request body is `models.TaskComment`, which per the spec carries only
   * `comment` as a writable field (`task_id` comes from the URL, not the
   * body).
   */
  async createComment(
    authManager: AuthManager,
    taskId: number,
    commentText: string,
  ): Promise<TaskComment> {
    const result = await vikunjaRestRequest<VikunjaTaskComment>(
      authManager,
      'PUT',
      `/tasks/${taskId}/comments`,
      { comment: commentText },
    );
    return toTaskComment(taskId, result);
  },

  /**
   * Fetch all comments for a task via `GET /tasks/{taskID}/comments`.
   */
  async fetchTaskComments(authManager: AuthManager, taskId: number): Promise<TaskComment[]> {
    const result = await vikunjaRestRequest<VikunjaTaskComment[]>(
      authManager,
      'GET',
      `/tasks/${taskId}/comments`,
    );
    return (Array.isArray(result) ? result : []).map((comment) => toTaskComment(taskId, comment));
  },

  /**
   * Fetch a single comment on a task via
   * `GET /tasks/{taskID}/comments/{commentID}`.
   */
  async getComment(
    authManager: AuthManager,
    taskId: number,
    commentId: number,
  ): Promise<TaskComment> {
    const result = await vikunjaRestRequest<VikunjaTaskComment>(
      authManager,
      'GET',
      `/tasks/${taskId}/comments/${commentId}`,
    );
    return toTaskComment(taskId, result);
  },

  /**
   * Update an existing comment on a task via
   * `POST /tasks/{taskID}/comments/{commentID}`. The spec omits an explicit
   * body schema for this endpoint's parameters, but its behavior mirrors the
   * create endpoint's `models.TaskComment` — only `comment` is sent.
   */
  async updateComment(
    authManager: AuthManager,
    taskId: number,
    commentId: number,
    commentText: string,
  ): Promise<TaskComment> {
    const result = await vikunjaRestRequest<VikunjaTaskComment>(
      authManager,
      'POST',
      `/tasks/${taskId}/comments/${commentId}`,
      { comment: commentText },
    );
    return toTaskComment(taskId, result);
  },

  /**
   * Delete a comment from a task via
   * `DELETE /tasks/{taskID}/comments/{commentID}`.
   */
  async deleteComment(
    authManager: AuthManager,
    taskId: number,
    commentId: number,
  ): Promise<Message> {
    const result = await vikunjaRestRequest<Message | null>(
      authManager,
      'DELETE',
      `/tasks/${taskId}/comments/${commentId}`,
    );
    return result ?? { message: 'Successfully deleted.' };
  },

  /**
   * Get comment count from comments array
   */
  getCommentCount(comments: TaskComment[]): number {
    return comments.length;
  },
};
