/**
 * Integration tests for opt-in file-backed persistence of vikunja_templates
 * (N3-templates-persistence). Unlike tests/tools/templates.test.ts, these
 * exercise the *real* storageManager/SimpleFilterStorage — persistence
 * hydration/write-through only makes sense to verify against real storage
 * state, not a mocked stand-in.
 *
 * A "restart" is simulated with `jest.resetModules()` + re-requiring
 * src/tools/templates (and its storage/config singletons), which mirrors a
 * real process restart: fresh in-memory storage, fresh hydration-tracking
 * state, nothing surviving except what's on disk.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Minimal Response-like object for the direct-REST helper. */
function mockResponse(opts: { ok?: boolean; status?: number; statusText?: string; text?: string }): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('vikunja_templates file-backed persistence', () => {
  let tmpDir: string;
  let persistFile: string;
  let mockFetch: jest.Mock;
  const originalEnvValue = process.env.VIKUNJA_MCP_TEMPLATES_FILE;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-mcp-templates-'));
    // Nested path, deliberately not pre-created, to exercise the "create
    // parent directory" behavior (Docker volume mount case).
    persistFile = path.join(tmpDir, 'nested', 'templates.json');
    process.env.VIKUNJA_MCP_TEMPLATES_FILE = persistFile;
    jest.resetModules();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;
    } else {
      process.env.VIKUNJA_MCP_TEMPLATES_FILE = originalEnvValue;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function fetchOkOnce(body: unknown): void {
    mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(body) }));
  }

  /**
   * (Re-)requires the templates tool fresh — module registry must already
   * have been reset by the caller when simulating a restart — and returns a
   * ready-to-call tool handler bound to a newly-connected AuthManager.
   */
  function setupTool(): (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerTemplatesTool } = require('../../src/tools/templates') as typeof import('../../src/tools/templates');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AuthManager } = require('../../src/auth/AuthManager') as typeof import('../../src/auth/AuthManager');

    const authManager = new AuthManager();
    authManager.connect('https://test.vikunja.io', 'test-token-12345678');

    const calls: unknown[][] = [];
    const server = { tool: (...args: unknown[]) => calls.push(args) } as unknown as Parameters<
      typeof registerTemplatesTool
    >[0];
    registerTemplatesTool(server, authManager);

    // Handler is always the last argument to server.tool(...). Indexing from
    // the end keeps this robust against the optional ToolAnnotations argument
    // (PR #81) that sits between the schema and the handler.
    const firstCall = calls[0] as unknown[];
    const handler = firstCall[firstCall.length - 1] as (
      args: Record<string, unknown>,
    ) => Promise<{ content: { text: string }[] }>;
    return handler;
  }

  it('round-trips a template across a simulated restart', async () => {
    const handler = setupTool();

    fetchOkOnce({ id: 1, title: 'Proj' });
    fetchOkOnce([{ id: 1, title: 'Task 1' }]);

    const createResult = await handler({
      subcommand: 'create',
      projectId: 1,
      name: 'Durable Template',
    });
    expect(createResult.content[0]!.text).toContain('created successfully');

    // Write-through: the file must exist immediately after the mutation,
    // without any explicit "flush"/"save" call.
    expect(fs.existsSync(persistFile)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(persistFile, 'utf-8')) as unknown[];
    expect(onDisk).toHaveLength(1);

    // Simulate a full process restart: fresh module graph => fresh
    // in-memory SimpleFilterStorage and fresh hydration-tracking state.
    // Only what made it to disk should survive.
    jest.resetModules();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    const handlerAfterRestart = setupTool();

    const listResult = await handlerAfterRestart({ subcommand: 'list' });
    const markdown = listResult.content[0]!.text;
    expect(markdown).toContain('Durable Template');
    expect(markdown).toContain('Retrieved 1 template');
  });

  it('reflects updates and deletes on disk (write-through on every mutation)', async () => {
    const handler = setupTool();

    fetchOkOnce({ id: 1, title: 'Proj' });
    fetchOkOnce([{ id: 1, title: 'Task 1' }]);
    await handler({ subcommand: 'create', projectId: 1, name: 'Original Name' });

    const onDiskAfterCreate = JSON.parse(fs.readFileSync(persistFile, 'utf-8')) as { name: string }[];
    expect(onDiskAfterCreate).toHaveLength(1);
    const templateId = onDiskAfterCreate[0]!.name;

    await handler({ subcommand: 'update', id: templateId, name: 'Renamed' });
    const onDiskAfterUpdate = JSON.parse(fs.readFileSync(persistFile, 'utf-8')) as { data: string }[];
    expect(onDiskAfterUpdate).toHaveLength(1);
    expect(JSON.parse(onDiskAfterUpdate[0]!.data).name).toBe('Renamed');

    await handler({ subcommand: 'delete', id: templateId });
    const onDiskAfterDelete = JSON.parse(fs.readFileSync(persistFile, 'utf-8')) as unknown[];
    expect(onDiskAfterDelete).toHaveLength(0);
  });

  it('tolerates a missing persistence file at startup — starts empty, never crashes', async () => {
    expect(fs.existsSync(persistFile)).toBe(false);
    const handler = setupTool();

    const result = await handler({ subcommand: 'list' });
    expect(result.content[0]!.text).toContain('Retrieved 0 templates');
  });

  it('tolerates a corrupt persistence file at startup — logs and starts empty, never crashes', async () => {
    fs.mkdirSync(path.dirname(persistFile), { recursive: true });
    fs.writeFileSync(persistFile, '{ this is not valid JSON', 'utf-8');

    const handler = setupTool();
    const result = await handler({ subcommand: 'list' });
    expect(result.content[0]!.text).toContain('Retrieved 0 templates');
  });

  it('tolerates a persistence file that is valid JSON but not an array', async () => {
    fs.mkdirSync(path.dirname(persistFile), { recursive: true });
    fs.writeFileSync(persistFile, JSON.stringify({ not: 'an array' }), 'utf-8');

    const handler = setupTool();
    const result = await handler({ subcommand: 'list' });
    expect(result.content[0]!.text).toContain('Retrieved 0 templates');
  });

  it('does not touch disk at all when persistence is not configured (in-memory default unchanged)', async () => {
    delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;
    jest.resetModules();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;

    const handler = setupTool();
    fetchOkOnce({ id: 1, title: 'Proj' });
    fetchOkOnce([{ id: 1, title: 'Task 1' }]);
    const result = await handler({ subcommand: 'create', projectId: 1, name: 'Ephemeral' });
    expect(result.content[0]!.text).toContain('created successfully');

    expect(fs.existsSync(persistFile)).toBe(false);

    // And templates don't survive a "restart" in this mode, confirming the
    // session-only default is unchanged by adding persistence support.
    jest.resetModules();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    const handlerAfterRestart = setupTool();
    const listResult = await handlerAfterRestart({ subcommand: 'list' });
    expect(listResult.content[0]!.text).toContain('Retrieved 0 templates');
  });
});
