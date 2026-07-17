/**
 * Direct project sharing with users & teams.
 *
 * Distinct from `sharing.ts` (anonymous/password link shares): this module
 * grants access to specific, named users and teams. Entirely new coverage —
 * this MCP server previously exposed no way to share a project with a user
 * or team directly (see docs/API-COVERAGE.md, HIGH finding). Built
 * direct-REST per the Wave D playbook (docs/ENDPOINT-PLAYBOOK.md); there is
 * no existing node-vikunja call site here to migrate.
 *
 * Endpoints (verified against docs/vikunja-openapi.json — note the body
 * field is `permission`, NOT node-vikunja's stale `right`):
 *   - GET    /projects/{id}/users                list users on a project
 *   - PUT    /projects/{id}/users                 add a user to a project
 *   - POST   /projects/{projectID}/users/{userID} update a user's permission
 *   - DELETE /projects/{projectID}/users/{userID} remove a user
 *   - GET    /projects/{id}/teams                 list teams on a project
 *   - PUT    /projects/{id}/teams                 add a team to a project
 *   - POST   /projects/{projectID}/teams/{teamID} update a team's permission
 *   - DELETE /projects/{projectID}/teams/{teamID} remove a team
 *   - GET    /projects/{id}/projectusers           project-scoped user search
 *   - GET    /users                                global user search (by username/name/email)
 *   - GET    /teams                                team search (by name)
 *
 * Composite-first (docs/ENDPOINT-PLAYBOOK.md §1): `share-with-user` and
 * `share-with-team` are the headline subcommands — they take a username or
 * team name plus a permission level, resolve it to an id internally, add
 * it, then verify the grant actually landed, using `CompositeOperation`
 * (src/utils/composite-operation.ts) for the multi-step write with opt-in
 * atomic rollback (remove-on-failure). Primitives (list/add/update/remove
 * by numeric id) remain available for fine-grained control. `list-members`
 * is a read composite answering "who has access to this project" (users +
 * teams + link shares) in one call.
 */

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';
import { vikunjaRestRequest } from '../../utils/vikunja-rest';
import { transformApiError } from '../../utils/error-handler';
import { validateId } from './validation';
import { resolvePermission, type PermissionInput } from './permission';
import { createStandardResponse, formatAorpAsMarkdown } from '../../utils/response-factory';
import { CompositeOperation } from '../../utils/composite-operation';
import { listProjectShares } from './sharing';
import type { components } from '../../types/generated/vikunja-openapi';
import type { ResponseData } from '../../utils/simple-response';

type VikunjaUser = components['schemas']['user.User'];
type VikunjaTeam = components['schemas']['models.Team'];
type VikunjaProjectUser = components['schemas']['models.ProjectUser'];
type VikunjaTeamProject = components['schemas']['models.TeamProject'];
type VikunjaUserWithPermission = components['schemas']['models.UserWithPermission'];
type VikunjaTeamWithPermission = components['schemas']['models.TeamWithPermission'];
type VikunjaMessage = components['schemas']['models.Message'];

type McpResponse = { content: Array<{ type: 'text'; text: string }> };

/**
 * `ResponseData` (src/utils/simple-response.ts) declares a `users?: User[]`
 * field typed against this codebase's own `types/vikunja.ts` `User`, which
 * predates and does not structurally match the OpenAPI-generated
 * `user.User`/`models.UserWithPermission` shapes this module deals in. The
 * response payload itself is fine (`createTaskResponse` only special-cases
 * a literal `tasks` key and otherwise passes data through untouched) — this
 * cast exists purely to satisfy that unrelated, more specific field type
 * without smuggling anything past runtime behavior.
 */
function toResponseData(data: Record<string, unknown>): ResponseData {
  return data as unknown as ResponseData;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** Re-throws a project-scoped 404 as a friendly not-found MCPError; everything else passes through `transformApiError`. */
function rethrow(error: unknown, notFoundMessage: string | undefined, context: string): never {
  if (error instanceof MCPError) {
    if (notFoundMessage && error.details?.statusCode === 404) {
      throw new MCPError(ErrorCode.NOT_FOUND, notFoundMessage);
    }
    throw error;
  }
  throw transformApiError(error, context);
}

// ---------------------------------------------------------------------------
// Primitives — users
// ---------------------------------------------------------------------------

export interface ListProjectUsersArgs {
  projectId: number;
  search?: string;
  page?: number;
  perPage?: number;
  sessionId?: string;
}

/** Lists the users who have direct access to a project, with their permission. */
export async function listProjectUsers(
  args: ListProjectUsersArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, search, page, perPage, sessionId } = args;
  validateId(projectId, 'projectId');

  try {
    const users = await vikunjaRestRequest<VikunjaUserWithPermission[]>(
      authManager,
      'GET',
      `/projects/${projectId}/users${buildQuery({ s: search, page, per_page: perPage })}`,
    );
    const userList = Array.isArray(users) ? users : [];

    const response = createStandardResponse(
      'list-project-users',
      `Found ${userList.length} user(s) with direct access to project ${projectId}`,
      toResponseData({ projectId, users: userList }),
      { timestamp: new Date().toISOString(), count: userList.length },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Project with ID ${projectId} not found`, 'Failed to list project users');
  }
}

export interface SearchProjectUsersArgs {
  projectId: number;
  search?: string;
  sessionId?: string;
}

/** Project-scoped user search (`GET /projects/{id}/projectusers`) — for finding a user to share with, distinct from the global `/users` search. */
export async function searchProjectUsers(
  args: SearchProjectUsersArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, search, sessionId } = args;
  validateId(projectId, 'projectId');

  try {
    const users = await vikunjaRestRequest<VikunjaUser[]>(
      authManager,
      'GET',
      `/projects/${projectId}/projectusers${buildQuery({ s: search })}`,
    );
    const userList = Array.isArray(users) ? users : [];

    const response = createStandardResponse(
      'search-project-users',
      `Found ${userList.length} user(s)${search ? ` matching "${search}"` : ''} for project ${projectId}`,
      toResponseData({ projectId, users: userList }),
      { timestamp: new Date().toISOString(), count: userList.length },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Project with ID ${projectId} not found`, 'Failed to search project users');
  }
}

export interface AddProjectUserArgs {
  projectId: number;
  username: string;
  right: PermissionInput;
  sessionId?: string;
}

/** Grants a named user direct access to a project (`PUT /projects/{id}/users`, body `{username, permission}`). */
export async function addProjectUser(
  args: AddProjectUserArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, username, right, sessionId } = args;
  validateId(projectId, 'projectId');
  if (!username || username.trim().length === 0) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'username is required');
  }
  const permission = resolvePermission(right);

  try {
    const body: VikunjaProjectUser = { username: username.trim(), permission };
    const created = await vikunjaRestRequest<VikunjaProjectUser>(
      authManager,
      'PUT',
      `/projects/${projectId}/users`,
      body,
    );

    const response = createStandardResponse(
      'add-project-user',
      `Granted "${username}" permission ${permission} on project ${projectId}`,
      { projectId, user: created },
      { timestamp: new Date().toISOString() },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Project with ID ${projectId} not found, or user "${username}" does not exist`, 'Failed to add project user');
  }
}

export interface UpdateProjectUserPermissionArgs {
  projectId: number;
  userId: number;
  right: PermissionInput;
  sessionId?: string;
}

/** Updates a user's permission on a project (`POST /projects/{projectID}/users/{userID}`, body `{permission}`). */
export async function updateProjectUserPermission(
  args: UpdateProjectUserPermissionArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, userId, right, sessionId } = args;
  validateId(projectId, 'projectId');
  validateId(userId, 'userId');
  const permission = resolvePermission(right);

  try {
    const body: Pick<VikunjaProjectUser, 'permission'> = { permission };
    const updated = await vikunjaRestRequest<VikunjaProjectUser>(
      authManager,
      'POST',
      `/projects/${projectId}/users/${userId}`,
      body,
    );

    const response = createStandardResponse(
      'update-project-user-permission',
      `Updated user ${userId}'s permission on project ${projectId} to ${permission}`,
      { projectId, userId, user: updated },
      { timestamp: new Date().toISOString() },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `User ${userId} does not have access to project ${projectId}`, 'Failed to update project user permission');
  }
}

export interface RemoveProjectUserArgs {
  projectId: number;
  userId: number;
  sessionId?: string;
}

/** Removes a user's direct access to a project (`DELETE /projects/{projectID}/users/{userID}`). */
export async function removeProjectUser(
  args: RemoveProjectUserArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, userId, sessionId } = args;
  validateId(projectId, 'projectId');
  validateId(userId, 'userId');

  try {
    await vikunjaRestRequest<VikunjaMessage>(
      authManager,
      'DELETE',
      `/projects/${projectId}/users/${userId}`,
    );

    const response = createStandardResponse(
      'remove-project-user',
      `Removed user ${userId}'s access to project ${projectId}`,
      { projectId, userId, removed: true },
      { timestamp: new Date().toISOString() },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `User ${userId} does not have access to project ${projectId}`, 'Failed to remove project user');
  }
}

// ---------------------------------------------------------------------------
// Primitives — teams
// ---------------------------------------------------------------------------

export interface ListProjectTeamsArgs {
  projectId: number;
  search?: string;
  page?: number;
  perPage?: number;
  sessionId?: string;
}

/** Lists the teams with direct access to a project, with their permission. */
export async function listProjectTeams(
  args: ListProjectTeamsArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, search, page, perPage, sessionId } = args;
  validateId(projectId, 'projectId');

  try {
    const teams = await vikunjaRestRequest<VikunjaTeamWithPermission[]>(
      authManager,
      'GET',
      `/projects/${projectId}/teams${buildQuery({ s: search, page, per_page: perPage })}`,
    );
    const teamList = Array.isArray(teams) ? teams : [];

    const response = createStandardResponse(
      'list-project-teams',
      `Found ${teamList.length} team(s) with direct access to project ${projectId}`,
      { projectId, teams: teamList },
      { timestamp: new Date().toISOString(), count: teamList.length },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Project with ID ${projectId} not found`, 'Failed to list project teams');
  }
}

export interface AddProjectTeamArgs {
  projectId: number;
  teamId: number;
  right: PermissionInput;
  sessionId?: string;
}

/** Grants a team direct access to a project (`PUT /projects/{id}/teams`, body `{team_id, permission}`). */
export async function addProjectTeam(
  args: AddProjectTeamArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, teamId, right, sessionId } = args;
  validateId(projectId, 'projectId');
  validateId(teamId, 'teamId');
  const permission = resolvePermission(right);

  try {
    const body: VikunjaTeamProject = { team_id: teamId, permission };
    const created = await vikunjaRestRequest<VikunjaTeamProject>(
      authManager,
      'PUT',
      `/projects/${projectId}/teams`,
      body,
    );

    const response = createStandardResponse(
      'add-project-team',
      `Granted team ${teamId} permission ${permission} on project ${projectId}`,
      { projectId, team: created },
      { timestamp: new Date().toISOString() },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Project with ID ${projectId} not found, or team ${teamId} does not exist`, 'Failed to add project team');
  }
}

export interface UpdateProjectTeamPermissionArgs {
  projectId: number;
  teamId: number;
  right: PermissionInput;
  sessionId?: string;
}

/** Updates a team's permission on a project (`POST /projects/{projectID}/teams/{teamID}`, body `{permission}`). */
export async function updateProjectTeamPermission(
  args: UpdateProjectTeamPermissionArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, teamId, right, sessionId } = args;
  validateId(projectId, 'projectId');
  validateId(teamId, 'teamId');
  const permission = resolvePermission(right);

  try {
    const body: Pick<VikunjaTeamProject, 'permission'> = { permission };
    const updated = await vikunjaRestRequest<VikunjaTeamProject>(
      authManager,
      'POST',
      `/projects/${projectId}/teams/${teamId}`,
      body,
    );

    const response = createStandardResponse(
      'update-project-team-permission',
      `Updated team ${teamId}'s permission on project ${projectId} to ${permission}`,
      { projectId, teamId, team: updated },
      { timestamp: new Date().toISOString() },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Team ${teamId} does not have access to project ${projectId}`, 'Failed to update project team permission');
  }
}

export interface RemoveProjectTeamArgs {
  projectId: number;
  teamId: number;
  sessionId?: string;
}

/** Removes a team's direct access to a project (`DELETE /projects/{projectID}/teams/{teamID}`). */
export async function removeProjectTeam(
  args: RemoveProjectTeamArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, teamId, sessionId } = args;
  validateId(projectId, 'projectId');
  validateId(teamId, 'teamId');

  try {
    await vikunjaRestRequest<VikunjaMessage>(
      authManager,
      'DELETE',
      `/projects/${projectId}/teams/${teamId}`,
    );

    const response = createStandardResponse(
      'remove-project-team',
      `Removed team ${teamId}'s access to project ${projectId}`,
      { projectId, teamId, removed: true },
      { timestamp: new Date().toISOString() },
      sessionId,
    );
    return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
  } catch (error) {
    rethrow(error, `Team ${teamId} does not have access to project ${projectId}`, 'Failed to remove project team');
  }
}

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

/** Finds an exact (case-insensitive) username match among global user search results. */
function findExactUsername(users: VikunjaUser[], username: string): VikunjaUser | undefined {
  const target = username.trim().toLowerCase();
  return users.find((u) => (u.username ?? '').toLowerCase() === target);
}

/** Finds an exact (case-insensitive) team name match among team search results. */
function findExactTeamName(teams: VikunjaTeam[], teamName: string): VikunjaTeam | undefined {
  const target = teamName.trim().toLowerCase();
  return teams.find((t) => (t.name ?? '').toLowerCase() === target);
}

export interface ShareWithUserArgs {
  projectId: number;
  username: string;
  right: PermissionInput;
  /**
   * Opt into atomic rollback: if the post-add verification fails, the grant
   * is removed. Default `false` (best-effort) — see
   * docs/ENDPOINT-PLAYBOOK.md §5 / `CompositeOperation`'s design rule (a).
   * This is best-effort compensation against a live API, not a real
   * transaction: side effects of the `add-user` step (e.g. any webhook it
   * fires) are not undone by the rollback.
   */
  atomic?: boolean;
  sessionId?: string;
}

/**
 * Composite: share a project with a user by **username**. Resolves the
 * username to a user id via the global user search (`GET /users?s=`), adds
 * the user to the project, then verifies the grant actually landed by
 * re-reading the project's user list. Uses `CompositeOperation` so a failed
 * verification can (opt-in, `atomic: true`) remove the just-added grant
 * rather than leaving a silently-unverified share in place.
 */
export async function shareProjectWithUser(
  args: ShareWithUserArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, username, right, atomic = false, sessionId } = args;
  validateId(projectId, 'projectId');
  if (!username || username.trim().length === 0) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'username is required');
  }
  const permission = resolvePermission(right);

  let resolvedUserId: number | undefined;

  const op = new CompositeOperation();

  op.addStep<VikunjaUser, undefined>({
    name: 'resolve-user',
    execute: async () => {
      let candidates: VikunjaUser[];
      try {
        candidates = await vikunjaRestRequest<VikunjaUser[]>(
          authManager,
          'GET',
          `/users${buildQuery({ s: username })}`,
        );
      } catch (error) {
        rethrow(error, undefined, 'Failed to search for user');
      }
      const match = findExactUsername(Array.isArray(candidates) ? candidates : [], username);
      if (!match || match.id === undefined) {
        throw new MCPError(
          ErrorCode.NOT_FOUND,
          `No user found with username "${username}"`,
        );
      }
      resolvedUserId = match.id;
      return match;
    },
  });

  op.addStep<VikunjaProjectUser, undefined>({
    name: 'add-user',
    execute: async (ctx) => {
      const resolvedUser = ctx.results.get('resolve-user') as VikunjaUser;
      // `resolve-user` only ever returns a match whose `.username` compared
      // equal (case-insensitively) to the non-empty target username, so it
      // cannot be undefined here — `user.User.username` is merely optional
      // in the schema because it's absent from *other* endpoints' responses.
      const resolvedUsername = resolvedUser.username as string;
      try {
        return await vikunjaRestRequest<VikunjaProjectUser>(
          authManager,
          'PUT',
          `/projects/${projectId}/users`,
          { username: resolvedUsername, permission } satisfies VikunjaProjectUser,
        );
      } catch (error) {
        rethrow(error, `Project with ID ${projectId} not found`, 'Failed to add user to project');
      }
    },
    compensate: async () => {
      if (resolvedUserId === undefined) return undefined;
      await vikunjaRestRequest<VikunjaMessage>(
        authManager,
        'DELETE',
        `/projects/${projectId}/users/${resolvedUserId}`,
      );
      return undefined;
    },
  });

  op.addStep<boolean, undefined>({
    name: 'verify-membership',
    execute: async (ctx) => {
      const resolvedUser = ctx.results.get('resolve-user') as VikunjaUser;
      let users: VikunjaUserWithPermission[];
      try {
        users = await vikunjaRestRequest<VikunjaUserWithPermission[]>(
          authManager,
          'GET',
          `/projects/${projectId}/users`,
        );
      } catch (error) {
        rethrow(error, undefined, 'Failed to verify project share');
      }
      const found = Array.isArray(users) && users.some((u) => u.id === resolvedUser.id);
      if (!found) {
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `User "${username}" was added to project ${projectId} but did not appear in the project's user list on verification`,
        );
      }
      return true;
    },
  });

  const result = await op.run({ atomic });

  if (!result.ok) {
    const err =
      result.error instanceof Error
        ? result.error
        : new Error(String(result.error));
    throw new MCPError(
      err instanceof MCPError ? err.code : ErrorCode.API_ERROR,
      `share-with-user failed: ${err.message}${result.guidance ? `\n${result.guidance}` : ''}`,
      { vikunjaError: result },
    );
  }

  const response = createStandardResponse(
    'share-with-user',
    `Shared project ${projectId} with user "${username}" (permission ${permission})`,
    { projectId, username, permission, atomic, trace: result.steps },
    { timestamp: new Date().toISOString() },
    sessionId,
  );
  return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
}

export interface ShareWithTeamArgs {
  projectId: number;
  teamName: string;
  right: PermissionInput;
  /** Opt into atomic rollback — see `ShareWithUserArgs.atomic`. */
  atomic?: boolean;
  sessionId?: string;
}

/**
 * Composite: share a project with a team by **name**. Resolves the team
 * name to a team id via `GET /teams?s=`, adds the team to the project, then
 * verifies the grant landed by re-reading the project's team list. Same
 * `CompositeOperation` + opt-in atomic rollback shape as `share-with-user`.
 */
export async function shareProjectWithTeam(
  args: ShareWithTeamArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, teamName, right, atomic = false, sessionId } = args;
  validateId(projectId, 'projectId');
  if (!teamName || teamName.trim().length === 0) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'teamName is required');
  }
  const permission = resolvePermission(right);

  let resolvedTeamId: number | undefined;

  const op = new CompositeOperation();

  op.addStep<VikunjaTeam, undefined>({
    name: 'resolve-team',
    execute: async () => {
      let candidates: VikunjaTeam[];
      try {
        candidates = await vikunjaRestRequest<VikunjaTeam[]>(
          authManager,
          'GET',
          `/teams${buildQuery({ s: teamName })}`,
        );
      } catch (error) {
        rethrow(error, undefined, 'Failed to search for team');
      }
      const match = findExactTeamName(Array.isArray(candidates) ? candidates : [], teamName);
      if (!match || match.id === undefined) {
        throw new MCPError(ErrorCode.NOT_FOUND, `No team found with name "${teamName}"`);
      }
      resolvedTeamId = match.id;
      return match;
    },
  });

  op.addStep<VikunjaTeamProject, undefined>({
    name: 'add-team',
    execute: async (ctx) => {
      const resolvedTeam = ctx.results.get('resolve-team') as VikunjaTeam;
      // `resolve-team` already rejected any match with an undefined `.id`
      // before returning it, so this is guaranteed defined here.
      const resolvedTeamIdForAdd = resolvedTeam.id as number;
      try {
        return await vikunjaRestRequest<VikunjaTeamProject>(
          authManager,
          'PUT',
          `/projects/${projectId}/teams`,
          { team_id: resolvedTeamIdForAdd, permission } satisfies VikunjaTeamProject,
        );
      } catch (error) {
        rethrow(error, `Project with ID ${projectId} not found`, 'Failed to add team to project');
      }
    },
    compensate: async () => {
      if (resolvedTeamId === undefined) return undefined;
      await vikunjaRestRequest<VikunjaMessage>(
        authManager,
        'DELETE',
        `/projects/${projectId}/teams/${resolvedTeamId}`,
      );
      return undefined;
    },
  });

  op.addStep<boolean, undefined>({
    name: 'verify-membership',
    execute: async () => {
      let teams: VikunjaTeamWithPermission[];
      try {
        teams = await vikunjaRestRequest<VikunjaTeamWithPermission[]>(
          authManager,
          'GET',
          `/projects/${projectId}/teams`,
        );
      } catch (error) {
        rethrow(error, undefined, 'Failed to verify project share');
      }
      const found = Array.isArray(teams) && teams.some((t) => t.id === resolvedTeamId);
      if (!found) {
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Team "${teamName}" was added to project ${projectId} but did not appear in the project's team list on verification`,
        );
      }
      return true;
    },
  });

  const result = await op.run({ atomic });

  if (!result.ok) {
    const err =
      result.error instanceof Error
        ? result.error
        : new Error(String(result.error));
    throw new MCPError(
      err instanceof MCPError ? err.code : ErrorCode.API_ERROR,
      `share-with-team failed: ${err.message}${result.guidance ? `\n${result.guidance}` : ''}`,
      { vikunjaError: result },
    );
  }

  const response = createStandardResponse(
    'share-with-team',
    `Shared project ${projectId} with team "${teamName}" (permission ${permission})`,
    { projectId, teamName, permission, atomic, trace: result.steps },
    { timestamp: new Date().toISOString() },
    sessionId,
  );
  return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
}

export interface ListMembersArgs {
  projectId: number;
  sessionId?: string;
}

/**
 * Read composite: answers "who has access to this project" in one call —
 * direct users, direct teams, and link shares — instead of making the
 * caller issue three separate list calls. Purely a read; no
 * `CompositeOperation` needed since there is nothing to compensate.
 */
export async function listProjectMembers(
  args: ListMembersArgs,
  authManager: AuthManager,
): Promise<McpResponse> {
  const { projectId, sessionId } = args;
  validateId(projectId, 'projectId');

  const [usersResult, teamsResult, sharesResult] = await Promise.allSettled([
    vikunjaRestRequest<VikunjaUserWithPermission[]>(authManager, 'GET', `/projects/${projectId}/users`),
    vikunjaRestRequest<VikunjaTeamWithPermission[]>(authManager, 'GET', `/projects/${projectId}/teams`),
    listProjectShares({ projectId }, authManager),
  ]);

  if (usersResult.status === 'rejected') {
    rethrow(usersResult.reason, `Project with ID ${projectId} not found`, 'Failed to list project members');
  }

  const users = usersResult.status === 'fulfilled' && Array.isArray(usersResult.value) ? usersResult.value : [];
  const teams = teamsResult.status === 'fulfilled' && Array.isArray(teamsResult.value) ? teamsResult.value : [];

  // listProjectShares() already returns a fully-formatted MCP response, not
  // raw data — extract the share count from it best-effort for the summary
  // message; the caller gets the definitive list via `list-shares` if they
  // need the full share objects, this composite's job is discoverability of
  // *all three* access mechanisms in one read, not being the single source
  // of truth for link share detail.
  const shareCount =
    sharesResult.status === 'fulfilled' && typeof sharesResult.value.content[0]?.text === 'string'
      ? (sharesResult.value.content[0].text.match(/Retrieved (\d+) shares/)?.[1] ?? '0')
      : '0';

  const response = createStandardResponse(
    'list-members',
    `Project ${projectId} has ${users.length} direct user(s), ${teams.length} direct team(s), and ${shareCount} link share(s)`,
    toResponseData({
      projectId,
      users,
      teams,
      linkShares:
        sharesResult.status === 'fulfilled'
          ? { available: true, summary: sharesResult.value.content[0]?.text }
          : { available: false, error: describeSettledError(sharesResult) },
    }),
    { timestamp: new Date().toISOString() },
    sessionId,
  );
  return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
}

function describeSettledError(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status !== 'rejected') return undefined;
  // `PromiseRejectedResult.reason` is typed `any` by the built-in lib.
  const reason: unknown = result.reason;
  return reason instanceof Error ? reason.message : String(reason);
}
