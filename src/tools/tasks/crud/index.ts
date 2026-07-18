/**
 * CRUD Operations for Tasks
 * Centralized exports for all task CRUD operations with clean modular architecture
 */

// Export all service functions with their original signatures for backward compatibility
export { createTask } from './TaskCreationService';
export { updateTask } from './TaskUpdateService';
export { deleteTask } from './TaskDeletionService';
export { getTask } from './TaskReadService';

// Export the response formatter for use in other modules
export { createTaskResponse } from './TaskResponseFormatter';

// Export types for external use
export type { CreateTaskArgs } from './TaskCreationService';
export type { UpdateTaskArgs } from './TaskUpdateService';
export type { DeleteTaskArgs } from './TaskDeletionService';
export type { GetTaskArgs } from './TaskReadService';

// Re-export for backward compatibility - maintain the original API surface.
// `Task` here is the generated OpenAPI type (models.Task), not node-vikunja's
// (EOL, drifted) type.
import type { components } from '../../../types/generated/vikunja-openapi';
export type Task = components['schemas']['models.Task'];

export type {
  AorpBuilderConfig,
} from '../../../utils/response-factory';
