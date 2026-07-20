/**
 * Global Read-Only Safety Mode + MCP Tool Annotations
 *
 * Tests src/utils/read-only.ts directly: the classification tables, the
 * `assertWriteAllowed` guard (both modes), and the derived ToolAnnotations.
 * Per-tool dispatcher wiring (that each tool actually calls the guard with
 * the right key) is covered separately in each tool's own test file.
 */

import { ConfigurationManager } from '../../src/config';
import { MCPError, ErrorCode } from '../../src/types';
import {
  TOOL_CLASSIFICATIONS,
  classifySubcommand,
  isToolReadOnly,
  isToolDestructive,
  getToolAnnotations,
  isReadOnlyModeActive,
  assertWriteAllowed,
  withReadOnlyNote,
} from '../../src/utils/read-only';

function setReadOnly(value: boolean | undefined): void {
  ConfigurationManager.reset();
  if (value === undefined) {
    ConfigurationManager.getInstance();
    return;
  }
  ConfigurationManager.getInstance({ sources: { readOnly: value } });
}

describe('read-only.ts', () => {
  afterEach(() => {
    ConfigurationManager.reset();
  });

  describe('classifySubcommand', () => {
    it('classifies known read/write/destructive subcommands correctly', () => {
      expect(classifySubcommand('vikunja_tasks', 'list')).toBe('read');
      expect(classifySubcommand('vikunja_tasks', 'create')).toBe('write');
      expect(classifySubcommand('vikunja_tasks', 'delete')).toBe('destructive');
    });

    it('classifies the subtask composite subcommands (PR #77)', () => {
      // create-subtask performs a real create + relation write; list-subtasks
      // is a pure read and must stay allowed under read-only mode.
      expect(classifySubcommand('vikunja_tasks', 'create-subtask')).toBe('write');
      expect(classifySubcommand('vikunja_tasks', 'list-subtasks')).toBe('read');
    });

    it('classifies the E3 bulk composites (bulk-set-bucket, bulk-create-subtasks) as write', () => {
      expect(classifySubcommand('vikunja_tasks', 'bulk-set-bucket')).toBe('write');
      expect(classifySubcommand('vikunja_tasks', 'bulk-create-subtasks')).toBe('write');
      // bulk-set-bucket also lives on the standalone vikunja_task_bulk tool.
      expect(classifySubcommand('vikunja_task_bulk', 'bulk-set-bucket')).toBe('write');
    });

    it('fails closed to "write" for an unrecognized subcommand on a known tool', () => {
      expect(classifySubcommand('vikunja_tasks', 'not-a-real-subcommand')).toBe('write');
    });

    it('fails closed to "write" for an unrecognized tool', () => {
      expect(classifySubcommand('vikunja_does_not_exist', 'anything')).toBe('write');
    });

    it('classifies the vikunja_teams members: composite keys', () => {
      expect(classifySubcommand('vikunja_teams', 'members:list')).toBe('read');
      expect(classifySubcommand('vikunja_teams', 'members:add')).toBe('write');
      expect(classifySubcommand('vikunja_teams', 'members:remove')).toBe('destructive');
      expect(classifySubcommand('vikunja_teams', 'members:toggleAdmin')).toBe('write');
    });

    it('classifies every fixed single-key tool (no subcommand field)', () => {
      expect(classifySubcommand('vikunja_batch_import', 'import')).toBe('write');
      expect(classifySubcommand('vikunja_export_project', 'export')).toBe('read');
      expect(classifySubcommand('vikunja_request_user_export', 'request')).toBe('write');
      expect(classifySubcommand('vikunja_download_user_export', 'download')).toBe('read');
      expect(classifySubcommand('vikunja_user_export_status', 'status')).toBe('read');
    });

    it('classifies vikunja_caldav_tokens subcommands', () => {
      expect(classifySubcommand('vikunja_caldav_tokens', 'list')).toBe('read');
      expect(classifySubcommand('vikunja_caldav_tokens', 'create')).toBe('write');
      expect(classifySubcommand('vikunja_caldav_tokens', 'delete')).toBe('destructive');
    });

    it('classifies vikunja_user_deletion: request/confirm destructive, cancel a (non-destructive) write', () => {
      expect(classifySubcommand('vikunja_user_deletion', 'request')).toBe('destructive');
      expect(classifySubcommand('vikunja_user_deletion', 'confirm')).toBe('destructive');
      expect(classifySubcommand('vikunja_user_deletion', 'cancel')).toBe('write');
    });

    it('classifies the project backgrounds subcommands (G7)', () => {
      expect(classifySubcommand('vikunja_projects', 'remove-background')).toBe('destructive');
      expect(classifySubcommand('vikunja_projects', 'set-unsplash-background')).toBe('write');
      expect(classifySubcommand('vikunja_projects', 'search-unsplash')).toBe('read');
    });
  });

  describe('TOOL_CLASSIFICATIONS completeness', () => {
    it('has a non-empty classification table for every tool it declares', () => {
      for (const [toolName, table] of Object.entries(TOOL_CLASSIFICATIONS)) {
        expect(Object.keys(table).length).toBeGreaterThan(0);
        for (const [subcommand, classification] of Object.entries(table)) {
          expect(['read', 'write', 'destructive']).toContain(classification);
          expect(typeof subcommand).toBe('string');
        }
      }
    });

    it('classifies the local-session-only vikunja_auth subcommands as read', () => {
      const table = TOOL_CLASSIFICATIONS.vikunja_auth;
      expect(table).toBeDefined();
      for (const subcommand of ['connect', 'status', 'refresh', 'disconnect', 'info']) {
        expect(table![subcommand]).toBe('read');
      }
    });

    it('classifies the oidc-http-mode vault-mutating vikunja_auth subcommands as write/destructive', () => {
      const table = TOOL_CLASSIFICATIONS.vikunja_auth;
      expect(table).toBeDefined();
      expect(table!.provision).toBe('write');
      expect(table!.deprovision).toBe('destructive');
    });
  });

  describe('isToolReadOnly', () => {
    it('is true for a tool whose entire surface is read', () => {
      expect(isToolReadOnly('vikunja_export_project')).toBe(true);
      expect(isToolReadOnly('vikunja_user_export_status')).toBe(true);
    });

    it('is false for vikunja_auth (provision/deprovision mutate the credential vault)', () => {
      expect(isToolReadOnly('vikunja_auth')).toBe(false);
    });

    it('is false for a tool with any write/destructive subcommand', () => {
      expect(isToolReadOnly('vikunja_tasks')).toBe(false);
      expect(isToolReadOnly('vikunja_notifications')).toBe(false);
    });

    it('is false for an unrecognized tool', () => {
      expect(isToolReadOnly('vikunja_does_not_exist')).toBe(false);
    });
  });

  describe('isToolDestructive', () => {
    it('is true when any subcommand is destructive', () => {
      expect(isToolDestructive('vikunja_tasks')).toBe(true);
      expect(isToolDestructive('vikunja_tokens')).toBe(true);
      expect(isToolDestructive('vikunja_caldav_tokens')).toBe(true);
    });

    it('is true for vikunja_user_deletion (request/confirm are destructive; cancel alone would not be)', () => {
      expect(isToolDestructive('vikunja_user_deletion')).toBe(true);
    });

    it('is false when no subcommand is destructive', () => {
      expect(isToolDestructive('vikunja_notifications')).toBe(false);
    });

    it('is true for vikunja_auth (deprovision deletes a credential-vault record)', () => {
      expect(isToolDestructive('vikunja_auth')).toBe(true);
    });

    it('conservatively assumes true for an unrecognized tool', () => {
      expect(isToolDestructive('vikunja_does_not_exist')).toBe(true);
    });
  });

  describe('getToolAnnotations', () => {
    it('sets readOnlyHint true and destructiveHint false for a fully-read tool', () => {
      expect(getToolAnnotations('vikunja_export_project')).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
      });
    });

    it('sets readOnlyHint false and destructiveHint true for vikunja_auth (provision/deprovision mutate the credential vault)', () => {
      expect(getToolAnnotations('vikunja_auth')).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
      });
    });

    it('sets readOnlyHint false and destructiveHint true for a tool with a delete subcommand', () => {
      const annotations = getToolAnnotations('vikunja_tasks');
      expect(annotations.readOnlyHint).toBe(false);
      expect(annotations.destructiveHint).toBe(true);
    });

    it('sets idempotentHint true only for the explicitly allowlisted vikunja_notifications', () => {
      expect(getToolAnnotations('vikunja_notifications')).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    });

    it('omits idempotentHint for tools not on the allowlist', () => {
      expect(getToolAnnotations('vikunja_tasks').idempotentHint).toBeUndefined();
      expect(getToolAnnotations('vikunja_subscriptions').idempotentHint).toBeUndefined();
    });
  });

  describe('isReadOnlyModeActive / assertWriteAllowed', () => {
    it('isReadOnlyModeActive reflects the loaded configuration', () => {
      setReadOnly(false);
      expect(isReadOnlyModeActive()).toBe(false);

      setReadOnly(true);
      expect(isReadOnlyModeActive()).toBe(true);
    });

    it('isReadOnlyModeActive fails safe to false (does not throw) when configuration loading fails', () => {
      ConfigurationManager.reset();
      const spy = jest
        .spyOn(ConfigurationManager.prototype, 'loadConfiguration')
        .mockImplementation(() => {
          throw new Error('boom: broken config file');
        });

      expect(() => isReadOnlyModeActive()).not.toThrow();
      expect(isReadOnlyModeActive()).toBe(false);

      spy.mockRestore();
    });

    it('never rejects when read-only mode is off, regardless of classification', () => {
      setReadOnly(false);
      expect(() => assertWriteAllowed('vikunja_tasks', 'create')).not.toThrow();
      expect(() => assertWriteAllowed('vikunja_tasks', 'delete')).not.toThrow();
      expect(() => assertWriteAllowed('vikunja_tasks', 'list')).not.toThrow();
    });

    it('never rejects a read subcommand, even when read-only mode is on', () => {
      setReadOnly(true);
      expect(() => assertWriteAllowed('vikunja_tasks', 'list')).not.toThrow();
      expect(() => assertWriteAllowed('vikunja_tasks', 'get')).not.toThrow();
    });

    it('rejects a write subcommand when read-only mode is on, with a clear consistent message', () => {
      setReadOnly(true);
      let caught: unknown;
      try {
        assertWriteAllowed('vikunja_tasks', 'create');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MCPError);
      expect((caught as MCPError).code).toBe(ErrorCode.PERMISSION_DENIED);
      expect((caught as MCPError).message).toContain('server is in read-only mode');
      expect((caught as MCPError).message).toContain('vikunja_tasks');
      expect((caught as MCPError).message).toContain('create');
    });

    it('rejects a destructive subcommand when read-only mode is on', () => {
      setReadOnly(true);
      expect(() => assertWriteAllowed('vikunja_tasks', 'delete')).toThrow(MCPError);
      expect(() => assertWriteAllowed('vikunja_tasks', 'delete')).toThrow(/read-only mode/);
    });

    it('rejects create-subtask but allows list-subtasks under read-only mode (PR #77)', () => {
      setReadOnly(true);
      expect(() => assertWriteAllowed('vikunja_tasks', 'create-subtask')).toThrow(MCPError);
      expect(() => assertWriteAllowed('vikunja_tasks', 'create-subtask')).toThrow(/read-only mode/);
      expect(() => assertWriteAllowed('vikunja_tasks', 'list-subtasks')).not.toThrow();
    });

    it('honors an explicit classificationOverride over the static table lookup', () => {
      setReadOnly(true);
      // 'comment' defaults to 'write' in the table, but the dual-purpose
      // dispatcher override should downgrade it to 'read' when no comment
      // text was supplied.
      expect(() => assertWriteAllowed('vikunja_tasks', 'comment', 'read')).not.toThrow();
      // And the override can also upgrade a normally-read call site.
      expect(() => assertWriteAllowed('vikunja_tasks', 'list', 'write')).toThrow(MCPError);
    });

    it('rejects an unrecognized subcommand (fail-closed default) when read-only', () => {
      setReadOnly(true);
      expect(() => assertWriteAllowed('vikunja_tasks', 'not-a-real-subcommand')).toThrow(
        MCPError,
      );
    });
  });

  describe('withReadOnlyNote', () => {
    it('returns the description unchanged when read-only mode is off', () => {
      setReadOnly(false);
      expect(withReadOnlyNote('vikunja_tasks', 'Manage tasks.')).toBe('Manage tasks.');
    });

    it('appends a read-only note for a tool with write/destructive subcommands when active', () => {
      setReadOnly(true);
      const result = withReadOnlyNote('vikunja_tasks', 'Manage tasks.');
      expect(result).toContain('Manage tasks.');
      expect(result).toContain('read-only mode');
      expect(result.length).toBeGreaterThan('Manage tasks.'.length);
    });

    it('leaves a fully-read tool (e.g. vikunja_export_project) unchanged even when active — the note would be noise', () => {
      setReadOnly(true);
      expect(withReadOnlyNote('vikunja_export_project', 'Export a project.')).toBe(
        'Export a project.',
      );
    });

    it('appends the note to vikunja_auth when active (provision/deprovision are write/destructive now)', () => {
      setReadOnly(true);
      expect(withReadOnlyNote('vikunja_auth', 'Manage authentication.')).toContain(
        'read-only mode',
      );
    });
  });
});
