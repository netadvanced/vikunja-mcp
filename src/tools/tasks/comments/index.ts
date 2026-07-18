/**
 * Comment operations for tasks
 * Refactored to use modular service architecture
 */

import { MCPError, ErrorCode } from '../../../types';
import type { AuthManager } from '../../../auth/AuthManager';
import { CommentOperationsService } from './CommentOperationsService';
import { commentValidationService } from './CommentValidationService';
import { commentResponseFormatter } from './CommentResponseFormatter';

/**
 * Add a comment to a task or list task comments
 */
export async function handleComment(
  args: {
    id?: number | undefined;
    comment?: string | undefined;
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, commentText } = commentValidationService.validateCommentInput(args);

    // If no comment text provided, list comments
    if (!commentValidationService.shouldCreateComment(commentText)) {
      const comments = await CommentOperationsService.fetchTaskComments(authManager, taskId);

      // Format and return response
      const response = commentResponseFormatter.formatListCommentsResponse(comments);
      return commentResponseFormatter.formatMcpResponse(response);
    }

    // Create a new comment
    if (!commentText) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Comment text is required for comment creation');
    }
    const newComment = await CommentOperationsService.createComment(authManager, taskId, commentText);

    // Format and return response
    const response = commentResponseFormatter.formatCreateCommentResponse(newComment);
    return commentResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to handle comment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * List all comments for a task
 */
export async function listComments(
  args: {
    id?: number | undefined;
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId } = commentValidationService.validateListInput(args);

    const comments = await CommentOperationsService.fetchTaskComments(authManager, taskId);

    // Format and return response
    const response = commentResponseFormatter.formatListCommentsResponse(comments);
    return commentResponseFormatter.formatMcpResponse(response);

  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to list comments: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Fetch a single comment by id
 */
export async function getComment(
  args: {
    id?: number | undefined;
    commentId?: number | undefined;
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, commentId } = commentValidationService.validateGetInput(args);

    const comment = await CommentOperationsService.getComment(authManager, taskId, commentId);

    const response = commentResponseFormatter.formatGetCommentResponse(comment);
    return commentResponseFormatter.formatMcpResponse(response);
  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to get comment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Update the text of an existing comment
 */
export async function updateComment(
  args: {
    id?: number | undefined;
    commentId?: number | undefined;
    comment?: string | undefined;
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, commentId, commentText } = commentValidationService.validateUpdateInput(args);

    const updated = await CommentOperationsService.updateComment(
      authManager,
      taskId,
      commentId,
      commentText,
    );

    const response = commentResponseFormatter.formatUpdateCommentResponse(updated);
    return commentResponseFormatter.formatMcpResponse(response);
  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to update comment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Remove a comment from a task
 */
export async function removeComment(
  args: {
    id?: number | undefined;
    commentId?: number | undefined;
  },
  authManager: AuthManager,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const { taskId, commentId } = commentValidationService.validateDeleteInput(args);

    await CommentOperationsService.deleteComment(authManager, taskId, commentId);

    const response = commentResponseFormatter.formatDeleteCommentResponse(taskId, commentId);
    return commentResponseFormatter.formatMcpResponse(response);
  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Failed to delete comment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}