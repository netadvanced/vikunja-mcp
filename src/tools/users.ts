/**
 * Users Tool
 * Handles user operations for Vikunja
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { getAuthManagerFromContext, hasRequestContext } from '../client';
import { MCPError, ErrorCode, createStandardResponse } from '../types';
import type { User, ExtendedUserSettings } from '../types/vikunja';
import { handleAuthError } from '../utils/auth-error-handler';
import { formatAorpAsMarkdown } from '../utils/response-factory';
import { vikunjaRestRequest, vikunjaRestMultipartRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';
import type { components } from '../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json) — see
// docs/API-SPEC.md, replacing the legacy client's types (Wave D domain migration,
// tracking issue #28). GET /user returns v1.UserWithSettings (id/username/
// email/created/updated flat, everything else nested under `settings` —
// see transformUser below and docs/API_NOTES.md). GET /users (search)
// returns plain user.User with no `settings` key at all.
type VikunjaUserWithSettings = components['schemas']['v1.UserWithSettings'];
type VikunjaUser = components['schemas']['user.User'];
type VikunjaUserGeneralSettings = components['schemas']['models.UserGeneralSettings'];
type VikunjaMessage = components['schemas']['models.Message'];
// GET/POST /user/settings/avatar exchange this JSON shape — NOT image bytes.
// See docs/ENDPOINT-TAIL-RETRIAGE.md G5: the old "binary/blob" label for
// these two endpoints was wrong.
type VikunjaUserAvatarProvider = components['schemas']['v1.UserAvatarProvider'];

/**
 * The exact set of avatar provider strings the Vikunja server accepts.
 * The OpenAPI spec documents `avatar_provider` as a freeform `string` with
 * valid values only spelled out in prose, so this list is instead sourced
 * from the server's own validation in the Vikunja source
 * (`~/Projects/vikunja/pkg/user/user.go`, the avatar-provider check ahead of
 * `ErrInvalidAvatarProvider`). Validating client-side against the same list
 * gives a clear Zod error instead of a round-trip 400.
 */
const AVATAR_PROVIDERS = [
  'gravatar',
  'upload',
  'initials',
  'marble',
  'ldap',
  'openid',
  'default',
] as const;

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
 * Safely transforms a raw REST user object (v1.UserWithSettings or
 * user.User) to our extended User interface
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
    withReadOnlyNote(
      'vikunja_users',
      "Manage user profiles, search users, and update user settings. Use the 'timezones' subcommand to fetch this Vikunja instance's list of valid IANA time zone names before calling 'update-settings' with a timezone value — the server rejects unrecognized zone names, and the valid set is instance-dependent (depends on the OS Vikunja runs on). 'get-avatar'/'set-avatar' read and write the avatar *provider* setting (JSON — one of gravatar/upload/initials/marble/ldap/openid/default), not image bytes; 'upload-avatar' uploads an actual image file and only takes effect once the provider is 'upload' (which it also sets as a side effect).",
    ),
    {
      // Operation type
      subcommand: z.enum([
        'current',
        'search',
        'settings',
        'update-settings',
        'timezones',
        'get-avatar',
        'set-avatar',
        'upload-avatar',
      ]),

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

      // Avatar settings (get-avatar/set-avatar/upload-avatar)
      avatarProvider: z.enum(AVATAR_PROVIDERS).optional(),
      // Local file to upload, same contract as `vikunja_tasks attach`:
      // `filePath` (absolute path readable by the MCP server process) takes
      // precedence over `fileContent` (base64) when both are given.
      filePath: z.string().optional(),
      fileContent: z.string().optional(),
      filename: z.string().optional(),
    },
    getToolAnnotations('vikunja_users'),
    async (args) => {
      // Closure-gate precedence fix: defer to the per-request context when
      // bound (see hasRequestContext's doc comment, src/client.ts).
      if (hasRequestContext()) {
        await getAuthManagerFromContext();
      } else if (!authManager.isAuthenticated()) {
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

      assertWriteAllowed('vikunja_users', args.subcommand);

      try {
        const subcommand = args.subcommand;

        switch (subcommand) {
          case 'current': {
            const rawUser = await vikunjaRestRequest<VikunjaUserWithSettings>(authManager, 'GET', '/user');

            // Safely transform the raw REST user response to our extended User
            // interface. Extended properties may not be available from all Vikunja API versions
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

            // GET /users only accepts the `s` query param per the spec (no
            // page/per_page) — the legacy client's UserSearchParams type includes
            // pagination fields the real endpoint doesn't support, so the
            // request only ever sent `s` server-side even before this
            // migration. `params`/`paramsMetadata` still record whatever the
            // caller passed for the response metadata below.
            const query = new URLSearchParams();
            if (params.s !== undefined) query.set('s', params.s);
            const queryString = query.toString();

            const usersResult = await vikunjaRestRequest<VikunjaUser[]>(
              authManager,
              'GET',
              `/users${queryString ? `?${queryString}` : ''}`,
            );
            const users = usersResult ?? [];

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
            const rawUser = await vikunjaRestRequest<VikunjaUserWithSettings>(authManager, 'GET', '/user');

            // Safely transform the raw REST user response to our extended User interface
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

            await vikunjaRestRequest<VikunjaMessage>(
              authManager,
              'POST',
              '/user/settings/general',
              settings as unknown as VikunjaUserGeneralSettings,
            );

            // Get updated user info
            const rawUpdatedUser = await vikunjaRestRequest<VikunjaUserWithSettings>(authManager, 'GET', '/user');

            // Safely transform the raw REST user response to our extended User interface
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
            // GET /user/timezones. Not exposed via the legacy client's client
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

          case 'get-avatar': {
            // GET /user/settings/avatar returns v1.UserAvatarProvider
            // ({avatar_provider}) — JSON, not image bytes. See the type
            // comment above and docs/ENDPOINT-TAIL-RETRIAGE.md G5.
            const raw = await vikunjaRestRequest<VikunjaUserAvatarProvider>(
              authManager,
              'GET',
              '/user/settings/avatar',
            );
            const avatarProvider = raw?.avatar_provider ?? '';

            const response = createStandardResponse(
              'get-avatar-provider',
              'Avatar provider retrieved successfully',
              { avatarProvider },
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

          case 'set-avatar': {
            if (!args.avatarProvider) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                `set-avatar requires avatarProvider (one of: ${AVATAR_PROVIDERS.join(', ')})`,
              );
            }

            // POST /user/settings/avatar, body v1.UserAvatarProvider. Zod's
            // enum check above already rejects anything outside
            // AVATAR_PROVIDERS before the handler runs.
            await vikunjaRestRequest<VikunjaMessage>(
              authManager,
              'POST',
              '/user/settings/avatar',
              { avatar_provider: args.avatarProvider } as VikunjaUserAvatarProvider,
            );

            const response = createStandardResponse(
              'set-avatar-provider',
              `Avatar provider set to '${args.avatarProvider}'` +
                (args.avatarProvider === 'upload'
                  ? " — call 'upload-avatar' with a file to complete the switch."
                  : ''),
              { avatarProvider: args.avatarProvider },
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

          case 'upload-avatar': {
            // PUT /user/settings/avatar/upload, multipart/form-data, field
            // name `avatar` (single file). This endpoint ALSO sets the
            // avatar provider to 'upload' as a side effect on the server
            // (see the Vikunja source's UploadAvatar handler) — the upload
            // only actually shows up once the provider is 'upload', which
            // this call itself guarantees going forward, but a *prior*
            // 'gravatar'/'initials'/etc. provider is silently overwritten by
            // it. Same file-input contract as `vikunja_tasks attach`:
            // `filePath` (server-local path) or `fileContent` (base64),
            // `filePath` wins when both are given.
            const { filePath, fileContent, filename } = args;

            let bytes: Buffer;
            let name: string;
            let source: 'filePath' | 'fileContent';

            if (filePath) {
              try {
                bytes = readFileSync(filePath);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                throw new MCPError(
                  ErrorCode.VALIDATION_ERROR,
                  `upload-avatar: cannot read filePath ${filePath}: ${message}`,
                );
              }
              name = filename || basename(filePath);
              source = 'filePath';
            } else if (fileContent) {
              const decoded = Buffer.from(fileContent, 'base64');
              if (decoded.length === 0) {
                throw new MCPError(
                  ErrorCode.VALIDATION_ERROR,
                  'upload-avatar: decoded fileContent is empty (not valid base64 or empty input)',
                );
              }
              bytes = decoded;
              name = filename || 'avatar.png';
              source = 'fileContent';
            } else {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'upload-avatar requires filePath or fileContent',
              );
            }

            // Strip any directory component a caller might inject via `filename`.
            name = basename(name);

            const form = new FormData();
            form.append('avatar', new Blob([bytes]), name);

            const data = await vikunjaRestMultipartRequest<VikunjaMessage>(
              authManager,
              'PUT',
              '/user/settings/avatar/upload',
              form,
            );

            const response = createStandardResponse(
              'upload-avatar',
              `Avatar uploaded (${bytes.length} bytes) and provider set to 'upload'`,
              { filename: name, bytes: bytes.length, source, response: data },
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
          // A REST-layer 401/403 on a user endpoint is the documented
          // Vikunja API quirk (docs/API_NOTES.md "User Endpoint
          // Authentication"): the same token that works everywhere else can
          // be rejected on `/user`/`/users`. Route it through the same
          // friendly auth-error translation legacy-client-sourced exceptions
          // used to get — `vikunjaRestRequest` throws `MCPError` with the
          // HTTP status under `details.statusCode`, not a `.message` string
          // `handleAuthError`'s pattern matching recognizes, so this has to
          // be detected structurally rather than by message content.
          const statusCode = error.details?.statusCode;
          if (statusCode === 401 || statusCode === 403) {
            handleAuthError(
              new Error(`${statusCode} ${error.message}`),
              `user.${args.subcommand}`,
              `User operation error: ${error.message}`,
            );
          }
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
