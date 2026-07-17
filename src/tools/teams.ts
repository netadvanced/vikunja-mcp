/**
 * Teams Tool
 * Handles team operations for Vikunja
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode, createStandardResponse } from '../types';
import { getClientFromContext } from '../client';
import { wrapToolError } from '../utils/error-handler';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import type { Team } from 'node-vikunja';
import type { TypedVikunjaClient } from '../types/node-vikunja-extended';
import { validateAndConvertId } from '../utils/validation';
import { formatAorpAsMarkdown } from '../utils/response-factory';

interface TeamListParams {
  page?: number;
  per_page?: number;
  s?: string;
}

// Use shared validateAndConvertId from utils/validation

/**
 * A team member as embedded in the `members` array of a `GET /teams/{id}`
 * response (server-side `models.TeamUser`): the member's public user fields
 * plus their team-admin flag. `team_id` is not exposed by the API.
 */
interface TeamMemberUser {
  id: number;
  name?: string;
  username: string;
  email?: string;
  admin: boolean;
  created?: string;
  updated?: string;
}

/**
 * `GET`/`POST /teams/{id}` response shape: a `Team` with its members
 * embedded. node-vikunja's `Team` type does not model this field, so it is
 * declared locally per the OpenAPI spec / server `models.Team` struct.
 * (An intersection, not `extends`, because `Team`'s inherited index
 * signature rejects an array-typed `members` property on a plain interface
 * extension.)
 */
type TeamWithMembers = Team & { members?: TeamMemberUser[] };

/**
 * `models.TeamMember` — the team-membership row returned by
 * `PUT /teams/{id}/members` (add) and `POST /teams/{id}/members/{username}/admin`
 * (admin toggle).
 */
interface TeamMembership {
  id: number;
  username: string;
  admin?: boolean;
  created?: string;
}

/** `models.Message` — the generic `{ message: string }` envelope Vikunja
 * returns from `DELETE /teams/{id}/members/{username}`. */
interface VikunjaMessage {
  message: string;
}

export function registerTeamsTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_teams',
    'Manage teams and team memberships for collaborative project management',
    {
      // List all teams
      subcommand: z.enum(['list', 'create', 'get', 'update', 'delete', 'members']),

      // List parameters
      page: z.number().positive().optional(),
      perPage: z.number().positive().max(100).optional(),
      search: z.string().optional(),

      // Team fields for create/update
      id: z.union([z.string(), z.number()]).optional(),
      name: z.string().optional(),
      description: z.string().optional(),

      // Member operations
      // 'toggleAdmin' matches the real API: POST /teams/{id}/members/{username}/admin
      // takes no body and flips the member's admin flag rather than setting it.
      memberSubcommand: z.enum(['list', 'add', 'remove', 'toggleAdmin']).optional(),
      // Vikunja keys team membership by username, not numeric user id, to
      // prevent automated/enumerated user-id entry (see the API's own docs
      // for models.TeamMember.username).
      username: z.string().min(1).optional(),
      admin: z.boolean().optional(),
    },
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      const client = await getClientFromContext() as TypedVikunjaClient;
      const subcommand = args.subcommand;

      try {

        switch (subcommand) {
          case 'list': {
            const params: TeamListParams = {};
            if (args.page !== undefined) params.page = args.page;
            if (args.perPage !== undefined) params.per_page = args.perPage;
            if (args.search !== undefined) params.s = args.search;

            const teams = await client.teams.getTeams(params);

            const response = createStandardResponse(
              'list-teams',
              `Retrieved ${teams.length} team${teams.length !== 1 ? 's' : ''}`,
              { teams },
              { count: teams.length, params },
            );

            return {
              content: [
                {
                  type: 'text',
                  text: formatAorpAsMarkdown(response),
                },
              ],
            };
          }

          case 'create': {
            if (!args.name) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Team name is required');
            }

            const teamData: Partial<Team> = {
              name: args.name,
            };
            if (args.description !== undefined) {
              teamData.description = args.description;
            }

            const team = await client.teams.createTeam(teamData as Team);

            const response = createStandardResponse(
              'create-team',
              `Team "${team.name}" created successfully`,
              { team },
              { affectedFields: Object.keys(teamData).filter(key => typeof key === 'string') },
            );

            return {
              content: [
                {
                  type: 'text',
                  text: formatAorpAsMarkdown(response),
                },
              ],
            };
          }

          case 'get': {
            if (args.id === undefined) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Team ID is required');
            }

            const teamId = validateAndConvertId(args.id, 'id');

            // node-vikunja's TeamService has no getTeam method; call the
            // endpoint directly. GET /teams/{id} is the correct path/verb.
            const team = await vikunjaRestRequest<Team>(
              authManager,
              'GET',
              `/teams/${teamId}`,
            );

            const standardResponse = createStandardResponse(
              'get-team',
              `Retrieved team "${team.name}"`,
              { team },
              { teamId },
            );

            return {
              content: [
                {
                  type: 'text',
                  text: formatAorpAsMarkdown(standardResponse),
                },
              ],
            };
          }

          case 'update': {
            if (args.id === undefined) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Team ID is required');
            }

            const teamId = validateAndConvertId(args.id, 'id');

            if (!args.name && !args.description) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'At least one field to update is required',
              );
            }

            const updateData: Partial<Team> = {};
            if (args.name !== undefined) updateData.name = args.name;
            if (args.description !== undefined) updateData.description = args.description;

            // The API only routes team updates through POST /teams/{id};
            // PUT is reserved for team creation (PUT /teams) and is not a
            // defined route here — sending PUT 404s/405s against a real server.
            const team = await vikunjaRestRequest<Team>(
              authManager,
              'POST',
              `/teams/${teamId}`,
              updateData,
            );

            const standardResponse = createStandardResponse(
              'update-team',
              `Team "${team.name}" updated successfully`,
              { team },
              { teamId, affectedFields: Object.keys(updateData) },
            );

            return {
              content: [
                {
                  type: 'text',
                  text: formatAorpAsMarkdown(standardResponse),
                },
              ],
            };
          }

          case 'delete': {
            if (args.id === undefined) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Team ID is required');
            }

            const teamId = validateAndConvertId(args.id, 'id');

            // node-vikunja's TeamService.deleteTeam always exists in the
            // pinned client version, so no fallback path is reachable/testable.
            const result = await client.teams.deleteTeam(teamId);

            const response = createStandardResponse(
              'delete-team',
              `Team deleted successfully`,
              { message: result.message },
              { teamId },
            );

            return {
              content: [
                {
                  type: 'text',
                  text: formatAorpAsMarkdown(response),
                },
              ],
            };
          }

          case 'members': {
            if (args.id === undefined) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Team ID is required');
            }

            const teamId = validateAndConvertId(args.id, 'id');
            const memberSubcommand = args.memberSubcommand || 'list';

            switch (memberSubcommand) {
              case 'list': {
                // There is no GET /teams/{id}/members endpoint. Members are
                // embedded in the team resource itself, so fetch the team
                // and read its `members` array.
                const team = await vikunjaRestRequest<TeamWithMembers>(
                  authManager,
                  'GET',
                  `/teams/${teamId}`,
                );
                const members = team.members ?? [];

                const standardResponse = createStandardResponse(
                  'list-team-members',
                  `Retrieved ${members.length} member${members.length !== 1 ? 's' : ''}`,
                  { members },
                  { teamId, count: members.length },
                );

                return {
                  content: [
                    {
                      type: 'text',
                      text: formatAorpAsMarkdown(standardResponse),
                    },
                  ],
                };
              }

              case 'add': {
                if (!args.username) {
                  throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Username is required');
                }

                // The API keys team membership by the member's real username
                // string (deliberately, to prevent automated/enumerated user
                // id entry) — never a numeric user id.
                const memberData: { username: string; admin?: boolean } = {
                  username: args.username,
                };
                if (args.admin !== undefined) memberData.admin = args.admin;

                const member = await vikunjaRestRequest<TeamMembership>(
                  authManager,
                  'PUT',
                  `/teams/${teamId}/members`,
                  memberData,
                );

                const standardResponse = createStandardResponse(
                  'add-team-member',
                  `User "${args.username}" added to team successfully`,
                  { member },
                  { teamId, username: args.username, admin: args.admin },
                );

                return {
                  content: [
                    {
                      type: 'text',
                      text: formatAorpAsMarkdown(standardResponse),
                    },
                  ],
                };
              }

              case 'remove': {
                if (!args.username) {
                  throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Username is required');
                }

                // The path segment is the member's username, not a numeric
                // user id — /teams/{id}/members/{username}.
                const result = await vikunjaRestRequest<VikunjaMessage>(
                  authManager,
                  'DELETE',
                  `/teams/${teamId}/members/${args.username}`,
                );

                const standardResponse = createStandardResponse(
                  'remove-team-member',
                  `User "${args.username}" removed from team successfully`,
                  { message: result.message },
                  { teamId, username: args.username },
                );

                return {
                  content: [
                    {
                      type: 'text',
                      text: formatAorpAsMarkdown(standardResponse),
                    },
                  ],
                };
              }

              case 'toggleAdmin': {
                if (!args.username) {
                  throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Username is required');
                }

                // POST /teams/{id}/members/{username}/admin takes no request
                // body: it TOGGLES the member's admin flag rather than
                // setting it to a caller-supplied value, so there is no
                // `admin` argument here — callers should read the member's
                // current status first (e.g. via `members list`) if they
                // need to know the resulting state.
                const member = await vikunjaRestRequest<TeamMembership>(
                  authManager,
                  'POST',
                  `/teams/${teamId}/members/${args.username}/admin`,
                );

                const standardResponse = createStandardResponse(
                  'toggle-team-member-admin',
                  `Admin status toggled for user "${args.username}"`,
                  { member },
                  { teamId, username: args.username },
                );

                return {
                  content: [
                    {
                      type: 'text',
                      text: formatAorpAsMarkdown(standardResponse),
                    },
                  ],
                };
              }

              default:
                throw new MCPError(
                  ErrorCode.VALIDATION_ERROR,
                  `Invalid member subcommand: ${String(memberSubcommand)}`,
                );
            }
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid subcommand: ${String(subcommand)}`,
            );
        }
      } catch (error) {
        throw wrapToolError(error, 'vikunja_teams', `${subcommand} team`, args.id);
      }
    },
  );
}
