#!/usr/bin/env npx tsx
/**
 * True MCP-layer e2e harness (Wave D, item M-E-mcp-e2e-harness)
 *
 * Unlike scripts/test-mcp.ts (which talks directly to the Vikunja REST API
 * over fetch() and never touches src/tools/), this script:
 *
 *   1. Builds the project (`npm run build`).
 *   2. Spawns `dist/index.js` as a real child process over STDIO.
 *   3. Connects to it with the MCP SDK's `Client` + `StdioClientTransport`
 *      (the same transport a real MCP client like Claude Desktop uses).
 *   4. Drives the server exclusively through `client.callTool()` — every
 *      request in this file goes through the actual `src/tools/*.ts`
 *      handlers, Zod validation, and response formatting.
 *
 * A clean run here proves the MCP tool layer itself works end-to-end
 * against a real Vikunja server. See docs/LOCAL-TESTING.md's "True MCP-layer
 * e2e harness" section for the full writeup and docs/API-COVERAGE.md for
 * the endpoint-by-endpoint audit this run cross-checks.
 *
 * Usage:
 *   npm run test:e2e:mcp
 *
 * Requires the local e2e stack (`npm run e2e:up`) to be running at
 * http://localhost:33456. Credentials are obtained the same way
 * docker/e2e/bootstrap.sh does: log in with the fixed e2e-test user, then
 * mint a fresh long-lived API token via PUT /tokens (which — like
 * bootstrap.sh notes — returns 201, not the 200 the OpenAPI spec
 * documents).
 *
 * SAFETY: this script deliberately does NOT read the ambient `VIKUNJA_URL`
 * / `VIKUNJA_API_TOKEN` environment variables that the MCP server itself
 * (and scripts/test-mcp.ts) honor. A developer's shell commonly exports
 * those to point the *server* at a real Vikunja instance for day-to-day use
 * (direnv, `.envrc`, a personal MCP client config, etc.) — if this harness
 * inherited them the way a naive `process.env.VIKUNJA_URL || 'http://
 * localhost:33456'` fallback would, an e2e run could silently create,
 * search, and delete data on a real production account instead of the
 * disposable local stack (this happened during this harness's own
 * development — see the PR description). Instead:
 *   - The target URL is hard-coded to the documented local e2e port and
 *     only overridable via the harness-specific `MCP_E2E_VIKUNJA_URL` (never
 *     the ambient `VIKUNJA_URL`), and is then required to resolve to
 *     localhost/127.0.0.1 or the process aborts before doing anything else.
 *   - The API token is always freshly minted against that (now
 *     guaranteed-local) server via login + PUT /tokens; the ambient
 *     `VIKUNJA_API_TOKEN` is never consulted. `MCP_E2E_VIKUNJA_API_TOKEN`
 *     (again, a distinct name) can supply one explicitly for local
 *     debugging, but only against the same localhost-checked URL.
 *   - The child process's env is built from a copy of `process.env` with
 *     `VIKUNJA_URL`/`VIKUNJA_API_TOKEN`/`VIKUNJA_API_TOKEN_FILE` stripped
 *     before overlaying the harness's own verified-local values, so no
 *     ambient credential can leak through even indirectly.
 *
 * All test data is created under projects/labels/filters named with the
 * `mcp-e2e-` prefix. The harness deletes everything it creates in a
 * `finally` block, and also sweeps for and deletes any leftover
 * `mcp-e2e-*` data at startup (cleanup-by-name-prefix) so a prior failed
 * run never blocks a fresh one and the Vikunja UI is left clean for a human
 * to inspect.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ============================================================================
// Configuration
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');

// Deliberately NOT `process.env.VIKUNJA_URL` — see the safety note in the
// file header. `MCP_E2E_VIKUNJA_URL` is a distinct name a developer would
// never have already exported for pointing a real MCP client at production.
const VIKUNJA_URL = process.env.MCP_E2E_VIKUNJA_URL || 'http://localhost:33456/api/v1';

/** Aborts the process if `url` is not localhost/127.0.0.1 — see file header. */
function assertLocalUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`MCP_E2E_VIKUNJA_URL is not a valid URL: ${url}`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(
      `Refusing to run: target host "${host}" (from ${url}) is not localhost/127.0.0.1. ` +
        'This harness creates, searches, and deletes data and must only ever run against ' +
        'the disposable local e2e stack (npm run e2e:up), never a real Vikunja instance. ' +
        'If you intended to target the local stack, check for a stray MCP_E2E_VIKUNJA_URL override.',
    );
  }
}

// Must match docker/e2e/bootstrap.sh's TEST_USERNAME/TEST_PASSWORD — this
// harness obtains its own token the same way bootstrap.sh does rather than
// depending on docker/e2e/.env existing, so it's fully self-contained and
// re-runnable on a freshly-brought-up stack.
const TEST_USERNAME = 'e2e-test';
const TEST_PASSWORD = 'VikunjaMcpE2E-2026!';
const TOKEN_TITLE = 'vikunja-mcp-e2e-harness';
const NAME_PREFIX = 'mcp-e2e-';

// ============================================================================
// Result tracking (mirrors scripts/test-mcp.ts's simple reporter)
// ============================================================================

type Category = 'harness' | 'tool-bug' | 'server-drift';

interface StepResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  /**
   * Set when a check hit a *known, tracked* server-side regression on the
   * version under test (currently: GET /tasks/{id}/assignees 500ing on
   * Vikunja 2.3.0, see `driftTolerated` below) rather than a real tool bug.
   * Tolerated checks are excluded from the failure count / exit code but
   * still surfaced distinctly (not silently dropped) in both this script's
   * own [Summary] output and the version-matrix verdict file
   * (scripts/test-matrix.ts) so nobody mistakes "tolerated" for "fixed".
   * Remove the corresponding tolerance once a Vikunja release ships the fix
   * (upstream go-vikunja/vikunja PR #2791) and this starts failing for real.
   */
  serverDrift?: boolean;
  error?: string;
}

interface Finding {
  category: Category;
  summary: string;
  detail: string;
}

const results: StepResult[] = [];
const findings: Finding[] = [];

function log(msg: string): void {
  // eslint-disable-next-line no-console -- this is a CLI script, not src/
  console.log(msg);
}

function pass(name: string): void {
  results.push({ name, passed: true });
  log(`  ✓ ${name}`);
}

function fail(name: string, error: string): void {
  results.push({ name, passed: false, error });
  log(`  ✗ ${name} (${error})`);
}

function skip(name: string, reason: string): void {
  results.push({ name, passed: false, skipped: true, error: reason });
  log(`  ⊘ ${name} (skipped: ${reason})`);
}

function record(category: Category, summary: string, detail: string): void {
  findings.push({ category, summary, detail });
}

/**
 * Records a check that hit a known, tolerated server-drift regression: not
 * a pass (the request genuinely failed), but explicitly not counted as a
 * failure either -- surfaced as its own [server-drift] line so a matrix run
 * against an affected version stays green while still reporting the gap.
 * Always pair this with a `record('server-drift', ...)`-shaped explanation
 * (done internally here) of exactly what's tolerated and why, per
 * docs/LOCAL-TESTING.md's version-matrix section.
 */
function driftTolerated(name: string, summary: string, detail: string): void {
  results.push({ name, passed: false, serverDrift: true, error: summary });
  record('server-drift', summary, detail);
  log(`  ⚠ ${name} (server-drift, tolerated: ${summary})`);
}

// ============================================================================
// Credentials: replicate docker/e2e/bootstrap.sh's login + token-mint flow
// ============================================================================

async function login(): Promise<string> {
  const res = await fetch(`${VIKUNJA_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /login failed: ${res.status} ${await res.text()} -- is the e2e stack up? Run 'npm run e2e:up'.`,
    );
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function mintApiToken(jwt: string): Promise<string | null> {
  const routesRes = await fetch(`${VIKUNJA_URL}/routes`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!routesRes.ok) {
    log(`  GET /routes failed (${routesRes.status}); falling back to the JWT as the API token.`);
    return null;
  }
  const routes = (await routesRes.json()) as Record<string, Record<string, unknown>>;
  const permissions: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(routes)) {
    permissions[key] = Object.keys(value);
  }

  const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${VIKUNJA_URL}/tokens`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: TOKEN_TITLE, permissions, expires_at: expiresAt }),
  });
  // The OpenAPI spec documents 200 for a successful PUT /tokens, but the
  // real server responds 201 Created (see docker/e2e/bootstrap.sh).
  if (res.status !== 200 && res.status !== 201) {
    log(`  PUT /tokens failed (${res.status}): ${await res.text()}; falling back to the JWT.`);
    return null;
  }
  const body = (await res.json()) as { token: string | null };
  return body.token ?? null;
}

async function getApiToken(): Promise<string> {
  // Deliberately NOT `process.env.VIKUNJA_API_TOKEN` — see the safety note
  // in the file header. Only the harness-specific override name is honored,
  // and only against a URL `assertLocalUrl` has already verified is local.
  if (process.env.MCP_E2E_VIKUNJA_API_TOKEN) {
    log('Using MCP_E2E_VIKUNJA_API_TOKEN from the environment.');
    return process.env.MCP_E2E_VIKUNJA_API_TOKEN;
  }
  log(`Logging in as '${TEST_USERNAME}'...`);
  const jwt = await login();
  log('Minting a fresh API token via PUT /tokens...');
  const token = await mintApiToken(jwt);
  if (token) {
    log('Obtained tk_* API token.');
    return token;
  }
  log('Falling back to the JWT itself as the API token.');
  return jwt;
}

// ============================================================================
// MCP client plumbing
// ============================================================================

interface ToolCallResult {
  isError: boolean;
  text: string;
}

class McpHarness {
  constructor(private readonly client: Client) {}

  async listToolNames(): Promise<string[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => t.name).sort();
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }> | undefined;
    const text = content && content.length > 0 && typeof content[0]?.text === 'string' ? content[0].text : '';
    return { isError: Boolean(result.isError), text };
  }
}

/** Extracts a resource id from a tool response's markdown text (`(ID: 5)` or `"id": 5`-shaped). */
function extractId(text: string): number | undefined {
  const idParenMatch = /\(ID:\s*(\d+)\)/.exec(text);
  if (idParenMatch?.[1]) return Number(idParenMatch[1]);
  const jsonIdMatch = /"id"\s*:\s*(\d+)/.exec(text);
  if (jsonIdMatch?.[1]) return Number(jsonIdMatch[1]);
  return undefined;
}

/** Extracts every `(ID: N)` occurrence (for list responses with multiple items). */
function extractAllIds(text: string): number[] {
  const parenMatches = [...text.matchAll(/\(ID:\s*(\d+)\)/g)].map((m) => Number(m[1]));
  if (parenMatches.length > 0) return parenMatches;
  // Fallback for responses formatted as a raw JSON dump rather than
  // formatDataItems' compact "(ID: N)" lines (e.g. list-buckets' `data` has
  // no top-level id/title and no known collection key, so
  // formatSuccessMessage falls through to formatObjectData's JSON.stringify
  // — see src/utils/simple-response.ts).
  return [...text.matchAll(/"id":\s*(-?\d+)/g)].map((m) => Number(m[1]));
}

// ============================================================================
// Cleanup-by-name-prefix (idempotent: safe to run even after a failed prior run)
// ============================================================================

async function cleanupByPrefix(h: McpHarness): Promise<void> {
  log('\n[Cleanup-by-prefix]');

  // Saved filters first (they appear as pseudo-projects; deleting the
  // filter also removes the pseudo-project entry).
  try {
    const listRes = await h.call('vikunja_filters', { action: 'list', parameters: {} });
    const idTitlePairs = [...listRes.text.matchAll(/"id":\s*(-?\d+)[^}]*?"title":\s*"([^"]*)"/g)];
    for (const m of idTitlePairs) {
      const [, idStr, title] = m;
      if (title && title.startsWith(NAME_PREFIX) && idStr) {
        const id = Number(idStr);
        await h.call('vikunja_filters', { action: 'delete', parameters: { id } });
        log(`  deleted stale saved filter "${title}" (id ${id})`);
      }
    }
  } catch (e) {
    log(`  filter sweep skipped: ${(e as Error).message}`);
  }

  // Projects (and their tasks, deleted first defensively).
  try {
    const listRes = await h.call('vikunja_projects', { subcommand: 'list' });
    const projectMatches = [...listRes.text.matchAll(/\*\*([^*]+)\*\* \(ID: (\d+)\)/g)];
    for (const m of projectMatches) {
      const [, title, idStr] = m;
      if (title && title.startsWith(NAME_PREFIX) && idStr) {
        const projectId = Number(idStr);
        await deleteProjectAndTasks(h, projectId, title);
      }
    }
  } catch (e) {
    log(`  project sweep skipped: ${(e as Error).message}`);
  }

  // Labels.
  try {
    const listRes = await h.call('vikunja_labels', { subcommand: 'list' });
    const labelMatches = [...listRes.text.matchAll(/\*\*([^*]+)\*\* \(ID: (\d+)\)/g)];
    for (const m of labelMatches) {
      const [, title, idStr] = m;
      if (title && title.startsWith(NAME_PREFIX) && idStr) {
        await h.call('vikunja_labels', { subcommand: 'delete', id: Number(idStr) });
        log(`  deleted stale label "${title}" (id ${idStr})`);
      }
    }
  } catch (e) {
    log(`  label sweep skipped: ${(e as Error).message}`);
  }
}

async function deleteProjectAndTasks(h: McpHarness, projectId: number, title: string): Promise<void> {
  try {
    const tasksRes = await h.call('vikunja_tasks', { subcommand: 'list', projectId });
    for (const taskId of extractAllIds(tasksRes.text)) {
      await h.call('vikunja_tasks', { subcommand: 'delete', id: taskId });
    }
  } catch {
    /* best-effort */
  }
  try {
    await h.call('vikunja_projects', { subcommand: 'delete', id: projectId });
    log(`  deleted stale project "${title}" (id ${projectId})`);
  } catch (e) {
    log(`  could not delete stale project ${projectId}: ${(e as Error).message}`);
  }
}

// ============================================================================
// Assertion helpers
// ============================================================================

function assertStep(name: string, condition: boolean, detail: string): void {
  if (condition) {
    pass(name);
  } else {
    fail(name, detail);
  }
}

function assertOk(name: string, result: ToolCallResult): boolean {
  if (result.isError) {
    fail(name, `tool returned isError: ${result.text.slice(0, 300)}`);
    return false;
  }
  pass(name);
  return true;
}

// ============================================================================
// Test flow
// ============================================================================

interface FlowContext {
  projectId?: number;
  taskId?: number;
  labelId?: number;
  filterId?: number;
  selfUserId?: number;
  bucketId?: number;
}

const EXPECTED_TOOLS_PRESENT = [
  'vikunja_auth',
  'vikunja_tasks',
  'vikunja_task_bulk',
  'vikunja_task_assignees',
  'vikunja_task_comments',
  'vikunja_task_reminders',
  'vikunja_task_labels',
  'vikunja_task_relations',
  'vikunja_projects',
  'vikunja_labels',
  'vikunja_teams',
  'vikunja_webhooks',
  'vikunja_filters',
  'vikunja_templates',
  'vikunja_batch_import',
  'vikunja_notifications',
  'vikunja_subscriptions',
  'vikunja_reactions',
].sort();

// Config-gated absences expected with API-token auth (tk_*) and default
// module config: users/export are JWT-only; tokens/caldav-tokens/admin/
// user_deletion are deny-by-default ("dangerous") modules with no config file
// enabling them (caldav-tokens is additionally JWT-only, like export — see
// src/tools/caldav-tokens.ts; user_deletion is additionally JWT-only, same as
// admin/export — this harness never exercises real account deletion against the
// stack; asserting its absence under default config is the honest live check).
const EXPECTED_TOOLS_ABSENT = [
  'vikunja_users',
  'vikunja_export_project',
  'vikunja_request_user_export',
  'vikunja_user_export_status',
  'vikunja_download_user_export',
  'vikunja_tokens',
  'vikunja_caldav_tokens',
  'vikunja_admin',
  'vikunja_user_deletion',
];

async function testToolList(h: McpHarness): Promise<void> {
  log('\n[Tool list]');
  const tools = await h.listToolNames();

  assertStep(
    'expected tool set is present',
    EXPECTED_TOOLS_PRESENT.every((t) => tools.includes(t)),
    `missing: ${EXPECTED_TOOLS_PRESENT.filter((t) => !tools.includes(t)).join(', ') || 'none'}`,
  );
  assertStep(
    'JWT/dangerous-gated tools are absent under API-token auth',
    EXPECTED_TOOLS_ABSENT.every((t) => !tools.includes(t)),
    `unexpectedly present: ${EXPECTED_TOOLS_ABSENT.filter((t) => tools.includes(t)).join(', ') || 'none'}`,
  );
  const unexpected = tools.filter(
    (t) => !EXPECTED_TOOLS_PRESENT.includes(t) && !EXPECTED_TOOLS_ABSENT.includes(t),
  );
  if (unexpected.length > 0) {
    log(`  note: tools present but not in either expectation list: ${unexpected.join(', ')}`);
  }
}

async function testAuth(h: McpHarness): Promise<void> {
  log('\n[Auth]');

  const status = await h.call('vikunja_auth', { subcommand: 'status' });
  if (assertOk('auth status', status)) {
    assertStep(
      'auth status reports authenticated + correct apiUrl',
      status.text.includes(VIKUNJA_URL) && /authenticated/i.test(status.text),
      status.text.slice(0, 300),
    );
  }

  const info = await h.call('vikunja_auth', { subcommand: 'info' });
  if (assertOk('auth info', info)) {
    assertStep(
      'auth info includes server version',
      /version/i.test(info.text),
      info.text.slice(0, 300),
    );
  }

  // Round-trip: connect again with the same credentials the server
  // auto-authenticated with at startup. Exercises vikunja_auth.connect's
  // actual code path (including its verify-connection round trip) rather
  // than just relying on env-var auto-auth at boot.
  const connect = await h.call('vikunja_auth', {
    subcommand: 'connect',
    apiUrl: VIKUNJA_URL,
    apiToken: process.env.__MCP_E2E_TOKEN__,
  });
  assertOk('auth connect (round trip)', connect);
}

async function testProjects(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Projects]');

  const title = `${NAME_PREFIX}project`;
  const create = await h.call('vikunja_projects', {
    subcommand: 'create',
    title,
    description: 'MCP e2e harness test project',
  });
  if (!assertOk('create project', create)) return;
  ctx.projectId = extractId(create.text);
  assertStep('create project response includes title', create.text.includes(title), create.text.slice(0, 300));
  if (!ctx.projectId) {
    fail('create project (id extraction)', `could not extract project id from: ${create.text.slice(0, 300)}`);
    return;
  }

  const get = await h.call('vikunja_projects', { subcommand: 'get', id: ctx.projectId });
  if (assertOk('get project', get)) {
    assertStep('get project returns matching title', get.text.includes(title), get.text.slice(0, 300));
  }

  const newDescription = 'updated by mcp-e2e harness';
  const update = await h.call('vikunja_projects', {
    subcommand: 'update',
    id: ctx.projectId,
    description: newDescription,
  });
  if (assertOk('update project', update)) {
    const verify = await h.call('vikunja_projects', { subcommand: 'get', id: ctx.projectId });
    const titlePreserved = verify.text.includes(title);
    const descriptionUpdated = verify.text.includes(newDescription);
    assertStep(
      'update project preserves title (fetch-merge-POST, ENDPOINT-PLAYBOOK.md §4)',
      titlePreserved,
      verify.text.slice(0, 400),
    );
    assertStep('update project applies new description', descriptionUpdated, verify.text.slice(0, 400));
    if (!titlePreserved) {
      record(
        'tool-bug',
        'vikunja_projects update clobbers title on partial update',
        `Called update with only {id, description}; expected the fetch-merge-POST pattern ` +
          `(ENDPOINT-PLAYBOOK.md §4) to preserve the existing title "${title}", but the ` +
          `subsequent get returned: ${verify.text.slice(0, 500)}`,
      );
    }
  }

  const list = await h.call('vikunja_projects', { subcommand: 'list' });
  if (assertOk('list projects', list)) {
    assertStep(
      'list projects includes created project',
      extractAllIds(list.text).includes(ctx.projectId),
      list.text.slice(0, 300),
    );
  }
}

// G7 (docs/ENDPOINT-TAIL-RETRIAGE.md): project backgrounds
// (remove-background/set-unsplash-background/search-unsplash) are gated
// behind the opt-in, deny-by-default `backgrounds` module config key — the
// e2e stack's config leaves it at its default (disabled), and there is no
// Unsplash provider key configured on it either way, so these subcommands
// are NEVER exercised live here. This only asserts default-absence: with
// the module disabled, the three subcommand names are not part of
// `vikunja_projects`'s schema at all, so calling them must fail with a
// schema/protocol-level error (MCP SDK's `Invalid arguments` /
// `InvalidParams`), not merely a handler-level rejection.
async function testProjectBackgroundsAbsence(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Project backgrounds — default-absence (opt-in `backgrounds` module, off by default)]');

  const attempts: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'remove-background', args: { subcommand: 'remove-background', id: ctx.projectId ?? 1 } },
    {
      name: 'set-unsplash-background',
      args: { subcommand: 'set-unsplash-background', id: ctx.projectId ?? 1, unsplashImageId: 'test' },
    },
    { name: 'search-unsplash', args: { subcommand: 'search-unsplash' } },
  ];

  for (const attempt of attempts) {
    const result = await h.call('vikunja_projects', attempt.args);
    // With the module disabled, the subcommand name is absent from
    // `vikunja_projects`'s schema enum, so the MCP SDK's input validation
    // rejects the call. As of @modelcontextprotocol/sdk >=1.22 the server
    // surfaces that as an `isError` tool result ("Input validation error:
    // Invalid arguments for tool vikunja_projects: ...") rather than a
    // thrown JSON-RPC error, so `callTool` resolves instead of rejecting.
    // A schema-shaped rejection is the pass; a non-error result (the
    // subcommand actually ran) means the module is enabled — real config
    // drift worth flagging.
    const schemaRejected = result.isError && /invalid|unrecognized|enum/i.test(result.text);
    assertStep(
      `${attempt.name} subcommand is absent by default`,
      schemaRejected,
      `expected a schema-validation rejection (backgrounds module disabled) but got ` +
        `isError=${result.isError}: ${result.text.slice(0, 200)}`,
    );
  }
}

async function testTasks(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Tasks]');
  if (!ctx.projectId) {
    skip('tasks flow', 'no project id from earlier step');
    return;
  }

  const title = `${NAME_PREFIX}task-1`;
  const create = await h.call('vikunja_tasks', {
    subcommand: 'create',
    title,
    projectId: ctx.projectId,
    priority: 3,
  });
  if (!assertOk('create task', create)) return;
  ctx.taskId = extractId(create.text);
  assertStep('create task response includes title', create.text.includes(title), create.text.slice(0, 300));
  if (!ctx.taskId) {
    fail('create task (id extraction)', `could not extract task id from: ${create.text.slice(0, 300)}`);
    return;
  }

  const updatedTitle = `${NAME_PREFIX}task-1-updated`;
  const update = await h.call('vikunja_tasks', {
    subcommand: 'update',
    id: ctx.taskId,
    title: updatedTitle,
    priority: 5,
  });
  if (assertOk('update task', update)) {
    assertStep('update task reflects new title', update.text.includes(updatedTitle), update.text.slice(0, 400));
  }

  const projectList = await h.call('vikunja_tasks', { subcommand: 'list', projectId: ctx.projectId });
  if (assertOk('list tasks (project-scoped)', projectList)) {
    assertStep(
      'project-scoped list includes created task',
      extractAllIds(projectList.text).includes(ctx.taskId),
      projectList.text.slice(0, 300),
    );
  }

  // Cross-project GET /tasks path: list without projectId, which drives
  // TaskFilteringOrchestrator's direct-REST cross-project strategy
  // (src/tools/tasks/index.ts) rather than the project-scoped path above.
  // The e2e account accumulates tasks across runs, so an *unfiltered*
  // cross-project list can easily exceed the response formatter's 10-item
  // detail threshold (src/utils/simple-response.ts formatSuccessMessage) —
  // see the "list responses over 10 items include no item detail at all"
  // finding below. Use `search` to scope the aggregation to just this
  // task's own (unique, timestamped) title, so the assertion tests the
  // cross-project *path* rather than tripping over that separate formatting
  // limitation.
  const allList = await h.call('vikunja_tasks', { subcommand: 'list', search: updatedTitle });
  if (assertOk('list tasks (cross-project aggregation)', allList)) {
    const found = extractAllIds(allList.text).includes(ctx.taskId);
    assertStep('cross-project list includes created task', found, allList.text.slice(0, 300));
    if (!found) {
      record(
        'tool-bug',
        'vikunja_tasks list (no projectId, search-scoped) does not surface a task from a freshly-created project',
        `Created task ${ctx.taskId} in project ${ctx.projectId}, then called vikunja_tasks ` +
          `{subcommand:"list", search:"${updatedTitle}"} with no projectId (cross-project ` +
          `aggregation path). Expected the task in the results; got: ${allList.text.slice(0, 500)}`,
      );
    }
  }

  // Separately: an *unfiltered* cross-project list with more than 10 results
  // includes a count but omits the item list entirely (formatSuccessMessage
  // only calls formatDataItems when collection.length <= 10) — an AI caller
  // gets "Found 50 tasks" with literally zero identifying detail (no ids,
  // no titles) for any of them. Confirm and report this once, live, rather
  // than asserting it as a fixed constant.
  const unfilteredList = await h.call('vikunja_tasks', { subcommand: 'list' });
  if (!unfilteredList.isError) {
    const countMatch = /Found (\d+) tasks/.exec(unfilteredList.text);
    const count = countMatch?.[1] ? Number(countMatch[1]) : 0;
    const hasAnyItemDetail = /\(ID:\s*\d+\)/.test(unfilteredList.text);
    if (count > 10 && !hasAnyItemDetail) {
      record(
        'tool-bug',
        'vikunja_tasks list responses with >10 results include a count but no item detail at all',
        `Unfiltered cross-project vikunja_tasks {subcommand:"list"} reported "Found ${count} tasks" ` +
          'but the response text contains no per-item id/title detail whatsoever (formatSuccessMessage ' +
          'in src/utils/simple-response.ts only calls formatDataItems when collection.length <= 10, and ' +
          'otherwise renders only the count). An AI caller has no way to identify which tasks were ' +
          `returned. Response: ${unfilteredList.text.slice(0, 400)}`,
      );
    }
  }

  // duplicate (PUT /tasks/{taskID}/duplicate, no body) — copies the task
  // (labels, assignees, attachments, reminders) into the same project.
  // Cleanup: the duplicate lives in ctx.projectId, so the project-delete
  // step at the end of the run cleans it up too; no dedicated delete here.
  const duplicate = await h.call('vikunja_tasks', { subcommand: 'duplicate', id: ctx.taskId });
  if (assertOk('duplicate task', duplicate)) {
    const duplicatedTaskId = extractId(duplicate.text);
    assertStep(
      'duplicate task response reports a new task id distinct from the source',
      duplicatedTaskId !== undefined && duplicatedTaskId !== ctx.taskId,
      duplicate.text.slice(0, 300),
    );
  }

  // mark-read (POST /tasks/{projecttask}/read) — removes the current
  // user's unread-status entry for the task; no new resource, no cleanup.
  const markRead = await h.call('vikunja_tasks', { subcommand: 'mark-read', id: ctx.taskId });
  if (assertOk('mark-read task', markRead)) {
    assertStep(
      'mark-read response confirms the task id',
      markRead.text.includes(String(ctx.taskId)),
      markRead.text.slice(0, 300),
    );
  }
}

async function testLabels(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Labels]');
  if (!ctx.taskId) {
    skip('labels flow', 'no task id from earlier step');
    return;
  }

  const title = `${NAME_PREFIX}label`;
  const create = await h.call('vikunja_labels', {
    subcommand: 'create',
    title,
    hexColor: '#3b82f6',
  });
  if (!assertOk('create label', create)) return;
  ctx.labelId = extractId(create.text);
  if (!ctx.labelId) {
    fail('create label (id extraction)', `could not extract label id from: ${create.text.slice(0, 300)}`);
    return;
  }

  const apply = await h.call('vikunja_task_labels', {
    operation: 'apply-label',
    id: ctx.taskId,
    labels: [ctx.labelId],
  });
  assertOk('apply label to task', apply);

  const list = await h.call('vikunja_task_labels', { operation: 'list-labels', id: ctx.taskId });
  if (assertOk('list task labels', list)) {
    assertStep(
      'task label list includes applied label',
      list.text.includes(title) || extractAllIds(list.text).includes(ctx.labelId),
      list.text.slice(0, 300),
    );
  }
}

async function testAssignees(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Assignees]');
  if (!ctx.taskId || !ctx.projectId) {
    skip('assignees flow', 'no task/project id from earlier step');
    return;
  }

  // Resolve the e2e-test user's own numeric id via the project-scoped user
  // search (GET /projects/{id}/projectusers) rather than the JWT-only
  // vikunja_users tool, which is not registered under API-token auth.
  const search = await h.call('vikunja_projects', {
    subcommand: 'search-project-users',
    projectId: ctx.projectId,
    search: TEST_USERNAME,
  });
  if (!assertOk('search project users (resolve self id)', search)) return;
  ctx.selfUserId = extractId(search.text);
  if (!ctx.selfUserId) {
    fail(
      'search project users (id extraction)',
      `could not extract user id from: ${search.text.slice(0, 300)}`,
    );
    return;
  }

  const assign = await h.call('vikunja_task_assignees', {
    operation: 'assign',
    id: ctx.taskId,
    assignees: [ctx.selfUserId],
  });
  assertOk('assign self to task', assign);

  const list = await h.call('vikunja_task_assignees', { operation: 'list-assignees', id: ctx.taskId });
  // Known, tracked server-side regression: GET /tasks/{id}/assignees 500s
  // unconditionally on Vikunja 2.3.0 (fixed upstream on go-vikunja/vikunja's
  // main via PR #2791, but not in any tagged release yet at the time this
  // was written). Confirmed independently via raw REST (bypassing this tool
  // entirely) against a fresh task with zero assignees on the same local
  // stack — same 500. The MCP tool's request (GET /tasks/{taskID}/assignees,
  // no body) matches the OpenAPI spec exactly; this is a real server-side
  // bug on the version under test, not something the tool can work around
  // by sending a different request, and NOT a reason to skip this check
  // outright -- it still runs every time, on every version, and only this
  // exact signature is tolerated. Remove this tolerance once a Vikunja
  // release ships PR #2791 and re-promote this back to a hard failure.
  if (list.isError && /HTTP 500/.test(list.text) && /assignees/.test(list.text)) {
    driftTolerated(
      'list task assignees',
      'GET /tasks/{id}/assignees returns HTTP 500 on this Vikunja version, independent of caller',
      `vikunja_task_assignees {operation:"list-assignees", id:${ctx.taskId}} failed with: ` +
        `${list.text.slice(0, 300)}. Reproduced with a raw, tool-independent curl GET against ` +
        'a fresh task with zero assignees on the same local stack — same 500. Tracked upstream ' +
        'as go-vikunja/vikunja PR #2791 (fixed on main, not in a tagged release yet as of this ' +
        'writing). Retest against a newer Vikunja tag once one ships the fix, per ' +
        'docs/LOCAL-TESTING.md\'s "Version pinning and refresh" section -- if this still 500s ' +
        'there, remove this tolerance and let it fail for real.',
    );
    return;
  }
  if (assertOk('list task assignees', list)) {
    assertStep(
      'assignee list includes self',
      list.text.includes(TEST_USERNAME) || extractAllIds(list.text).includes(ctx.selfUserId),
      list.text.slice(0, 300),
    );
  }
}

async function testComments(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Comments]');
  if (!ctx.taskId) {
    skip('comments flow', 'no task id from earlier step');
    return;
  }

  const commentText = 'mcp-e2e harness comment';
  const create = await h.call('vikunja_task_comments', {
    operation: 'comment',
    id: ctx.taskId,
    comment: commentText,
  });
  if (!assertOk('add comment', create)) return;
  assertStep('add comment response includes text', create.text.includes(commentText), create.text.slice(0, 400));
  const commentId = extractId(create.text);

  const list = await h.call('vikunja_task_comments', { operation: 'list', id: ctx.taskId });
  if (assertOk('list comments', list)) {
    assertStep('comment list includes created comment', list.text.includes(commentText), list.text.slice(0, 400));
  }

  if (commentId) {
    const updatedText = 'mcp-e2e harness comment (updated)';
    const update = await h.call('vikunja_task_comments', {
      operation: 'update',
      id: ctx.taskId,
      commentId,
      comment: updatedText,
    });
    if (assertOk('update comment', update)) {
      assertStep('update comment reflects new text', update.text.includes(updatedText), update.text.slice(0, 400));
    }

    const del = await h.call('vikunja_task_comments', { operation: 'delete', id: ctx.taskId, commentId });
    assertOk('delete comment', del);
  } else {
    skip('update comment', 'could not extract comment id');
    skip('delete comment', 'could not extract comment id');
    record(
      'harness',
      'could not extract a comment id from vikunja_task_comments create response',
      `Response text: ${create.text.slice(0, 500)}`,
    );
  }
}

async function testReminders(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Reminders]');
  if (!ctx.taskId) {
    skip('reminders flow', 'no task id from earlier step');
    return;
  }

  const reminderDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const add = await h.call('vikunja_task_reminders', {
    operation: 'add-reminder',
    id: ctx.taskId,
    reminderDate,
  });
  assertOk('add reminder', add);

  const list = await h.call('vikunja_task_reminders', { operation: 'list-reminders', id: ctx.taskId });
  let hasReminder = false;
  if (assertOk('list reminders', list)) {
    hasReminder = list.text.length > 0 && /remind/i.test(list.text);
    assertStep('reminder list is non-empty', hasReminder, list.text.slice(0, 300));
  }

  const remove = await h.call('vikunja_task_reminders', {
    operation: 'remove-reminder',
    id: ctx.taskId,
    reminderIndex: 0,
  });
  assertOk('remove reminder', remove);
}

async function testKanban(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Kanban]');
  if (!ctx.projectId || !ctx.taskId) {
    skip('kanban flow', 'no project/task id from earlier step');
    return;
  }

  const views = await h.call('vikunja_projects', { subcommand: 'list-views', id: ctx.projectId });
  assertOk('list-views', views);

  const buckets = await h.call('vikunja_projects', { subcommand: 'list-buckets', id: ctx.projectId });
  if (!assertOk('list-buckets', buckets)) return;
  const bucketIds = extractAllIds(buckets.text);
  if (bucketIds.length === 0) {
    fail('list-buckets (has default bucket)', `no bucket ids found in: ${buckets.text.slice(0, 300)}`);
    return;
  }
  ctx.bucketId = bucketIds[0];

  // Item E1 / friction #3: `projectId` must work as an alias for `id` on
  // list-buckets (agents reach for it first — it's a sibling field used
  // elsewhere for sharing ops).
  const bucketsByProjectId = await h.call('vikunja_projects', {
    subcommand: 'list-buckets',
    projectId: ctx.projectId,
  });
  assertOk('list-buckets (projectId alias for id)', bucketsByProjectId);

  const setBucket = await h.call('vikunja_tasks', {
    subcommand: 'set-bucket',
    id: ctx.taskId,
    bucketId: ctx.bucketId,
  });
  assertOk('set-bucket', setBucket);

  // Item E1 / friction #1: `update`'s `bucketId` must actually be applied
  // (via the same view/bucket resolution set-bucket uses) rather than
  // silently dropped, and honestly reported in `affectedFields` alongside
  // another field changed in the same call.
  const updateWithBucket = await h.call('vikunja_tasks', {
    subcommand: 'update',
    id: ctx.taskId,
    priority: 3,
    bucketId: ctx.bucketId,
  });
  if (assertOk('update with bucketId', updateWithBucket)) {
    if (!updateWithBucket.text.includes('bucketId')) {
      fail(
        'update with bucketId (honestly reported in affectedFields)',
        `expected "bucketId" in affectedFields, got: ${updateWithBucket.text.slice(0, 300)}`,
      );
    } else {
      pass('update with bucketId (honestly reported in affectedFields)');
    }
  }
}

async function testNotifications(h: McpHarness): Promise<void> {
  log('\n[Notifications]');
  const list = await h.call('vikunja_notifications', { subcommand: 'list' });
  assertOk('list notifications', list);
}

/**
 * `vikunja_users` (JWT-only) — including its `get-avatar`/`set-avatar`/
 * `upload-avatar` subcommands (G5, docs/ENDPOINT-TAIL-RETRIAGE.md) — is not
 * registered at all under this harness's API-token (`tk_*`) auth; see
 * `EXPECTED_TOOLS_ABSENT`/`testToolList` above, and the same rationale
 * `testAssignees` documents for resolving the self user id via
 * `search-project-users` instead of `vikunja_users`. Calling an
 * unregistered tool yields an `isError` tool result ("Tool vikunja_users
 * not found") as of @modelcontextprotocol/sdk >=1.22 — the SDK returns it
 * rather than throwing a JSON-RPC error — so `callTool` resolves with
 * `isError: true`. That expected-absence path soft-skips. If the call
 * instead comes back non-error, `vikunja_users` got registered under
 * API-token auth — a real gating regression — so that path is a hard
 * failure, not a skip.
 */
async function testAvatarSettings(h: McpHarness): Promise<void> {
  log('\n[Avatar settings (soft-skip: vikunja_users is JWT-only)]');
  const result = await h.call('vikunja_users', { subcommand: 'get-avatar' });
  if (!result.isError) {
    fail(
      'avatar settings gating',
      'vikunja_users.get-avatar unexpectedly succeeded under API-token auth — JWT-only gating regression? ' +
        result.text.slice(0, 200),
    );
    return;
  }
  skip(
    'avatar settings (get-avatar/set-avatar/upload-avatar)',
    "vikunja_users is JWT-only; this harness runs under API-token auth so it can't exercise these subcommands",
  );
}

async function testSavedFilters(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Saved filters]');
  const title = `${NAME_PREFIX}filter`;

  const create = await h.call('vikunja_filters', {
    action: 'create',
    parameters: { title, filter: 'done = false' },
  });
  if (!assertOk('create saved filter', create)) return;
  ctx.filterId = extractId(create.text);
  assertStep('create saved filter includes title', create.text.includes(title), create.text.slice(0, 300));

  const list = await h.call('vikunja_filters', { action: 'list', parameters: {} });
  if (assertOk('list saved filters', list)) {
    assertStep('saved filter list includes created filter', list.text.includes(title), list.text.slice(0, 400));
  }

  if (ctx.filterId) {
    const del = await h.call('vikunja_filters', { action: 'delete', parameters: { id: ctx.filterId } });
    assertOk('delete saved filter', del);
    ctx.filterId = undefined; // deleted here; final cleanup should not re-attempt
  } else {
    fail('create saved filter (id extraction)', `could not extract filter id from: ${create.text.slice(0, 300)}`);
  }
}

/**
 * G4 (docs/ENDPOINT-TAIL-RETRIAGE.md): user-level webhooks
 * (`/user/settings/webhooks*`, `scope: 'user'`). Per the OpenAPI spec these
 * routes are JWTKeyAuth-only, but this harness always runs under a minted
 * `tk_*` API token (see the file header's safety note) - a rejection here
 * is an *expected*, tolerated outcome, not a bug, so it is recorded via
 * `driftTolerated` rather than `fail`. Anything else (a genuine crash, a
 * wrong path, a malformed response) still fails normally.
 */
function isAuthRejection(text: string): boolean {
  return /jwt|permission|token|auth/i.test(text);
}

async function testUserWebhooks(h: McpHarness): Promise<void> {
  log('\n[User-scoped webhooks (scope: user)]');

  const listEvents = await h.call('vikunja_webhooks', { subcommand: 'list-events', scope: 'user' });
  if (!listEvents.isError) {
    assertOk('user-scope list-events', listEvents);
  } else if (isAuthRejection(listEvents.text)) {
    driftTolerated(
      'user-scope list-events',
      'rejected under tk_* API-token auth (spec: JWTKeyAuth-only, expected)',
      listEvents.text.slice(0, 300),
    );
  } else {
    fail('user-scope list-events', listEvents.text.slice(0, 300));
  }

  const list = await h.call('vikunja_webhooks', { subcommand: 'list', scope: 'user' });
  if (!list.isError) {
    assertOk('user-scope list', list);
  } else if (isAuthRejection(list.text)) {
    driftTolerated(
      'user-scope list',
      'rejected under tk_* API-token auth (spec: JWTKeyAuth-only, expected)',
      list.text.slice(0, 300),
    );
  } else {
    fail('user-scope list', list.text.slice(0, 300));
  }

  // These are pure Zod/argument-consistency checks (no server round-trip),
  // so they must fail the same way regardless of auth type.
  const projectIdOnUserScope = await h.call('vikunja_webhooks', {
    subcommand: 'list',
    scope: 'user',
    projectId: 1,
  });
  assertStep(
    'user-scope rejects projectId',
    projectIdOnUserScope.isError,
    projectIdOnUserScope.text.slice(0, 300),
  );

  const missingProjectIdOnProjectScope = await h.call('vikunja_webhooks', { subcommand: 'list' });
  assertStep(
    "project-scope (default) requires projectId",
    missingProjectIdOnProjectScope.isError,
    missingProjectIdOnProjectScope.text.slice(0, 300),
  );
}

async function finalCleanup(h: McpHarness, ctx: FlowContext): Promise<void> {
  log('\n[Final cleanup]');

  if (ctx.filterId) {
    try {
      await h.call('vikunja_filters', { action: 'delete', parameters: { id: ctx.filterId } });
      log(`  deleted saved filter ${ctx.filterId}`);
    } catch (e) {
      log(`  could not delete saved filter ${ctx.filterId}: ${(e as Error).message}`);
    }
  }

  if (ctx.taskId) {
    try {
      await h.call('vikunja_tasks', { subcommand: 'delete', id: ctx.taskId });
      log(`  deleted task ${ctx.taskId}`);
    } catch (e) {
      log(`  could not delete task ${ctx.taskId}: ${(e as Error).message}`);
    }
  }

  if (ctx.labelId) {
    try {
      await h.call('vikunja_labels', { subcommand: 'delete', id: ctx.labelId });
      log(`  deleted label ${ctx.labelId}`);
    } catch (e) {
      log(`  could not delete label ${ctx.labelId}: ${(e as Error).message}`);
    }
  }

  if (ctx.projectId) {
    try {
      await h.call('vikunja_projects', { subcommand: 'delete', id: ctx.projectId });
      log(`  deleted project ${ctx.projectId}`);
    } catch (e) {
      log(`  could not delete project ${ctx.projectId}: ${(e as Error).message}`);
    }
  }

  log('Done.');
}

// ============================================================================
// Main
// ============================================================================

function buildProject(): void {
  log('Building project (npm run build)...');
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (buildResult.status !== 0) {
    throw new Error(`npm run build failed with exit code ${String(buildResult.status)}`);
  }
}

async function main(): Promise<void> {
  log('╔═════════════════════════════╗');
  log('║   MCP-layer E2E Harness (spawns dist/index.js)   ║');
  log('╚══════════════════════════════╝');

  assertLocalUrl(VIKUNJA_URL);
  buildProject();

  const token = await getApiToken();
  // Stashed only so vikunja_auth.connect can be exercised with the exact
  // same token the child process was booted with (see testAuth).
  process.env.__MCP_E2E_TOKEN__ = token;

  log(`\nSpawning dist/index.js against ${VIKUNJA_URL}...`);
  // Strip any ambient VIKUNJA_URL/VIKUNJA_API_TOKEN(_FILE) before overlaying
  // our own verified-local values — defense in depth on top of object-spread
  // ordering already doing this; see the safety note in the file header.
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^VIKUNJA_(URL|API_TOKEN|API_TOKEN_FILE)$/.test(k)),
  ) as Record<string, string>;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_ENTRY],
    env: {
      ...inheritedEnv,
      VIKUNJA_URL,
      VIKUNJA_API_TOKEN: token,
    },
  });

  const client = new Client({ name: 'mcp-e2e-harness', version: '1.0.0' }, { capabilities: {} });

  let exitCode = 0;
  try {
    await client.connect(transport);
    log('Connected to MCP server over stdio.');

    const h = new McpHarness(client);
    const ctx: FlowContext = {};

    try {
      await testToolList(h);
      await cleanupByPrefix(h);
      await testAuth(h);
      await testProjects(h, ctx);
      await testProjectBackgroundsAbsence(h, ctx);
      await testTasks(h, ctx);
      await testLabels(h, ctx);
      await testAssignees(h, ctx);
      await testComments(h, ctx);
      await testReminders(h, ctx);
      await testKanban(h, ctx);
      await testNotifications(h);
      await testAvatarSettings(h);
      await testSavedFilters(h, ctx);
      await testUserWebhooks(h);
    } finally {
      await finalCleanup(h, ctx);
    }
  } catch (e) {
    log(`\nFATAL: ${(e as Error).message}`);
    record('harness', 'harness crashed before completing the flow', (e as Error).stack || String(e));
    exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
  }

  // ============================================================================
  // Summary
  // ============================================================================

  log('\n[Summary]');
  const passed = results.filter((r) => r.passed).length;
  const failedResults = results.filter((r) => !r.passed && !r.skipped && !r.serverDrift);
  const skipped = results.filter((r) => r.skipped).length;
  const drifted = results.filter((r) => r.serverDrift).length;
  log(
    `Passed: ${passed}, Failed: ${failedResults.length}, Skipped: ${skipped}, ` +
      `Server-drift (tolerated): ${drifted}`,
  );

  if (findings.length > 0) {
    log('\n[Findings]');
    for (const f of findings) {
      log(`  [${f.category}] ${f.summary}`);
      log(`    ${f.detail.split('\n').join('\n    ')}`);
    }
  } else {
    log('\n[Findings] none');
  }

  if (failedResults.length > 0 || exitCode !== 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', e);
  process.exit(1);
});
