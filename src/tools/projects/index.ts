/**
 * Projects Tool Module - Main Orchestrator
 * Coordinates all project-related operations through specialized submodules
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../../auth/AuthManager';
import type { VikunjaClientFactory } from '../../client/VikunjaClientFactory';
import { getAuthManagerFromContext, hasRequestContext } from '../../client';
import { MCPError, ErrorCode } from '../../types';
import type { McpResponse } from './crud';
import { createAuthRequiredError, wrapToolError } from '../../utils/error-handler';
import { validateId } from './validation';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../../utils/read-only';
import { ConfigurationManager, isModuleEnabled } from '../../config';
import { logger } from '../../utils/logger';

// Import all submodule operations
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  type ListProjectsArgs,
  type GetProjectArgs,
  type CreateProjectArgs,
  type UpdateProjectArgs,
  type DeleteProjectArgs,
  type ArchiveProjectArgs
} from './crud';

import {
  getProjectChildren,
  getProjectTree,
  getProjectBreadcrumb,
  moveProject,
  type GetChildrenArgs,
  type GetTreeArgs,
  type GetBreadcrumbArgs,
  type MoveProjectArgs
} from './hierarchy';

import {
  createProjectShare,
  listProjectShares,
  getProjectShare,
  deleteProjectShare,
  authProjectShare,
  type CreateShareArgs,
  type ListSharesArgs,
  type GetShareArgs,
  type DeleteShareArgs,
  type AuthShareArgs
} from './sharing';

import {
  listBuckets,
  createBucket,
  updateBucket,
  deleteBucket,
  listViewTasks,
  type ListBucketsArgs,
  type CreateBucketArgs,
  type UpdateBucketArgs,
  type DeleteBucketArgs,
  type ListViewTasksArgs,
} from './buckets';

import {
  listViews,
  getView,
  createView,
  updateView,
  deleteView,
  setDoneBucket,
  type ListViewsArgs,
  type GetViewArgs,
  type CreateViewArgs,
  type UpdateViewArgs,
  type DeleteViewArgs,
  type SetDoneBucketArgs,
} from './views';

import { duplicateProject, type DuplicateProjectArgs } from './duplicate';

import {
  removeProjectBackground,
  setUnsplashBackground,
  searchUnsplashBackgrounds,
  type RemoveBackgroundArgs,
  type SetUnsplashBackgroundArgs,
  type SearchUnsplashArgs,
} from './backgrounds';

import {
  listProjectUsers,
  searchProjectUsers,
  addProjectUser,
  updateProjectUserPermission,
  removeProjectUser,
  listProjectTeams,
  addProjectTeam,
  updateProjectTeamPermission,
  removeProjectTeam,
  shareProjectWithUser,
  shareProjectWithTeam,
  listProjectMembers,
  type ListProjectUsersArgs,
  type SearchProjectUsersArgs,
  type AddProjectUserArgs,
  type UpdateProjectUserPermissionArgs,
  type RemoveProjectUserArgs,
  type ListProjectTeamsArgs,
  type AddProjectTeamArgs,
  type UpdateProjectTeamPermissionArgs,
  type RemoveProjectTeamArgs,
  type ShareWithUserArgs,
  type ShareWithTeamArgs,
  type ListMembersArgs
} from './sharing-access';

// The three project-backgrounds subcommands (G7,
// docs/ENDPOINT-TAIL-RETRIAGE.md) live behind the opt-in, deny-by-default
// `backgrounds` module config key (src/config/types.ts) — the deliberate
// opposite of every other default-ON domain module. Every other module in
// this codebase gates a whole standalone tool at registration time so a
// disabled module's tools are "invisible to the client, not merely
// rejected at call time" (docs/CONFIGURATION.md). `backgrounds` gates only
// three subcommands *within* the always-registered `vikunja_projects` tool,
// so that same "genuinely absent from the schema" contract is reproduced
// here at the subcommand-enum level instead: the enum literally does not
// contain these three strings when the module is disabled, so a call
// naming one of them fails MCP schema validation (an unrecognized enum
// value) rather than being accepted and then rejected by handler logic.
const BACKGROUND_SUBCOMMANDS = [
  'remove-background',
  'set-unsplash-background',
  'search-unsplash',
] as const;

/**
 * Subcommands that identify their target project via the flat `id` field
 * (every CRUD/hierarchy/Kanban-bucket/view/duplicate/backgrounds operation).
 * The sharing-domain subcommands (create-share, share-with-user, etc.) are
 * deliberately excluded — they already use the sibling `projectId` field for
 * this purpose, so aliasing there would be redundant, not a fix.
 *
 * Both `id` and `projectId` are flat sibling fields on the same Zod schema
 * object (`projectId` exists for the sharing subcommands), so an agent
 * reasonably reaches for `projectId` first when targeting one of these
 * id-domain subcommands too — a real, reproduced friction (battle-tested:
 * `list-buckets` was first called with `projectId`, only succeeding on a
 * retry with `id`). Rather than patch `list-buckets` alone, `projectId` is
 * accepted as an alias for `id` across every subcommand in this set.
 */
const PROJECT_ID_ALIAS_SUBCOMMANDS = new Set<string>([
  'get',
  'update',
  'delete',
  'archive',
  'unarchive',
  'get-children',
  'get-tree',
  'get-breadcrumb',
  'move',
  'list-buckets',
  'create-bucket',
  'update-bucket',
  'delete-bucket',
  'list-view-tasks',
  'list-views',
  'get-view',
  'create-view',
  'update-view',
  'delete-view',
  'set-done-bucket',
  'duplicate',
  'remove-background',
  'set-unsplash-background',
  'search-unsplash',
]);

/**
 * Resolves whether the `backgrounds` module is enabled, failing safe to
 * disabled (matching the schema default and the "opt-in" contract) rather
 * than fatal — same fail-safe rationale as `resolveModulesConfig` in
 * `src/tools/index.ts`. `override` lets `registerTools` pass down a value
 * it already computed once (avoiding a second `loadConfiguration()` call);
 * omitted, this resolves independently — used by direct unit-test call
 * sites that instantiate `registerProjectsTool` without going through
 * `registerTools`.
 */
export function resolveBackgroundsEnabled(override?: boolean): boolean {
  if (override !== undefined) {
    return override;
  }
  try {
    return isModuleEnabled(ConfigurationManager.getInstance().loadConfiguration().modules.backgrounds);
  } catch (error) {
    logger.error(
      'Failed to load module gating configuration while resolving the backgrounds module; ' +
        'defaulting to disabled (opt-in, deny-by-default):',
      error,
    );
    return false;
  }
}

/**
 * Legacy single-tool interface for backward compatibility
 * Registers a single tool with all subcommands like the original implementation
 */
export function registerProjectsTool(
  server: McpServer,
  authManager: AuthManager,
  clientFactory?: VikunjaClientFactory,
  backgroundsEnabledOverride?: boolean,
): void {
  const backgroundsEnabled = resolveBackgroundsEnabled(backgroundsEnabledOverride);
  const baseSubcommands = [
    'list', 'get', 'create', 'update', 'delete', 'archive', 'unarchive',
    'get-children', 'get-tree', 'get-breadcrumb', 'move',
    'create-share', 'list-shares', 'get-share', 'delete-share', 'auth-share',
    'list-buckets', 'create-bucket', 'update-bucket', 'delete-bucket',
    'list-views', 'get-view', 'create-view', 'update-view', 'delete-view',
    'set-done-bucket', 'list-view-tasks', 'duplicate',
    // Direct user/team sharing — primitives
    'list-project-users', 'search-project-users', 'add-project-user',
    'update-project-user-permission', 'remove-project-user',
    'list-project-teams', 'add-project-team',
    'update-project-team-permission', 'remove-project-team',
    // Direct user/team sharing — composites
    'share-with-user', 'share-with-team', 'list-members',
  ];
  const subcommandValues = (
    backgroundsEnabled ? [...baseSubcommands, ...BACKGROUND_SUBCOMMANDS] : baseSubcommands
  ) as [string, ...string[]];

  server.tool(
    'vikunja_projects',
    withReadOnlyNote(
      'vikunja_projects',
      'Manage projects with full CRUD operations, hierarchy management, sharing capabilities, project views, Kanban buckets, and duplication. '
      + 'CRUD/hierarchy/Kanban-bucket/view/duplicate/backgrounds subcommands (get, update, delete, archive, unarchive, get-children, get-tree, '
      + 'get-breadcrumb, move, list-buckets, create-bucket, update-bucket, delete-bucket, list-view-tasks, list-views, get-view, create-view, '
      + 'update-view, delete-view, set-done-bucket, duplicate, and the backgrounds subcommands) identify the target project via `id` — `projectId` '
      + 'is accepted there too as an alias for `id`. Sharing subcommands (create-share, share-with-user, list-project-users, etc.) use `projectId` only.'
      + (backgroundsEnabled
        ? ' The opt-in backgrounds module adds remove-background/set-unsplash-background/search-unsplash'
        : ''),
    ),
    {
      subcommand: z.enum(subcommandValues),
      // CRUD arguments. `id` is the project id used by CRUD/hierarchy/
      // Kanban-bucket/view/duplicate/backgrounds subcommands — `projectId`
      // (below, under Sharing arguments) is accepted as an alias for `id` on
      // those subcommands (see PROJECT_ID_ALIAS_SUBCOMMANDS); the sharing
      // subcommands use `projectId` directly instead.
      id: z.number().positive().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      parentProjectId: z.number().positive().optional(),
      isArchived: z.boolean().optional(),
      hexColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      page: z.number().min(1).optional(),
      perPage: z.number().min(1).max(100).optional(),
      search: z.string().optional(),
      // Hierarchy arguments
      maxDepth: z.number().min(1).max(20).optional(),
      includeArchived: z.boolean().optional(),
      // Kanban bucket arguments (list-buckets, create-bucket, update-bucket,
      // delete-bucket, list-view-tasks, set-done-bucket subcommands).
      // z.coerce tolerates MCP clients whose cached tool schema predates
      // this param and therefore send it as a string over JSON-RPC.
      viewId: z.coerce.number().positive().optional(),
      bucketId: z.coerce.number().positive().optional(),
      bucketTitle: z.string().optional(),
      limit: z.coerce.number().min(0).optional(),
      // Lane-order position for create-bucket/update-bucket. Vikunja
      // positions are float64s — fractional values slot a bucket between
      // two neighbors (e.g. 250 between Doing at 200 and Done at 300).
      position: z.coerce.number().min(0).optional(),
      // Project view arguments (list-views, get-view, create-view,
      // update-view, delete-view, set-done-bucket subcommands).
      viewKind: z.enum(['list', 'gantt', 'table', 'kanban']).optional(),
      bucketConfigurationMode: z.enum(['none', 'manual', 'filter']).optional(),
      doneBucketId: z.coerce.number().positive().optional(),
      defaultBucketId: z.coerce.number().positive().optional(),
      // Duplicate-project arguments (duplicate subcommand).
      duplicateShares: z.boolean().optional(),
      // Sharing arguments (link shares + direct user/team sharing)
      projectId: z.number().positive().optional(),
      shareId: z.string().optional(),
      shareHash: z.string().optional(),
      right: z.union([z.enum(['read', 'write', 'admin']), z.literal(0), z.literal(1), z.literal(2)]).optional(),
      name: z.string().optional(),
      password: z.string().optional(),
      // Direct user/team sharing arguments
      username: z.string().optional(),
      teamName: z.string().optional(),
      userId: z.number().positive().optional(),
      teamId: z.number().positive().optional(),
      // Opt-in atomic rollback for share-with-user / share-with-team — see
      // CompositeOperation (src/utils/composite-operation.ts) and
      // docs/ENDPOINT-PLAYBOOK.md §5. Default false (best-effort).
      atomic: z.boolean().optional(),
      // Project backgrounds arguments (opt-in `backgrounds` module —
      // set-unsplash-background / search-unsplash subcommands). `page`
      // above is reused for search-unsplash's pagination (maps to the
      // API's `p` query param).
      unsplashImageId: z.string().optional(),
      unsplashQuery: z.string().optional(),
      // Session ID for AORP response tracking
      sessionId: z.string().optional(),
    },
    getToolAnnotations('vikunja_projects'),
    async (rawArgs, context) => {
      // Ergonomic id/projectId alias — see PROJECT_ID_ALIAS_SUBCOMMANDS above.
      const args =
        PROJECT_ID_ALIAS_SUBCOMMANDS.has(rawArgs.subcommand) &&
        (rawArgs.id === undefined || rawArgs.id === null) &&
        rawArgs.projectId !== undefined &&
        rawArgs.projectId !== null
          ? { ...rawArgs, id: rawArgs.projectId }
          : rawArgs;
      try {
        // Check authentication with enhanced error message
        // (closure-gate precedence fix: defer to the per-request context
        // when bound — see hasRequestContext's doc comment, src/client.ts)
        if (hasRequestContext()) {
          await getAuthManagerFromContext();
        } else if (!authManager.isAuthenticated()) {
          throw createAuthRequiredError('access project management features');
        }

        assertWriteAllowed('vikunja_projects', args.subcommand);

        // Set the client factory for this request if provided
        if (clientFactory) {
          const { setGlobalClientFactory } = await import('../../client.js');
          await setGlobalClientFactory(clientFactory);
        }

        try {
        const result = await (async (): Promise<McpResponse> => {
          switch (args.subcommand) {
            // CRUD operations
            case 'list':
              return await listProjects(args as ListProjectsArgs, authManager);

            case 'get':
              if (args.id === undefined || args.id === null) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required');
              }
              validateId(args.id, 'id');
              return await getProject(args as GetProjectArgs, authManager);

            case 'create':
              if (!args.title) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project title is required for create operation');
              }
              return await createProject(args as CreateProjectArgs, authManager);

          case 'update':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update operation');
            }
            return await updateProject(args as UpdateProjectArgs, authManager);

          case 'delete':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for delete operation');
            }
            return await deleteProject(args as DeleteProjectArgs, authManager);

          case 'archive':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for archive operation');
            }
            return await archiveProject(args as ArchiveProjectArgs, authManager);

          case 'unarchive':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for unarchive operation');
            }
            return await unarchiveProject(args as ArchiveProjectArgs, authManager);

          // Hierarchy operations
          case 'get-children':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for get-children operation');
            }
            return await getProjectChildren(args as GetChildrenArgs, context, authManager);

          case 'get-tree':
            return await getProjectTree(args as GetTreeArgs, context, authManager);

          case 'get-breadcrumb':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for get-breadcrumb operation');
            }
            return await getProjectBreadcrumb(args as GetBreadcrumbArgs, context, authManager);

          case 'move':
            if (args.id === undefined || args.id === null) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for move operation');
            }
            validateId(args.id, 'id');
            return await moveProject(args as MoveProjectArgs, context, authManager);

          // Sharing operations — link shares
          case 'create-share':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required');
            }
            return await createProjectShare(args as CreateShareArgs, authManager);

          case 'list-shares':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required');
            }
            return await listProjectShares(args as ListSharesArgs, authManager);

          case 'get-share':
            if (args.shareId === undefined || args.shareId === null) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share ID is required');
            }
            if (args.shareId.trim() === '') {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share ID must be a non-empty string');
            }
            return await getProjectShare(args as GetShareArgs, authManager);

          case 'delete-share':
            if (args.shareId === undefined || args.shareId === null) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share ID is required');
            }
            if (args.shareId.trim() === '') {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share ID must be a non-empty string');
            }
            return await deleteProjectShare(args as DeleteShareArgs, authManager);

          case 'auth-share': {
            if (!args.shareHash) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share hash is required');
            }
            const authShareArgs: AuthShareArgs = {
              shareHash: args.shareHash
            };
            if (args.projectId !== undefined) authShareArgs.projectId = args.projectId;
            if (args.password !== undefined) authShareArgs.password = args.password;
            return await authProjectShare(authShareArgs, authManager);
          }

          // Sharing operations — direct user access (primitives)
          case 'list-project-users':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for list-project-users operation');
            }
            return await listProjectUsers(args as ListProjectUsersArgs, authManager);

          case 'search-project-users':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for search-project-users operation');
            }
            return await searchProjectUsers(args as SearchProjectUsersArgs, authManager);

          case 'add-project-user':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for add-project-user operation');
            }
            if (!args.username) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'username is required for add-project-user operation');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required for add-project-user operation');
            }
            return await addProjectUser(args as AddProjectUserArgs, authManager);

          case 'update-project-user-permission':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update-project-user-permission operation');
            }
            if (!args.userId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'userId is required for update-project-user-permission operation');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required for update-project-user-permission operation');
            }
            return await updateProjectUserPermission(args as UpdateProjectUserPermissionArgs, authManager);

          case 'remove-project-user':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for remove-project-user operation');
            }
            if (!args.userId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'userId is required for remove-project-user operation');
            }
            return await removeProjectUser(args as RemoveProjectUserArgs, authManager);

          // Sharing operations — direct team access (primitives)
          case 'list-project-teams':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for list-project-teams operation');
            }
            return await listProjectTeams(args as ListProjectTeamsArgs, authManager);

          case 'add-project-team':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for add-project-team operation');
            }
            if (!args.teamId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'teamId is required for add-project-team operation');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required for add-project-team operation');
            }
            return await addProjectTeam(args as AddProjectTeamArgs, authManager);

          case 'update-project-team-permission':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update-project-team-permission operation');
            }
            if (!args.teamId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'teamId is required for update-project-team-permission operation');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required for update-project-team-permission operation');
            }
            return await updateProjectTeamPermission(args as UpdateProjectTeamPermissionArgs, authManager);

          case 'remove-project-team':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for remove-project-team operation');
            }
            if (!args.teamId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'teamId is required for remove-project-team operation');
            }
            return await removeProjectTeam(args as RemoveProjectTeamArgs, authManager);

          // Sharing operations — composites
          case 'share-with-user':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for share-with-user operation');
            }
            if (!args.username) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'username is required for share-with-user operation');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required for share-with-user operation');
            }
            return await shareProjectWithUser(args as ShareWithUserArgs, authManager);

          case 'share-with-team':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for share-with-team operation');
            }
            if (!args.teamName) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'teamName is required for share-with-team operation');
            }
            if (!args.right) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required for share-with-team operation');
            }
            return await shareProjectWithTeam(args as ShareWithTeamArgs, authManager);

          case 'list-members':
            if (!args.projectId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for list-members operation');
            }
            return await listProjectMembers(args as ListMembersArgs, authManager);

          // Kanban bucket operations
          case 'list-buckets':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for list-buckets operation');
            }
            validateId(args.id, 'id');
            return await listBuckets(args as ListBucketsArgs, authManager);

          case 'create-bucket':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for create-bucket operation');
            }
            validateId(args.id, 'id');
            return await createBucket(args as CreateBucketArgs, authManager);

          case 'update-bucket':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update-bucket operation');
            }
            validateId(args.id, 'id');
            return await updateBucket(args as UpdateBucketArgs, authManager);

          case 'delete-bucket':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for delete-bucket operation');
            }
            validateId(args.id, 'id');
            return await deleteBucket(args as DeleteBucketArgs, authManager);

          case 'list-view-tasks':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for list-view-tasks operation');
            }
            validateId(args.id, 'id');
            return await listViewTasks(args as ListViewTasksArgs, authManager);

          // Project view operations
          case 'list-views':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for list-views operation');
            }
            validateId(args.id, 'id');
            return await listViews(args as ListViewsArgs, authManager);

          case 'get-view':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for get-view operation');
            }
            validateId(args.id, 'id');
            return await getView(args as GetViewArgs, authManager);

          case 'create-view':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for create-view operation');
            }
            validateId(args.id, 'id');
            return await createView(args as CreateViewArgs, authManager);

          case 'update-view':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update-view operation');
            }
            validateId(args.id, 'id');
            return await updateView(args as UpdateViewArgs, authManager);

          case 'delete-view':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for delete-view operation');
            }
            validateId(args.id, 'id');
            return await deleteView(args as DeleteViewArgs, authManager);

          case 'set-done-bucket':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for set-done-bucket operation');
            }
            validateId(args.id, 'id');
            return await setDoneBucket(args as SetDoneBucketArgs, authManager);

          // Duplicate operation
          case 'duplicate':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for duplicate operation');
            }
            validateId(args.id, 'id');
            return await duplicateProject(args as DuplicateProjectArgs, authManager);

          // Project backgrounds (G7, opt-in `backgrounds` module). Only
          // reachable when the module is enabled — see
          // BACKGROUND_SUBCOMMANDS above; the zod enum itself excludes
          // these subcommand strings when the module is disabled, so an
          // unrecognized-subcommand rejection happens at schema validation
          // time in that case, never reaching this switch.
          case 'remove-background':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for remove-background operation');
            }
            validateId(args.id, 'id');
            return await removeProjectBackground(args as RemoveBackgroundArgs, authManager);

          case 'set-unsplash-background':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for set-unsplash-background operation');
            }
            validateId(args.id, 'id');
            if (!args.unsplashImageId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'unsplashImageId is required for set-unsplash-background operation');
            }
            return await setUnsplashBackground(args as SetUnsplashBackgroundArgs, authManager);

          case 'search-unsplash':
            return await searchUnsplashBackgrounds(args as SearchUnsplashArgs, authManager);

          default:
            throw new MCPError(ErrorCode.VALIDATION_ERROR, `Unknown subcommand: ${String(args.subcommand)}`);
        }
        })();

        return result;
        } catch (error) {
          throw wrapToolError(error, 'vikunja_projects', args.subcommand, args.id);
        }
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  );
}

// Export all types for external use
export type {
  ListProjectsArgs,
  GetProjectArgs,
  CreateProjectArgs,
  UpdateProjectArgs,
  DeleteProjectArgs,
  ArchiveProjectArgs,
  GetChildrenArgs,
  GetTreeArgs,
  GetBreadcrumbArgs,
  MoveProjectArgs,
  CreateShareArgs,
  ListSharesArgs,
  GetShareArgs,
  DeleteShareArgs,
  AuthShareArgs,
  ListBucketsArgs,
  CreateBucketArgs,
  UpdateBucketArgs,
  DeleteBucketArgs,
  ListViewTasksArgs,
  ListViewsArgs,
  GetViewArgs,
  CreateViewArgs,
  UpdateViewArgs,
  DeleteViewArgs,
  SetDoneBucketArgs,
  DuplicateProjectArgs,
  ListProjectUsersArgs,
  SearchProjectUsersArgs,
  AddProjectUserArgs,
  UpdateProjectUserPermissionArgs,
  RemoveProjectUserArgs,
  ListProjectTeamsArgs,
  AddProjectTeamArgs,
  UpdateProjectTeamPermissionArgs,
  RemoveProjectTeamArgs,
  ShareWithUserArgs,
  ShareWithTeamArgs,
  ListMembersArgs,
  RemoveBackgroundArgs,
  SetUnsplashBackgroundArgs,
  SearchUnsplashArgs
};

// Export all functions for direct use if needed
export {
  // CRUD
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,

  // Hierarchy
  getProjectChildren,
  getProjectTree,
  getProjectBreadcrumb,
  moveProject,

  // Sharing — link shares
  createProjectShare,
  listProjectShares,
  getProjectShare,
  deleteProjectShare,
  authProjectShare,

  // Kanban buckets
  listBuckets,
  createBucket,
  updateBucket,
  deleteBucket,
  listViewTasks,

  // Project views
  listViews,
  getView,
  createView,
  updateView,
  deleteView,
  setDoneBucket,

  // Duplicate
  duplicateProject,

  // Sharing — direct user/team access
  listProjectUsers,
  searchProjectUsers,
  addProjectUser,
  updateProjectUserPermission,
  removeProjectUser,
  listProjectTeams,
  addProjectTeam,
  updateProjectTeamPermission,
  removeProjectTeam,
  shareProjectWithUser,
  shareProjectWithTeam,
  listProjectMembers,

  // Backgrounds (opt-in `backgrounds` module)
  removeProjectBackground,
  setUnsplashBackground,
  searchUnsplashBackgrounds
};