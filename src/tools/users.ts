/**
 * Users Tool
 * Handles user operations for Vikunja
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode, createStandardResponse } from '../types';
import { getClientFromContext } from '../client';
import type { User, ExtendedUserSettings } from '../types/vikunja';
import { handleAuthError } from '../utils/auth-error-handler';
import { formatAorpAsMarkdown } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';

interface SearchParams {
  page?: number;
  per_page?: number;
  s?: string;
}

/**
 * Type guard to check if an object is a valid user structure
 */
function isUserObject(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Safely transforms a node-vikunja User to our extended User interface
 */
function transformUser(rawUser: unknown): User {
  if (!isUserObject(rawUser)) {
    throw new Error('Invalid user data received');
  }

  const user = rawUser;

  const safeString = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value !== null && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object Object]';
      }
    }
    return value !== null && value !== undefined && typeof value !== 'object' && typeof value !== 'boolean' ?
      (typeof value === 'string' || typeof value === 'number' ? value.toString() : '') : '';
  };

  // GET /user returns v1.UserWithSettings: language, timezone, week_start,
  // frontend_settings, email_reminders_enabled, overdue_tasks_reminders_enabled,
  // overdue_tasks_reminders_time and name are nested under a `settings`
  // sub-object (models.UserGeneralSettings), NOT flat on the top-level user
  // object. (id, username, email, created, updated remain top-level.)
  // Search results (GET /users) return plain user.User with no `settings` key,
  // so this safely falls back to an empty object for those.
  const settings: Record<string, unknown> =
    isUserObject(user.settings) ? user.settings : {};

  const result = {
    id: Number(user.id) || 0,
    username: safeString(user.username),
    frontend_settings: (settings.frontend_settings && typeof settings.frontend_settings === 'object') ? settings.frontend_settings : {},
  };

  const userResult: User = {
    id: result.id,
    username: result.username,
    frontend_settings: result.frontend_settings as Record<string, unknown>,
    ...(user.email ? { email: safeString(user.email) } : {}),
    ...(settings.name ? { name: safeString(settings.name) } : {}),
    ...(user.created ? { created: safeString(user.created) } : {}),
    ...(user.updated ? { updated: safeString(user.updated) } : {}),
    ...(settings.language ? { language: safeString(settings.language) } : {}),
    ...(settings.timezone ? { timezone: safeString(settings.timezone) } : {}),
    ...(settings.week_start !== undefined ? { week_start: Number(settings.week_start) } : {}),
    ...(settings.email_reminders_enabled !== undefined ? { email_reminders_enabled: Boolean(settings.email_reminders_enabled) } : {}),
    ...(settings.overdue_tasks_reminders_enabled !== undefined ? { overdue_tasks_reminders_enabled: Boolean(settings.overdue_tasks_reminders_enabled) } : {}),
    ...(settings.overdue_tasks_reminders_time ? { overdue_tasks_reminders_time: safeString(settings.overdue_tasks_reminders_time) } : {}),
  };

  return userResult;
}

export function registerUsersTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_users',
    "Manage user profiles, search users, and update user settings. Use the 'timezones' subcommand to fetch this Vikunja instance's list of valid IANA time zone names before calling 'update-settings' with a timezone value — the server rejects unrecognized zone names, and the valid set is instance-dependent (depends on the OS Vikunja runs on).",
    {
      // Operation type
      subcommand: z.enum(['current', 'search', 'settings', 'update-settings', 'timezones']),

      // Search parameters
      search: z.string().optional(),
      page: z.number().positive().optional(),
      perPage: z.number().positive().max(100).optional(),

      // Settings update fields
      name: z.string().optional(),
      language: z.string().optional(),
      timezone: z.string().optional(),
      weekStart: z.number().min(0).max(6).optional(),
      frontendSettings: z.record(z.unknown()).optional(),

      // Notification preferences
      emailRemindersEnabled: z.boolean().optional(),
      overdueTasksRemindersEnabled: z.boolean().optional(),
      overdueTasksRemindersTime: z.string().optional(),
    },
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      // User operations require JWT authentication
      if (authManager.getAuthType() !== 'jwt') {
        throw new MCPError(
          ErrorCode.PERMISSION_DENIED,
          'User operations require JWT authentication. Please reconnect using vikunja_auth.connect with JWT authentication.',
        );
      }

      const client = await getClientFromContext();

      try {
        const subcommand = args.subcommand;

        switch (subcommand) {
          case 'current': {
            const rawUser = await client.users.getUser();

            // Safely transform the node-vikunja User to our extended User interface
            // Extended properties may not be available from all Vikunja API versions
            const enhancedUser: User = transformUser(rawUser);

            const response = createStandardResponse(
              'get-current-user',
              'Current user retrieved successfully',
              { user: enhancedUser },
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

          case 'search': {
            const params: SearchParams = {};
            if (args.search !== undefined) params.s = args.search;
            if (args.page !== undefined) params.page = args.page;
            if (args.perPage !== undefined) params.per_page = args.perPage;

            const users = await client.users.getUsers(params);

            const paramsMetadata: Record<string, string | number> = {};
            if (args.search !== undefined) paramsMetadata.search = args.search;
            if (args.page !== undefined) paramsMetadata.page = args.page;
            if (args.perPage !== undefined) paramsMetadata.perPage = args.perPage;

            const response = createStandardResponse(
              'search-users',
              `Found ${users.length} users`,
              { users: users.map(transformUser) },
              { count: users.length, params: paramsMetadata },
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

          case 'settings': {
            // Get current user first to get their settings
            const rawUser = await client.users.getUser();

            // Safely transform the node-vikunja User to our extended User interface
            const user: User = transformUser(rawUser);

            // Handle the actual API response format gracefully
            const settings = {
              id: user.id,
              username: user.username,
              ...(user.email && { email: user.email }),
              ...(user.name && { name: user.name }),
              ...(user.language && { language: user.language }),
              ...(user.timezone && { timezone: user.timezone }),
              ...(user.week_start !== undefined && { weekStart: user.week_start }),
              frontendSettings: user.frontend_settings || {},
              ...(user.email_reminders_enabled !== undefined && { emailRemindersEnabled: user.email_reminders_enabled }),
              ...(user.overdue_tasks_reminders_enabled !== undefined && { overdueTasksRemindersEnabled: user.overdue_tasks_reminders_enabled }),
              ...(user.overdue_tasks_reminders_time && { overdueTasksRemindersTime: user.overdue_tasks_reminders_time }),
            };

            const response = createStandardResponse(
              'get-user-settings',
              'User settings retrieved successfully',
              { settings },
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

          case 'update-settings': {
            if (
              !args.name &&
              !args.language &&
              !args.timezone &&
              args.weekStart === undefined &&
              !args.frontendSettings &&
              args.emailRemindersEnabled === undefined &&
              args.overdueTasksRemindersEnabled === undefined &&
              args.overdueTasksRemindersTime === undefined
            ) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'At least one setting field is required',
              );
            }

            const settings: Partial<ExtendedUserSettings> = {};
            const affectedFields: string[] = [];

            if (args.name !== undefined) {
              settings.name = args.name;
              affectedFields.push('name');
            }
            if (args.language !== undefined) {
              settings.language = args.language;
              affectedFields.push('language');
            }
            if (args.timezone !== undefined) {
              settings.timezone = args.timezone;
              affectedFields.push('timezone');
            }
            if (args.weekStart !== undefined) {
              settings.week_start = args.weekStart;
              affectedFields.push('weekStart');
            }
            if (args.frontendSettings !== undefined) {
              settings.frontend_settings = args.frontendSettings;
              affectedFields.push('frontendSettings');
            }
            if (args.emailRemindersEnabled !== undefined) {
              settings.email_reminders_enabled = args.emailRemindersEnabled;
              affectedFields.push('emailRemindersEnabled');
            }
            if (args.overdueTasksRemindersEnabled !== undefined) {
              settings.overdue_tasks_reminders_enabled = args.overdueTasksRemindersEnabled;
              affectedFields.push('overdueTasksRemindersEnabled');
            }
            if (args.overdueTasksRemindersTime !== undefined) {
              settings.overdue_tasks_reminders_time = args.overdueTasksRemindersTime;
              affectedFields.push('overdueTasksRemindersTime');
            }

            // Use type assertion to bypass node-vikunja's limited UserSettings type
            // The API accepts these additional fields even if the TypeScript types don't include them
            await client.users.updateGeneralSettings(
              settings as unknown as Parameters<typeof client.users.updateGeneralSettings>[0],
            );

            // Get updated user info
            const rawUpdatedUser = await client.users.getUser();

            // Safely transform the node-vikunja User to our extended User interface
            const updatedUser: User = transformUser(rawUpdatedUser);

            const response = createStandardResponse(
              'update-user-settings',
              'User settings updated successfully',
              { user: updatedUser },
              { affectedFields },
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

          case 'timezones': {
            // GET /user/timezones. Not exposed via node-vikunja's client
            // (all new HTTP calls go through vikunjaRestRequest per
            // docs/ENDPOINT-PLAYBOOK.md §3). The instance-dependent list of
            // valid IANA time zone names this call returns is exactly what
            // 'update-settings'' timezone argument needs to be validated
            // against before being sent to POST /user/settings/general —
            // Vikunja rejects unrecognized zone names there.
            const timezones = (await vikunjaRestRequest<string[]>(
              authManager,
              'GET',
              '/user/timezones',
            )) ?? [];

            const response = createStandardResponse(
              'get-user-timezones',
              `Retrieved ${timezones.length} available time zones`,
              { timezones },
              { count: timezones.length },
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

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid subcommand: ${String(subcommand)}`,
            );
        }
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }

        // Use consistent auth error handling
        handleAuthError(
          error,
          `user.${args.subcommand}`,
          `User operation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );
}
