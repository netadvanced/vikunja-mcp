/**
 * Project Hierarchy Operations Module
 * Handles complex hierarchical operations like tree building, breadcrumbs, and moves
 *
 * Migrated off the legacy client (Wave D domain migration, tracking issue #28)
 * onto `vikunjaRestRequest` + types generated from the vendored OpenAPI spec.
 * `moveProject` reuses `buildProjectUpdatePayload` from `crud.ts` — see that
 * module's doc comment and docs/API_NOTES.md "Project Operations" for why an
 * omitted `parentProjectId` on move means "move to root" rather than "leave
 * untouched" (the one exception to the merge-preserves-untouched-fields
 * default).
 */

import { MCPError, ErrorCode } from '../../types';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';
import type { AuthManager } from '../../auth/AuthManager';
import { transformApiError } from '../../utils/error-handler';
import { validateId, validateMoveConstraints } from './validation';
import { createProjectResponse, createProjectTreeResponse, createBreadcrumbResponse } from './response-formatter';
import { formatAorpAsMarkdown } from '../../utils/response-factory';
import { buildProjectUpdatePayload, fetchAllProjects, type VikunjaProject } from './crud';

// MCP response type
type McpResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

/**
 * Arguments for getting project children
 */
export interface GetChildrenArgs {
  id: number;
  includeArchived?: boolean;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for getting project tree
 */
export interface GetTreeArgs {
  id?: number;
  maxDepth?: number;
  includeArchived?: boolean;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for getting project breadcrumb
 */
export interface GetBreadcrumbArgs {
  id: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Arguments for moving a project
 */
export interface MoveProjectArgs {
  id: number;
  parentProjectId?: number;
  verbosity?: string;
  useOptimizedFormat?: boolean;
  useAorp?: boolean;
}

/**
 * Project tree node interface
 */
interface ProjectTreeNode extends VikunjaProject {
  children: ProjectTreeNode[];
  depth: number;
}

/**
 * Gets direct children of a project
 */
export async function getProjectChildren(
  args: GetChildrenArgs,
  _context: unknown,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { id, includeArchived = false, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    // Verify the project exists
    await vikunjaRestRequest<VikunjaProject>(authManager, 'GET', `/projects/${id}`);

    // Get all projects and filter for children
    const allProjects = await fetchAllProjects(authManager);
    let children = allProjects.filter((p: VikunjaProject) => p.parent_project_id === id);

    if (!includeArchived) {
      children = children.filter((p: VikunjaProject) => !p.is_archived);
    }

    const childWord = children.length === 1 ? 'child project' : 'child projects';
    const response = createProjectResponse(
      'get-project-children',
      `Found ${children.length} ${childWord} for project ID ${id}`,
      { children },
      { parentId: id, count: children.length },
      verbosity,
      useOptimizedFormat,
      useAorp
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response.response),
        }
      ]
    };
  } catch (error) {
    if (error instanceof MCPError) {
      throw error;
    }
    throw transformApiError(error, 'Failed to get project children');
  }
}

/**
 * Builds a complete project tree
 */
export async function getProjectTree(
  args: GetTreeArgs,
  _context: unknown,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { id, maxDepth = 10, includeArchived = false, verbosity, useOptimizedFormat, useAorp } = args;

  // Validate that project ID is provided for tree operations
  if (id === undefined || id === null) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required');
  }
  validateId(id, 'id');

  try {
    // Get all projects
    const allProjects = await fetchAllProjects(authManager);

    const rootProjects = allProjects.filter((p: VikunjaProject) => !p.parent_project_id);

    // If specific ID is provided, find that project and its subtree
    let rootNode: ProjectTreeNode | null;
    let treeData: ProjectTreeNode[];
    let totalNodes = 0;
    let actualDepth = 0;

    if (id) {
      validateId(id, 'project id');
      const rootProject = allProjects.find((p: VikunjaProject) => p.id === id);
      if (!rootProject) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Project with ID ${id} not found`);
      }

      rootNode = buildProjectTree(rootProject, allProjects, 0, maxDepth, includeArchived);
      if (rootNode) {
        treeData = [rootNode];
        totalNodes = countTreeNodes(rootNode);
        actualDepth = getTreeDepth(rootNode);
      } else {
        treeData = [];
        totalNodes = 0;
        actualDepth = 0;
      }
    } else {
      // Build forest of all root projects
      treeData = rootProjects
        .map((project: VikunjaProject) => buildProjectTree(project, allProjects, 0, maxDepth, includeArchived))
        .filter(Boolean) as ProjectTreeNode[];

      totalNodes = treeData.reduce((sum, node) => sum + countTreeNodes(node), 0);
      actualDepth = treeData.reduce((max, node) => Math.max(max, getTreeDepth(node)), 0);
    }

    // Build options object, only including defined properties to satisfy exactOptionalPropertyTypes
    const options1: { verbosity?: string; useOptimizedFormat?: boolean; useAorp?: boolean } = {};

    if (verbosity !== undefined) {
      options1.verbosity = verbosity;
    }

    if (useOptimizedFormat !== undefined) {
      options1.useOptimizedFormat = useOptimizedFormat;
    }

    if (useAorp !== undefined) {
      options1.useAorp = useAorp;
    }

    const result = createProjectTreeResponse(
      treeData,
      actualDepth,
      totalNodes,
      options1
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
    throw transformApiError(error, 'Failed to get project tree');
  }
}

/**
 * Gets breadcrumb path from root to specified project
 */
export async function getProjectBreadcrumb(
  args: GetBreadcrumbArgs,
  _context: unknown,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { id, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    // Get all projects for navigation
    const allProjects = await fetchAllProjects(authManager);
    const targetProject = allProjects.find((p: VikunjaProject) => p.id === id);

    if (!targetProject) {
      throw new MCPError(ErrorCode.NOT_FOUND, `Project with ID ${id} not found`);
    }

    const breadcrumb = buildBreadcrumb(id, allProjects);

    // Build options object, only including defined properties to satisfy exactOptionalPropertyTypes
    const options2: { verbosity?: string; useOptimizedFormat?: boolean; useAorp?: boolean } = {};

    if (verbosity !== undefined) {
      options2.verbosity = verbosity;
    }

    if (useOptimizedFormat !== undefined) {
      options2.useOptimizedFormat = useOptimizedFormat;
    }

    if (useAorp !== undefined) {
      options2.useAorp = useAorp;
    }

    const result = createBreadcrumbResponse(
      breadcrumb,
      options2
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
    throw transformApiError(error, 'Failed to get project breadcrumb');
  }
}

/**
 * Moves a project to a new parent
 */
export async function moveProject(
  args: MoveProjectArgs,
  _context: unknown,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { id, parentProjectId, verbosity, useOptimizedFormat, useAorp } = args;

  try {
    validateId(id, 'project id');

    // Fetch all projects once: this both validates that the project exists
    // and provides the hierarchy data validateMoveConstraints needs, so a
    // separate getProject(id) round-trip isn't required.
    const allProjects = await fetchAllProjects(authManager);

    const currentProject = allProjects.find((p: VikunjaProject) => p.id === id);
    if (!currentProject) {
      throw new MCPError(ErrorCode.NOT_FOUND, `Project with ID ${id} not found`);
    }

    // Validate move constraints (self-parenting, circular references, depth)
    validateMoveConstraints(id, parentProjectId, allProjects);

    // Validate parent project ID if provided
    if (parentProjectId !== undefined) {
      validateId(parentProjectId, 'parentProjectId');
    }

    // If parent is specified, validate it exists
    if (parentProjectId) {
      const parentProject = allProjects.find((p: VikunjaProject) => p.id === parentProjectId);
      if (!parentProject) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Parent project with ID ${parentProjectId} not found`);
      }
    }

    // POST /projects/{id} is a full-model-replace endpoint: merge through
    // the current project (like crud.ts's updateProject/archiveProject) so
    // title/description/hex_color/etc. survive the move. Unlike a regular
    // update, an omitted parentProjectId here means "move to root" — so
    // parent_project_id is always set explicitly (0 clears it), never left
    // to buildProjectUpdatePayload's "only touch what's provided" default.
    const updateData = buildProjectUpdatePayload(currentProject, {
      parentProjectId: parentProjectId ?? 0,
    });
    const updatedProject = await vikunjaRestRequest<VikunjaProject>(
      authManager,
      'POST',
      `/projects/${id}`,
      updateData,
    );

    const parentInfo = parentProjectId
      ? ` to parent project ${parentProjectId}`
      : ' to root level';

    const result = createProjectResponse(
      'move_project',
      `Moved project "${updatedProject.title}"${parentInfo}`,
      { project: updatedProject },
      {
        oldParentProjectId: currentProject.parent_project_id,
        newParentProjectId: parentProjectId,
        movedProjectId: id
      },
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
    // `vikunjaRestRequest` throws MCPError with the HTTP status under
    // `details.statusCode` (not a bare `.statusCode` property
    // `handleStatusCodeError` looks for), so a REST-layer 404 from the
    // terminal update call is translated explicitly here — matching
    // crud.ts's `rethrowProjectNotFound`. Errors already thrown above as
    // MCPError (e.g. the NOT_FOUND checks against the fetched project list)
    // carry no `details.statusCode` and pass through unchanged.
    if (error instanceof MCPError) {
      if (error.details?.statusCode === 404) {
        throw new MCPError(ErrorCode.NOT_FOUND, `Project with ID ${id} not found`);
      }
      throw error;
    }
    throw transformApiError(error, 'Failed to move project');
  }
}

/**
 * Builds a project tree recursively
 */
function buildProjectTree(
  project: VikunjaProject,
  allProjects: VikunjaProject[],
  currentDepth: number,
  maxDepth: number,
  includeArchived: boolean = false
): ProjectTreeNode | null {
  if (currentDepth >= maxDepth) {
    return null;
  }

  const children = allProjects
    .filter((p: VikunjaProject) => p.parent_project_id === project.id)
    .filter((p: VikunjaProject) => includeArchived || !p.is_archived)
    .map((child: VikunjaProject) =>
      buildProjectTree(child, allProjects, currentDepth + 1, maxDepth, includeArchived)
    )
    .filter(Boolean) as ProjectTreeNode[];

  return {
    ...project,
    children,
    depth: currentDepth,
  };
}

/**
 * Counts total nodes in a tree
 */
function countTreeNodes(node: ProjectTreeNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countTreeNodes(child), 0);
}

/**
 * Gets the maximum depth of a tree
 */
function getTreeDepth(node: ProjectTreeNode): number {
  if (node.children.length === 0) {
    return node.depth;
  }
  return Math.max(...node.children.map(child => getTreeDepth(child)));
}

/**
 * Builds breadcrumb path from root to target project
 */
function buildBreadcrumb(targetId: number, allProjects: VikunjaProject[]): VikunjaProject[] {
  const breadcrumb: VikunjaProject[] = [];
  const visited = new Set<number>();
  let currentId: number | undefined = targetId;

  while (currentId !== undefined) {
    if (visited.has(currentId)) {
      throw new MCPError(
        ErrorCode.INTERNAL_ERROR,
        'Circular reference detected in project hierarchy while building breadcrumb'
      );
    }

    const project = allProjects.find((p: VikunjaProject) => p.id === currentId);
    if (!project) {
      break;
    }

    visited.add(currentId);
    breadcrumb.unshift(project);
    currentId = project.parent_project_id;
  }

  return breadcrumb;
}
