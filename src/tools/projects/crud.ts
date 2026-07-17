/**
 * Project CRUD Operations Module
 * Handles basic Create, Read, Update, Delete operations for projects
 */

import type { Project, ProjectListParams } from 'node-vikunja';
import { MCPError, ErrorCode, type CreateProjectRequest } from '../../types';
import { getClientFromContext } from '../../client';
import { transformApiError, handleStatusCodeError } from '../../utils/error-handler';
import { validateId, validateHexColor, validateProjectData, calculateProjectDepth } from './validation';
import { createProjectResponse, createProjectListResponse } from './response-formatter';
import { formatAorpAsMarkdown } from '../../utils/response-factory';

// MCP response type
export type McpResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

/**
 * Arguments for listing projects
 */
export interface ListProjectsArgs {
  page?: number;
  perPage?: number;
  search?: string;
  isArchived?: boolean;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for getting a project
 */
export interface GetProjectArgs {
  id: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for creating a project
 */
export interface CreateProjectArgs {
  title: string;
  description?: string;
  parentProjectId?: number;
  isArchived?: boolean;
  hexColor?: string;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for updating a project
 */
export interface UpdateProjectArgs {
  id: number;
  title?: string;
  description?: string;
  parentProjectId?: number;
  isArchived?: boolean;
  hexColor?: string;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for deleting a project
 */
export interface DeleteProjectArgs {
  id: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for archiving/unarchiving a project
 */
export interface ArchiveProjectArgs {
  id: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Builds a project update payload by merging current project state with
 * requested field changes. Vikunja's update endpoint replaces the whole
 * model, so omitted fields would otherwise be cleared (e.g. parent_project_id → 0).
 */
export function buildProjectUpdatePayload(
  currentProject: Project,
  updates: {
    title?: string;
    description?: string;
    parentProjectId?: number;
    isArchived?: boolean;
    hexColor?: string;
  }
): Project {
  return {
    ...currentProject,
    ...(updates.title !== undefined && { title: updates.title.trim() }),
    ...(updates.description !== undefined && { description: updates.description.trim() }),
    ...(updates.parentProjectId !== undefined && { parent_project_id: updates.parentProjectId }),
    ...(updates.isArchived !== undefined && { is_archived: updates.isArchived }),
    ...(updates.hexColor !== undefined && { hex_color: updates.hexColor.toLowerCase() }),
  };
}

/**
 * Lists projects with pagination and filtering
 */
export async function listProjects(
  args: ListProjectsArgs
): Promise<McpResponse> {
  const { page = 1, perPage = 50, search, isArchived, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    const client = await getClientFromContext();

    // Build params object, only including defined properties to satisfy exactOptionalPropertyTypes
    const params: ProjectListParams = {
      page,
      per_page: perPage,
    };

    if (search !== undefined) {
      params.s = search;
    }

    if (isArchived !== undefined) {
      params.is_archived = isArchived;
    }

    const response = await client.projects.getProjects(params);

    // GET /projects returns a bare array — there is no {data, total} envelope
    // (see docs/API_NOTES.md). Total item/page counts are therefore unknown;
    // createProjectListResponse derives `hasMore` honestly from the page size
    // instead of fabricating a total.
    const responseArray = Array.isArray(response) ? response : [response];

    // Build options object, only including defined properties to satisfy exactOptionalPropertyTypes
    const options: { verbosity?: string; useOptimizedFormat?: boolean; useAorp?: boolean } = {};

    if (verbosity !== undefined) {
      options.verbosity = verbosity;
    }

    if (useOptimizedFormat !== undefined) {
      options.useOptimizedFormat = useOptimizedFormat;
    }

    if (useAorp !== undefined) {
      options.useAorp = useAorp;
    }

    const result = createProjectListResponse(
      responseArray,
      page,
      perPage,
      options
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw transformApiError(error, 'Failed to list projects');
  }
}

/**
 * Gets a single project by ID
 */
export async function getProject(
  args: GetProjectArgs
): Promise<McpResponse> {
  const { id, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    const client = await getClientFromContext();
    const project = await client.projects.getProject(id);

    const result = createProjectResponse(
      'get_project',
      `Retrieved project: ${project.title}`,
      { project },
      {},
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw handleStatusCodeError(error, 'Failed to get project', id, `Project with ID ${id} not found`);
  }
}

/**
 * Creates a new project
 */
export async function createProject(
  args: CreateProjectArgs
): Promise<McpResponse> {
  const {
    title,
    description,
    parentProjectId,
    isArchived,
    hexColor,
    verbosity,
    useOptimizedFormat,
    useAorp
  } = args;

  try {
    // Validate input data, filter out undefined values for exactOptionalPropertyTypes
    const validationData: { title?: string; hexColor?: string; parentProjectId?: number } = {};

    if (title !== undefined) {
      validationData.title = title;
    }

    if (hexColor !== undefined) {
      validationData.hexColor = hexColor;
    }

    if (parentProjectId !== undefined) {
      validationData.parentProjectId = parentProjectId;
    }

    validateProjectData(validationData);

    const client = await getClientFromContext();

    // Get all projects to validate hierarchy if parent is specified
    let allProjects: Project[] = [];
    if (parentProjectId) {
      try {
        const allProjectsResponse = await client.projects.getProjects({ per_page: 1000 });
        allProjects = Array.isArray(allProjectsResponse) ? allProjectsResponse : [allProjectsResponse];
      } catch {
        // Continue with validation if we can't get all projects
      }

      validateProjectData({ parentProjectId }, allProjects);

      // Check depth constraints
      if (allProjects.length > 0) {
        const depth = calculateProjectDepth(parentProjectId, allProjects);
        if (depth >= 10) { // MAX_PROJECT_DEPTH
          throw new MCPError(
            ErrorCode.VALIDATION_ERROR,
            'Maximum allowed depth is 10 levels'
          );
        }
      }
    }

    // Normalize hex color if provided
    let normalizedColor = hexColor;
    if (hexColor) {
      normalizedColor = hexColor.toLowerCase();
    }

    // Build projectData object, only including defined properties to satisfy exactOptionalPropertyTypes
    const projectData: CreateProjectRequest = {
      title: title.trim(),
    };

    if (description !== undefined) {
      projectData.description = description?.trim() || '';
    }

    if (isArchived !== undefined) {
      projectData.is_archived = isArchived;
    }

    if (parentProjectId !== undefined) {
      projectData.parent_project_id = parentProjectId;
    }

    if (normalizedColor !== undefined) {
      projectData.hex_color = normalizedColor;
    }

    const createdProject = await client.projects.createProject(projectData as Project);

    const result = createProjectResponse(
      'create_project',
      `Project "${createdProject.title}" created successfully`,
      { project: createdProject },
      {},
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw transformApiError(error, 'Failed to create project');
  }
}

/**
 * Updates an existing project
 */
export async function updateProject(
  args: UpdateProjectArgs
): Promise<McpResponse> {
  const {
    id,
    title,
    description,
    parentProjectId,
    isArchived,
    hexColor,
    verbosity,
    useOptimizedFormat,
    useAorp
  } = args;

  try {
    validateId(id, 'project id');

    // Check if at least one field to update is provided
    const hasUpdateFields = (
      title !== undefined ||
      description !== undefined ||
      parentProjectId !== undefined ||
      isArchived !== undefined ||
      hexColor !== undefined
    );

    if (!hasUpdateFields) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'No fields to update provided');
    }

    // Validate hex color early if provided
    if (hexColor !== undefined) {
      validateHexColor(hexColor);
    }

    const client = await getClientFromContext();

    // Get current project
    const currentProject = await client.projects.getProject(id);

    // Get all projects for hierarchy validation
    let allProjects: Project[] = [];
    if (parentProjectId !== undefined || (currentProject && currentProject.parent_project_id)) {
      try {
        const allProjectsResponse = await client.projects.getProjects({ per_page: 1000 });
        allProjects = Array.isArray(allProjectsResponse) ? allProjectsResponse : [allProjectsResponse];
      } catch {
        // Continue if we can't get all projects
      }
    }

    // Validate update data, filter out undefined values for exactOptionalPropertyTypes
    const validationUpdateData: { title?: string; hexColor?: string; parentProjectId?: number } = {};

    if (title !== undefined) {
      validationUpdateData.title = title;
    }

    if (hexColor !== undefined) {
      validationUpdateData.hexColor = hexColor;
    }

    const resolvedParentProjectId = parentProjectId ?? (currentProject && typeof currentProject.parent_project_id === 'number' ? currentProject.parent_project_id : undefined);
    if (resolvedParentProjectId !== undefined) {
      validationUpdateData.parentProjectId = resolvedParentProjectId;
    }

    validateProjectData(validationUpdateData, allProjects);

    // Check depth constraints if parentProjectId is being updated
    if (parentProjectId !== undefined && allProjects.length > 0) {
      const depth = calculateProjectDepth(parentProjectId, allProjects);
      if (depth >= 10) { // MAX_PROJECT_DEPTH
        throw new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'Maximum allowed depth is 10 levels'
        );
      }
    }

    // Vikunja project update is a full-model replace. Merge with the current
    // project so omitted fields (especially parent_project_id) are preserved.
    // Detaching from a parent requires an explicit parentProjectId change
    // (or using the move subcommand). See issue #45.
    const fieldUpdates: {
      title?: string;
      description?: string;
      parentProjectId?: number;
      isArchived?: boolean;
      hexColor?: string;
    } = {};
    if (title !== undefined) fieldUpdates.title = title;
    if (description !== undefined) fieldUpdates.description = description;
    if (parentProjectId !== undefined) fieldUpdates.parentProjectId = parentProjectId;
    if (isArchived !== undefined) fieldUpdates.isArchived = isArchived;
    if (hexColor !== undefined) fieldUpdates.hexColor = hexColor;

    const updateData = buildProjectUpdatePayload(currentProject, fieldUpdates);

    const updatedProject = await client.projects.updateProject(id, updateData);

    const result = createProjectResponse(
      'update_project',
      `Project "${updatedProject.title}" updated successfully`,
      { project: updatedProject },
      {},
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw handleStatusCodeError(
      error,
      'Failed to update project',
      id,
      `Project with ID ${id} not found`
    );
  }
}

/**
 * Deletes a project
 */
export async function deleteProject(
  args: DeleteProjectArgs
): Promise<McpResponse> {
  const { id, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    const client = await getClientFromContext();

    // Get project details before deletion
    const project = await client.projects.getProject(id);

    await client.projects.deleteProject(id);

    const result = createProjectResponse(
      'delete_project',
      `Deleted project: ${project.title}`,
      { deleted: true, projectId: id, projectTitle: project.title },
      {},
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw handleStatusCodeError(
      error,
      'Failed to delete project',
      id,
      `Project with ID ${id} not found`
    );
  }
}

/**
 * Archives a project
 */
export async function archiveProject(
  args: ArchiveProjectArgs
): Promise<McpResponse> {
  const { id, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    const client = await getClientFromContext();

    // Get current project first
    const currentProject = await client.projects.getProject(id);

    // Check if project is already archived
    if (currentProject.is_archived) {
      const result = createProjectResponse(
        'archive_project',
        `Project "${currentProject.title}" is already archived`,
        { project: currentProject },
        {},
        verbosity,
        useOptimizedFormat,
        useAorp
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: formatAorpAsMarkdown(result.response),
          }
        ]
      };
    }

    // Archive the project (merge so parent/other fields are not wiped)
    const project = await client.projects.updateProject(
      id,
      buildProjectUpdatePayload(currentProject, { isArchived: true })
    );

    const result = createProjectResponse(
      'archive_project',
      `Project "${project.title}" archived successfully`,
      { project },
      {},
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw handleStatusCodeError(
      error,
      'Failed to archive project',
      id,
      `Project with ID ${id} not found`
    );
  }
}

/**
 * Unarchives a project
 */
export async function unarchiveProject(
  args: ArchiveProjectArgs
): Promise<McpResponse> {
  const { id, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    const client = await getClientFromContext();

    // Get current project first
    const currentProject = await client.projects.getProject(id);

    // Check if project is already active (not archived)
    if (!currentProject.is_archived) {
      const result = createProjectResponse(
        'unarchive_project',
        `Project "${currentProject.title}" is already active (not archived)`,
        { project: currentProject },
        {},
        verbosity,
        useOptimizedFormat,
        useAorp
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: formatAorpAsMarkdown(result.response),
          }
        ]
      };
    }

    // Unarchive the project (merge so parent/other fields are not wiped)
    const project = await client.projects.updateProject(
      id,
      buildProjectUpdatePayload(currentProject, { isArchived: false })
    );

    const result = createProjectResponse(
      'unarchive_project',
      `Project "${project.title}" unarchived successfully`,
      { project },
      {},
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(result.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw handleStatusCodeError(
      error,
      'Failed to unarchive project',
      id,
      `Project with ID ${id} not found`
    );
  }
}