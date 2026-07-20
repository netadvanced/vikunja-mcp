/**
 * Templates Tool
 * Handles project template operations for Vikunja
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode, createStandardResponse } from '../types';
import { storageManager } from '../storage';
// Imported directly from the module (not the `../storage` barrel) so that
// tests mocking `../../src/storage` wholesale (to stub `storageManager`)
// don't also need to stub these — they're a separate, self-contained
// concern (see templateFileStore.ts's header).
import {
  loadTemplatesFile,
  writeTemplatesFileAtomic,
  resolveTemplatesPersistPath,
} from '../storage/templateFileStore';
import type { PersistedTemplateRecord } from '../storage/templateFileStore';
import { ConfigurationManager } from '../config';
import { logger } from '../utils/logger';
import { getEffectiveSessionId } from '../context/requestContext';
import { setTaskLabels } from '../utils/label-bulk';
import { formatAorpAsMarkdown } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import { assertWriteAllowed, getToolAnnotations, withReadOnlyNote } from '../utils/read-only';
import type { components } from '../types/generated/vikunja-openapi';

// Sourced from the vendored OpenAPI spec (docs/vikunja-openapi.json).
type VikunjaProject = components['schemas']['models.Project'];
type VikunjaTask = components['schemas']['models.Task'];

/**
 * Get session-scoped storage instance, hydrated from the templates
 * persistence file (if configured) on first touch for that session.
 *
 * The session id is `(issuer,sub)`-keyed in `oidc-http` mode and falls back
 * to the original apiUrl+token-prefix derivation in `stdio` mode — see
 * `getEffectiveSessionId` (docs/OIDC-RESOURCE-SERVER.md §3d, isolation-table
 * row #4).
 */
async function getSessionStorage(authManager: AuthManager): ReturnType<typeof storageManager.getStorage> {
  const session = authManager.getSession();
  const sessionId = getEffectiveSessionId(authManager);
  const storage = await storageManager.getStorage(sessionId, session.userId, session.apiUrl);

  const persistPath = getTemplatesPersistPath();
  if (persistPath) {
    await hydrateTemplatesFromDiskIfNeeded(storage, persistPath);
  }

  return storage;
}

/**
 * Resolve the effective templates persistence path (env var wins over
 * config — see docs/CONFIGURATION.md). Returns `undefined` when persistence
 * isn't configured, in which case templates stay in-memory-only, exactly as
 * before this file-backed persistence support was added.
 */
function getTemplatesPersistPath(): string | undefined {
  const configuredPath = ConfigurationManager.getInstance().loadConfiguration().templates.persistPath;
  return resolveTemplatesPersistPath(configuredPath);
}

/**
 * Templates already hydrated from disk in this process, keyed by
 * `${persistPath}:${sessionId}` — hydration happens once per session per
 * configured path, not on every call, so repeated tool invocations don't
 * re-read the file or attempt to re-create already-loaded templates.
 */
const hydratedPersistenceKeys = new Set<string>();

async function hydrateTemplatesFromDiskIfNeeded(
  storage: Awaited<ReturnType<typeof storageManager.getStorage>>,
  persistPath: string,
): Promise<void> {
  const sessionId = storage.getSession().id;
  const key = `${persistPath}:${sessionId}`;
  if (hydratedPersistenceKeys.has(key)) {
    return;
  }
  hydratedPersistenceKeys.add(key);

  const records = loadTemplatesFile(persistPath);
  for (const record of records) {
    try {
      const existing = await storage.findByName(record.name);
      if (!existing) {
        await storage.create({ name: record.name, filter: record.data, isGlobal: true });
      }
    } catch (error) {
      logger.warn('Failed to hydrate a template from the persistence file, skipping it', {
        persistPath,
        templateId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Write-through: persist the full current template set for this session to
 * disk, atomically, when persistence is configured. A write failure is
 * logged but never surfaced as a tool error — the in-memory mutation the
 * caller just made already succeeded, and durability is a best-effort
 * bonus, not a correctness requirement (per the "in memory by default"
 * contract templates.ts documents).
 */
async function persistTemplatesIfConfigured(
  storage: Awaited<ReturnType<typeof storageManager.getStorage>>,
): Promise<void> {
  const persistPath = getTemplatesPersistPath();
  if (!persistPath) {
    return;
  }
  try {
    const all = await storage.list();
    const records: PersistedTemplateRecord[] = all
      .filter((filter) => filter.name.startsWith('template_'))
      .map((filter) => ({ id: filter.name, name: filter.name, data: filter.filter }));
    writeTemplatesFileAtomic(persistPath, records);
  } catch (error) {
    logger.error('Failed to persist templates to disk', {
      persistPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

interface TemplateData {
  id: string;
  name: string;
  description?: string;
  created: string;
  author?: string;
  tags: string[];
  projectData: {
    title: string;
    description?: string;
    hex_color?: string;
  };
  tasks: Array<{
    title: string;
    description?: string;
    labels?: number[];
    due_date?: string;
    priority?: number;
    position?: number;
  }>;
  variables?: Record<string, string>;
}

export function registerTemplatesTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_templates',
    withReadOnlyNote(
      'vikunja_templates',
      'Manage task templates for creating consistent tasks and project structures. ' +
        'IMPORTANT: templates are never persisted to Vikunja itself. By default they ' +
        "are session-only — kept in this server process's memory and lost on restart. " +
        'Set the templates.persistPath config key (or VIKUNJA_MCP_TEMPLATES_FILE env ' +
        'var, which wins) to make them durable across restarts via a JSON file on disk ' +
        '— see docs/CONFIGURATION.md. `create`/`update` responses also report a ' +
        '`persisted` boolean and a matching note in their message, so this is never ' +
        'just a one-time warning buried in this description.',
    ),
    {
      subcommand: z.enum(['create', 'list', 'get', 'update', 'delete', 'instantiate']),
      // Template fields
      id: z.string().optional(),
      projectId: z.number().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      // Instantiation fields
      projectName: z.string().optional(),
      parentProjectId: z.number().optional(),
      variables: z.record(z.string(), z.string()).optional(),
    },
    getToolAnnotations('vikunja_templates'),
    async (args) => {
      try {
        // Check authentication
        if (!authManager.isAuthenticated()) {
          throw new MCPError(
            ErrorCode.AUTH_REQUIRED,
            'Authentication required. Please use vikunja_auth.connect first.',
          );
        }

        assertWriteAllowed('vikunja_templates', args.subcommand);

        const storage = await getSessionStorage(authManager);

        switch (args.subcommand) {
          case 'create': {
            if (!args.projectId || !args.name) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'projectId and name are required for creating a template',
              );
            }

            try {
              // Get the source project
              const project = await vikunjaRestRequest<VikunjaProject>(
                authManager,
                'GET',
                `/projects/${args.projectId}`,
              );

              // Get all tasks in the project. NOTE: `GET /projects/{id}/tasks` is
              // not present in the vendored OpenAPI spec (only `PUT` is documented
              // there) — this mirrors the legacy client's own `getProjectTasks`, which
              // calls this same undocumented-but-functional path. Preserved as-is
              // per this migration's "transport only, same behavior" scope; see
              // docs/API-COVERAGE.md's note on `GET /projects/{id}/tasks` for the
              // broader spec-drift context.
              const tasks = await vikunjaRestRequest<VikunjaTask[]>(
                authManager,
                'GET',
                `/projects/${args.projectId}/tasks`,
              );

              // Validate hex color if present
              if (project.hex_color && !/^#[0-9A-Fa-f]{6}$/.test(project.hex_color)) {
                logger.warn('Invalid hex color in source project, skipping', {
                  projectId: args.projectId,
                  color: project.hex_color,
                });
              }

              // Create template data
              const templateId = `template_${Date.now()}`;
              const templateData: TemplateData = {
                id: templateId,
                name: args.name,
                ...(args.description && { description: args.description }),
                created: new Date().toISOString(),
                tags: args.tags || [],
                projectData: {
                  title: project.title ?? '',
                  ...(project.description && { description: project.description }),
                  ...(project.hex_color &&
                    /^#[0-9A-Fa-f]{6}$/.test(project.hex_color) && {
                      hex_color: project.hex_color,
                    }),
                },
                tasks: tasks.map((task) => ({
                  title: task.title ?? '',
                  ...(task.description && { description: task.description }),
                  ...(task.labels &&
                    task.labels.length > 0 && {
                      labels: task.labels
                        .map((l) => l.id)
                        .filter((id): id is number => id !== undefined),
                    }),
                  ...(task.due_date && { due_date: task.due_date }),
                  ...(task.priority !== undefined && { priority: task.priority }),
                  ...(task.position !== undefined && { position: task.position }),
                })),
                variables: {},
              };

              // Save template as a saved filter
              await storage.create({
                name: templateId,
                filter: JSON.stringify(templateData),
                isGlobal: true,
              });
              await persistTemplatesIfConfigured(storage);

              // FIXED (was: docs/API-COVERAGE.md Issues table, LOW): the
              // session-only-by-default durability gap was already flagged
              // in the tool description, but individual responses gave no
              // per-call signal — a caller who never reads the static tool
              // description had no way to know THIS template will vanish on
              // restart. Every mutating response now says so explicitly.
              const persisted = getTemplatesPersistPath() !== undefined;
              const response = createStandardResponse(
                'create-template',
                `Template "${args.name}" created successfully` +
                  (persisted
                    ? ' (persisted to disk — durable across restarts)'
                    : ' (session-only — will be lost on restart; set templates.persistPath or VIKUNJA_MCP_TEMPLATES_FILE to persist)'),
                { template: templateData },
                { sourceProjectId: args.projectId, taskCount: tasks.length, persisted },
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: formatAorpAsMarkdown(response),
                  },
                ],
              };
            } catch (error) {
              throw new MCPError(
                ErrorCode.API_ERROR,
                `Failed to create template: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }

          case 'list': {
            try {
              const savedFilters = await storage.list();
              // Convert saved filters back to templates
              const templates = savedFilters
                .filter((f) => f.name.startsWith('template_'))
                .map((f) => {
                  try {
                    return JSON.parse(f.filter) as TemplateData;
                  } catch {
                    return null;
                  }
                })
                .filter((t) => t !== null);

              const response = createStandardResponse(
                'list-templates',
                `Retrieved ${templates.length} template${templates.length !== 1 ? 's' : ''}`,
                { templates },
                { count: templates.length },
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: formatAorpAsMarkdown(response),
                  },
                ],
              };
            } catch (error) {
              throw new MCPError(
                ErrorCode.API_ERROR,
                `Failed to list templates: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }

          case 'get': {
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Template ID is required');
            }

            try {
              const savedFilter = await storage.findByName(args.id);
              if (!savedFilter) {
                throw new MCPError(ErrorCode.NOT_FOUND, `Template with ID ${args.id} not found`);
              }
              const template = JSON.parse(savedFilter.filter) as TemplateData;

              const response = createStandardResponse(
                'get-template',
                `Retrieved template "${template.name}"`,
                { template },
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: formatAorpAsMarkdown(response),
                  },
                ],
              };
            } catch (error) {
              if (error instanceof MCPError) throw error;
              throw new MCPError(
                ErrorCode.API_ERROR,
                `Failed to get template: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }

          case 'update': {
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Template ID is required');
            }

            try {
              const savedFilter = await storage.findByName(args.id);
              if (!savedFilter) {
                throw new MCPError(ErrorCode.NOT_FOUND, `Template with ID ${args.id} not found`);
              }
              const template = JSON.parse(savedFilter.filter) as TemplateData;

              // Update template fields
              if (args.name !== undefined) template.name = args.name;
              if (args.description !== undefined) template.description = args.description;
              if (args.tags !== undefined) template.tags = args.tags;

              // Update the saved filter by finding it first
              const existingFilter = await storage.findByName(args.id);
              if (existingFilter) {
                await storage.update(existingFilter.id, {
                  filter: JSON.stringify(template),
                });
                await persistTemplatesIfConfigured(storage);
              }

              const persisted = getTemplatesPersistPath() !== undefined;
              const response = createStandardResponse(
                'update-template',
                `Template "${template.name}" updated successfully` +
                  (persisted
                    ? ' (persisted to disk — durable across restarts)'
                    : ' (session-only — will be lost on restart; set templates.persistPath or VIKUNJA_MCP_TEMPLATES_FILE to persist)'),
                { template },
                { persisted },
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: formatAorpAsMarkdown(response),
                  },
                ],
              };
            } catch (error) {
              if (error instanceof MCPError) throw error;
              throw new MCPError(
                ErrorCode.API_ERROR,
                `Failed to update template: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }

          case 'delete': {
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Template ID is required');
            }

            try {
              const savedFilter = await storage.findByName(args.id);
              if (!savedFilter) {
                throw new MCPError(ErrorCode.NOT_FOUND, `Template with ID ${args.id} not found`);
              }
              const template = JSON.parse(savedFilter.filter) as TemplateData;

              await storage.delete(savedFilter.id);
              await persistTemplatesIfConfigured(storage);

              const response = createStandardResponse(
                'delete-template',
                `Template "${template.name}" deleted successfully`,
                { deletedId: args.id },
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: formatAorpAsMarkdown(response),
                  },
                ],
              };
            } catch (error) {
              if (error instanceof MCPError) throw error;
              throw new MCPError(
                ErrorCode.API_ERROR,
                `Failed to delete template: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }

          case 'instantiate': {
            if (!args.id || !args.projectName) {
              throw new MCPError(
                ErrorCode.VALIDATION_ERROR,
                'id and projectName are required for instantiating a template',
              );
            }

            try {
              const savedFilter = await storage.findByName(args.id);
              if (!savedFilter) {
                throw new MCPError(ErrorCode.NOT_FOUND, `Template with ID ${args.id} not found`);
              }
              const template = JSON.parse(savedFilter.filter) as TemplateData;

              // Create new project from template
              const projectData: VikunjaProject = {
                title: applyVariables(args.projectName, args.variables || {}),
                ...(template.projectData.description && {
                  description: applyVariables(
                    template.projectData.description,
                    args.variables || {},
                  ),
                }),
                ...(args.parentProjectId && { parent_project_id: args.parentProjectId }),
              };

              if (template.projectData.hex_color) {
                projectData.hex_color = template.projectData.hex_color;
              }

              const newProject = await vikunjaRestRequest<VikunjaProject>(
                authManager,
                'PUT',
                '/projects',
                projectData,
              );
              logger.info('Created project from template', {
                projectId: newProject.id,
                templateId: args.id,
              });

              // Create tasks from template
              const createdTasks: VikunjaTask[] = [];
              for (const taskTemplate of template.tasks) {
                try {
                  const taskData: VikunjaTask = {
                    title: applyVariables(taskTemplate.title, args.variables || {}),
                    project_id: newProject.id ?? 0,
                    ...(taskTemplate.description && {
                      description: applyVariables(taskTemplate.description, args.variables || {}),
                    }),
                    ...(taskTemplate.due_date && { due_date: taskTemplate.due_date }),
                    ...(taskTemplate.priority !== undefined && { priority: taskTemplate.priority }),
                    ...(taskTemplate.position !== undefined && { position: taskTemplate.position }),
                  };

                  const createdTask = await vikunjaRestRequest<VikunjaTask>(
                    authManager,
                    'PUT',
                    `/projects/${newProject.id ?? 0}/tasks`,
                    taskData,
                  );
                  createdTasks.push(createdTask);

                  // Add labels if any
                  if (taskTemplate.labels && taskTemplate.labels.length > 0) {
                    try {
                      await setTaskLabels(authManager, createdTask.id ?? 0, taskTemplate.labels);
                    } catch (labelError) {
                      logger.warn('Failed to add labels to task', {
                        taskId: createdTask.id,
                        labels: taskTemplate.labels,
                        error: labelError,
                      });
                    }
                  }
                } catch (taskError) {
                  logger.warn('Failed to create task from template', {
                    taskTitle: taskTemplate.title,
                    error: taskError,
                  });
                }
              }

              const response = createStandardResponse(
                'instantiate-template',
                `Project "${newProject.title}" created from template "${template.name}"`,
                {
                  project: newProject,
                  createdTasks: createdTasks.length,
                  failedTasks: template.tasks.length - createdTasks.length,
                },
                { templateId: args.id, templateName: template.name },
              );

              return {
                content: [
                  {
                    type: 'text',
                    text: formatAorpAsMarkdown(response),
                  },
                ],
              };
            } catch (error) {
              if (error instanceof MCPError) throw error;
              throw new MCPError(
                ErrorCode.API_ERROR,
                `Failed to instantiate template: ${error instanceof Error ? error.message : 'Unknown error'}`,
              );
            }
          }

          default:
            throw new MCPError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown subcommand: ${String(args.subcommand)}`,
            );
        }
      } catch (error) {
        if (error instanceof MCPError) {
          throw error;
        }
        throw new MCPError(
          ErrorCode.INTERNAL_ERROR,
          `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    },
  );
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply variable substitution to a string
 */
function applyVariables(text: string | undefined, variables: Record<string, string>): string {
  if (!text) return '';
  let result: string = text;

  // Apply custom variables
  for (const [key, value] of Object.entries(variables)) {
    const escaped = escapeRegex(key);
    const pattern = new RegExp(`{{${escaped}}}`, 'g');
    result = result.replace(pattern, value);
  }

  // Apply built-in variables
  const today = new Date().toISOString().split('T')[0] || '';
  const now = new Date().toISOString();
  result = result.replace(/{{TODAY}}/g, today);
  result = result.replace(/{{NOW}}/g, now);

  return result;
}
