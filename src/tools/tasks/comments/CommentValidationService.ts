/**
 * Comment validation service
 * Handles input validation for comment operations
 */

import { MCPError, ErrorCode } from '../../../types';
import { validateId } from '../validation';

export interface CommentOperationInput {
  id?: number | undefined;
  comment?: string | undefined;
}

export interface CommentByIdInput {
  id?: number | undefined;
  commentId?: number | undefined;
}

export interface CommentUpdateInput extends CommentByIdInput {
  comment?: string | undefined;
}

/**
 * Service for validating comment operation inputs
 */
export const commentValidationService = {
  /**
   * Validate input for comment operations (create or list)
   */
  validateCommentInput(args: CommentOperationInput): { taskId: number; commentText?: string } {
    if (!args.id) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for comment operation');
    }
    validateId(args.id, 'id');

    // Build return object, only including defined properties to satisfy exactOptionalPropertyTypes
    const result: { taskId: number; commentText?: string } = {
      taskId: args.id,
    };

    if (args.comment !== undefined) {
      result.commentText = args.comment;
    }

    return result;
  },

  /**
   * Validate input specifically for listing comments
   */
  validateListInput(args: { id?: number | undefined }): { taskId: number } {
    if (!args.id) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Task id is required for list-comments operation',
      );
    }
    validateId(args.id, 'id');

    return {
      taskId: args.id,
    };
  },

  /**
   * Validate input for a single-comment read operation (taskId + commentId)
   */
  validateGetInput(args: CommentByIdInput): { taskId: number; commentId: number } {
    if (!args.id) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Task id is required for get-comment operation',
      );
    }
    validateId(args.id, 'id');

    if (!args.commentId) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Comment id is required for get-comment operation',
      );
    }
    validateId(args.commentId, 'commentId');

    return {
      taskId: args.id,
      commentId: args.commentId,
    };
  },

  /**
   * Validate input for an update operation (taskId + commentId + non-empty text)
   */
  validateUpdateInput(args: CommentUpdateInput): {
    taskId: number;
    commentId: number;
    commentText: string;
  } {
    if (!args.id) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Task id is required for update-comment operation',
      );
    }
    validateId(args.id, 'id');

    if (!args.commentId) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Comment id is required for update-comment operation',
      );
    }
    validateId(args.commentId, 'commentId');

    if (args.comment === undefined || args.comment.trim() === '') {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Comment text is required for update-comment operation',
      );
    }

    return {
      taskId: args.id,
      commentId: args.commentId,
      commentText: args.comment,
    };
  },

  /**
   * Validate input for a delete operation (taskId + commentId)
   */
  validateDeleteInput(args: CommentByIdInput): { taskId: number; commentId: number } {
    if (!args.id) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Task id is required for delete-comment operation',
      );
    }
    validateId(args.id, 'id');

    if (!args.commentId) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Comment id is required for delete-comment operation',
      );
    }
    validateId(args.commentId, 'commentId');

    return {
      taskId: args.id,
      commentId: args.commentId,
    };
  },

  /**
   * Check if operation should create a comment or list comments
   */
  shouldCreateComment(commentText?: string): boolean {
    return commentText !== undefined && commentText.trim() !== '';
  }
};