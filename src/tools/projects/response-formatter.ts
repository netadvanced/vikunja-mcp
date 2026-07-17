/**
 * Project Response Formatter Module
 * Handles AORP response creation and formatting for project operations
 */

import { createAorpResponse } from '../../utils/response-factory';
import { getDefaultVerbosity } from '../../transforms/base';
import type { ResponseMetadata } from '../../types/responses';
import type { ResponseData } from '../../utils/simple-response';
import type { AorpFactoryResult, AorpVerbosityLevel } from '../../types';
import type { Project } from 'node-vikunja';

/**
 * Project tree node interface
 */
interface ProjectTreeNode extends Project {
  children: ProjectTreeNode[];
  depth: number;
}

/**
 * Creates an AORP response for project operations
 */
export function createProjectResponse(
  operation: string,
  message: string,
  _data: unknown,
  _metadata: Partial<ResponseMetadata> = {},
  _verbosity?: string,
  _useOptimizedFormat?: boolean,
  _useAorp?: boolean
): AorpFactoryResult {
  // An explicit per-call verbosity always takes precedence over the
  // VIKUNJA_RESPONSE_VERBOSITY environment default.
  const selectedVerbosity = _verbosity ?? getDefaultVerbosity();

  // Cast data to ResponseData for type compatibility
  const responseData = _data as ResponseData;

  // Use simple response format
  const simpleAorpResult = createAorpResponse(operation, message, responseData, {
    success: true,
    metadata: {
      verbosity: selectedVerbosity,
    },
  });

  // Add transformation property for compatibility with AorpFactoryResult
  const mockOptimizedResponse = {
    success: true,
    operation,
    message,
    data: responseData,
    metadata: {
      timestamp: new Date().toISOString(),
    }
  };

  return {
    response: simpleAorpResult,
    transformation: {
      originalResponse: mockOptimizedResponse,
      context: {
        operation,
        success: true,
        dataSize: JSON.stringify(responseData).length,
        processingTime: 0,
        verbosity: selectedVerbosity,
        verbosityLevel: 'simple' as AorpVerbosityLevel,
        complexityFactors: {
        dataSize: JSON.stringify(responseData).length >= 1024,
        hasWarnings: false,
        hasErrors: false,
        isBulkOperation: false,
        isPartialSuccess: false,
        custom: {}
      }
      },
      metrics: {
        aorpProcessingTime: 0,
        totalTime: 0
      }
    }
  };
}

/**
 * Creates a success response for project operations
 */
export function createProjectSuccessResponse(
  operation: string,
  data: unknown,
  options: {
    message?: string;
    verbosity?: string;
    useOptimizedFormat?: boolean;
    useAorp?: boolean;
    metadata?: Partial<ResponseMetadata>;
  } = {}
): AorpFactoryResult {
  const {
    message = `${operation} operation completed successfully`,
    verbosity,
    useOptimizedFormat,
    useAorp,
    metadata = {}
  } = options;

  return createProjectResponse(
    operation,
    message,
    data,
    metadata,
    verbosity,
    useOptimizedFormat,
    useAorp
  );
}

/**
 * Creates a project list response with pagination metadata
 *
 * GET /projects returns a bare array with no total-count metadata in the
 * response body (the server does not report total items or total pages),
 * so this cannot honestly claim to know `totalPages`/`totalItems`. Instead
 * `hasMore` is derived from whether a full page was returned: if fewer than
 * `perPage` items came back, this is the last page.
 */
export function createProjectListResponse(
  projects: unknown[],
  currentPage: number,
  perPage: number,
  options: {
    verbosity?: string;
    useOptimizedFormat?: boolean;
    useAorp?: boolean;
  } = {}
): AorpFactoryResult {
  const hasMore = perPage > 0 && projects.length >= perPage;
  const metadata: Partial<ResponseMetadata> = {
    pagination: {
      page: currentPage,
      perPage,
      hasMore,
      nextPage: hasMore ? currentPage + 1 : undefined,
      prevPage: currentPage > 1 ? currentPage - 1 : undefined,
    },
  };

  const projectWord = projects.length === 1 ? 'project' : 'projects';
  const message = `Retrieved ${projects.length} ${projectWord}`;

  return createProjectSuccessResponse(
    'list_projects',
    projects,
    {
      message,
      ...options,
      metadata
    }
  );
}

/**
 * Creates a project tree response with hierarchy metadata
 */
export function createProjectTreeResponse(
  treeData: unknown,
  depth: number,
  totalNodes: number,
  options: {
    verbosity?: string;
    useOptimizedFormat?: boolean;
    useAorp?: boolean;
  } = {}
): AorpFactoryResult {
  const metadata: Partial<ResponseMetadata> = {
    hierarchy: {
      depth,
      totalNodes,
      maxDepth: 10, // From MAX_PROJECT_DEPTH
    },
    totalProjects: totalNodes,
  };

  const tree = treeData as ProjectTreeNode[];
  return createProjectSuccessResponse(
    'get-project-tree',
    { tree: tree.length === 1 ? tree[0] : tree },
    {
      message: `Retrieved project tree with ${totalNodes} nodes at depth ${depth}`,
      ...options,
      metadata
    }
  );
}

/**
 * Creates a breadcrumb response for project hierarchy navigation
 */
export function createBreadcrumbResponse(
  breadcrumb: Project[],
  options: {
    verbosity?: string;
    useOptimizedFormat?: boolean;
    useAorp?: boolean;
  } = {}
): AorpFactoryResult {
  const metadata: Partial<ResponseMetadata> = {
    navigation: {
      breadcrumbLength: breadcrumb.length,
      hasPath: breadcrumb.length > 0,
    },
    path: breadcrumb.map((p: Project) => p.title).join(' > ') || 'Root',
    depth: breadcrumb.length,
  };

  return createProjectSuccessResponse(
    'get-project-breadcrumb',
    { breadcrumb },
    {
      message: `Retrieved breadcrumb path with ${breadcrumb.length} items`,
      ...options,
      metadata
    }
  );
}