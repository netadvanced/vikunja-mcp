#!/usr/bin/env npx tsx
/**
 * Sample-page screenshot capture (Wave F, item N7-sample-screenshots)
 *
 * Seeds realistic demo data on the local e2e Vikunja stack
 * (docker/e2e/docker-compose.yml, see docs/LOCAL-TESTING.md), drives the
 * real Vikunja web UI with Playwright to capture the states described by
 * each `[SCREENSHOT: ...]` placeholder in docs/samples/*.md, writes PNGs to
 * docs/samples/assets/, and deletes everything it seeded so the stack stays
 * clean for a human to inspect afterwards.
 *
 * Usage:
 *   npm run e2e:up   # if not already running
 *   npx tsx scripts/capture-sample-screenshots.ts
 *
 * All selectors below were verified interactively against the pinned local
 * stack (vikunja/vikunja:2.3.0) before being hard-coded here; see this
 * item's PR description for the exploration notes. Re-verify them if the
 * stack's pinned version ever moves (docs/LOCAL-TESTING.md's "Version
 * pinning and refresh" section) and the frontend markup has changed.
 *
 * SAFETY: like scripts/mcp-e2e.ts, this deliberately does NOT read the
 * ambient VIKUNJA_URL / VIKUNJA_API_TOKEN env vars. The target is
 * hard-coded to the documented local e2e port and refuses to run against
 * anything that doesn't resolve to localhost. All seeded data (projects,
 * labels, teams, saved filters, a secondary user) is named/prefixed with
 * `sample-` and is swept for and deleted at both the start (so a prior
 * interrupted run never blocks a fresh one) and the end (in a `finally`
 * block) of every run.
 *
 * Known, deliberate gap: the three `[SCREENSHOT: ...]` placeholders in
 * docs/samples/admin-ops.md describe Vikunja's admin panel
 * (Settings -> Admin Panel), whose API (`/admin/*`) and frontend do not
 * exist yet in the pinned local stack version -- `GET /admin/overview`
 * 404s, and no `admin` group appears in `GET /routes` at all. This is the
 * documented, expected spec/pinned-version gap from docs/LOCAL-TESTING.md's
 * "Version pinning and refresh" section, not a bug in this script. Faking
 * that UI would be dishonest, so admin-ops.md's placeholders are replaced
 * with an explanatory note instead of an image -- see `updateAdminOpsDoc()`
 * below.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

// ============================================================================
// Configuration
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(REPO_ROOT, 'docs', 'samples');
const ASSETS_DIR = path.join(SAMPLES_DIR, 'assets');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker', 'e2e', 'docker-compose.yml');

// Deliberately NOT process.env.VIKUNJA_URL -- see file header.
const VIKUNJA_URL =
  process.env.CAPTURE_SCREENSHOTS_VIKUNJA_URL || 'http://localhost:33456/api/v1';
const VIKUNJA_WEB_URL =
  process.env.CAPTURE_SCREENSHOTS_VIKUNJA_WEB_URL || 'http://localhost:33456';

function assertLocalUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(
      `Refusing to run: target host "${host}" is not localhost. This script seeds and ` +
        'deletes data and must only ever run against the disposable local e2e stack ' +
        '(npm run e2e:up), never a real Vikunja instance.',
    );
  }
}
assertLocalUrl(VIKUNJA_URL);
assertLocalUrl(VIKUNJA_WEB_URL);

const PRIMARY_USERNAME = 'e2e-test';
const PRIMARY_PASSWORD = 'VikunjaMcpE2E-2026!';
const SECONDARY_USERNAME = 'sample-alice';
const SECONDARY_PASSWORD = 'SampleAlice-2026!';
const SECONDARY_EMAIL = 'sample-alice@vikunja-mcp.local';
const PREFIX = 'sample-';
const TOKEN_TITLE = 'vikunja-mcp-sample-screenshots';

const VIEWPORT = { width: 1280, height: 800 };

function log(msg: string): void {
  // eslint-disable-next-line no-console -- this is a CLI script, not src/
  console.log(msg);
}

// ============================================================================
// REST helper
// ============================================================================

async function api<T>(token: string, method: string, urlPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${VIKUNJA_URL}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Vikunja's /login endpoint has its own brute-force rate limit, separate
 * from (and apparently tighter than) general API rate limiting -- retry
 * with backoff on 429 rather than failing the whole run over a transient
 * limit, since this script is deliberately frugal about how many times it
 * calls login() (see the comments at each call site) but a shared-host
 * local stack can still have residual state from unrelated manual testing.
 */
async function login(username: string, password: string): Promise<string> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${VIKUNJA_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      const body = (await res.json()) as { token: string };
      return body.token;
    }
    const text = await res.text();
    if (res.status === 429 && attempt < maxAttempts) {
      const waitMs = 15000 * attempt;
      log(`  POST /login for ${username} rate-limited (429); retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(
      `POST /login for ${username} failed: ${res.status} ${text} -- is the e2e stack up ` +
        "('npm run e2e:up') and bootstrapped?",
    );
  }
  throw new Error(`POST /login for ${username} failed after ${maxAttempts} attempts.`);
}

/**
 * The e2e-test JWT (docker/e2e/bootstrap.sh's TEST_PASSWORD) is short-lived
 * (~10 minutes) -- too short for this script's full seed+capture run. Mint
 * a long-lived tk_* API token the same way bootstrap.sh does, requesting
 * every permission the server advertises via GET /routes.
 *
 * NOTE: `subscriptions` is not among the groups GET /routes advertises even
 * though the endpoint exists and works over a JWT -- an API token minted
 * this way cannot call it. Subscribe/unsubscribe calls use a fresh JWT
 * instead (see `seed()`).
 */
async function mintApiToken(jwt: string): Promise<string> {
  const routes = await api<Record<string, Record<string, unknown>>>(jwt, 'GET', '/routes');
  const permissions: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(routes)) {
    permissions[key] = Object.keys(value);
  }
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  const res = await fetch(`${VIKUNJA_URL}/tokens`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TOKEN_TITLE, permissions, expires_at: expiresAt }),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`PUT /tokens failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function revokeStaleTokens(jwt: string): Promise<void> {
  const tokens = await api<Array<{ id: number; title: string }>>(jwt, 'GET', '/tokens');
  for (const t of tokens.filter((t) => t.title === TOKEN_TITLE)) {
    await api(jwt, 'DELETE', `/tokens/${t.id}`).catch(() => undefined);
  }
}

// ============================================================================
// CLI helpers (secondary user management -- there's no /admin/users API on
// this pinned Vikunja version, so user create/delete goes through the
// container's own CLI, same as docker/e2e/bootstrap.sh does for the
// primary user).
// ============================================================================

function vikunjaCli(args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'vikunja', '/app/vikunja/vikunja', ...args],
    { encoding: 'utf-8' },
  );
}

function findCliUserId(username: string): number | null {
  const out = vikunjaCli(['user', 'list']);
  for (const line of out.split('\n')) {
    const cells = line
      .split('│')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length >= 2 && cells[1] === username) {
      const id = Number(cells[0]);
      return Number.isNaN(id) ? null : id;
    }
  }
  return null;
}

function ensureSecondaryUserRemoved(): void {
  const id = findCliUserId(SECONDARY_USERNAME);
  if (id === null) return;
  log(`  Removing leftover CLI user '${SECONDARY_USERNAME}' (id ${id})...`);
  vikunjaCli(['user', 'delete', String(id), '--now', '--confirm']);
}

function createSecondaryUser(): void {
  log(`  Creating CLI user '${SECONDARY_USERNAME}'...`);
  vikunjaCli([
    'user',
    'create',
    '-u',
    SECONDARY_USERNAME,
    '-e',
    SECONDARY_EMAIL,
    '-p',
    SECONDARY_PASSWORD,
  ]);
}

// ============================================================================
// Cleanup-by-prefix (idempotent: run at start AND end)
// ============================================================================

interface ProjectSummary {
  id: number;
  title: string;
  parent_project_id?: number;
}

async function cleanupByPrefix(token: string): Promise<void> {
  log('Sweeping for leftover sample- data...');

  // Projects (real, positive ids) and saved filters (pseudo-projects with
  // negative ids) both come back from GET /projects.
  const projects = await api<ProjectSummary[]>(token, 'GET', '/projects?per_page=200');
  const staleReal = projects.filter((p) => p.id > 0 && p.title.startsWith(PREFIX));
  const staleFilters = projects.filter((p) => p.id < 0 && p.title.startsWith(PREFIX));

  // Delete children before parents so a parent delete never trips over a
  // still-existing child.
  const withParent = staleReal.filter((p) => p.parent_project_id);
  const withoutParent = staleReal.filter((p) => !p.parent_project_id);
  for (const p of [...withParent, ...withoutParent]) {
    try {
      await api(token, 'DELETE', `/projects/${p.id}`);
      log(`  Deleted stale project "${p.title}" (${p.id})`);
    } catch (err) {
      log(`  WARN: failed to delete stale project "${p.title}" (${p.id}): ${String(err)}`);
    }
  }
  for (const f of staleFilters) {
    // A saved filter's real numeric id and its pseudo-project id (as seen
    // in GET /projects) are related by pseudoId = -(realId + 1), not a
    // plain sign flip -- verified against a real create+list round trip.
    const realId = Math.abs(f.id) - 1;
    try {
      await api(token, 'DELETE', `/filters/${realId}`);
      log(`  Deleted stale filter "${f.title}" (${realId})`);
    } catch (err) {
      log(`  WARN: failed to delete stale filter "${f.title}" (${realId}): ${String(err)}`);
    }
  }

  const labels = await api<Array<{ id: number; title: string }>>(token, 'GET', '/labels');
  for (const l of labels.filter((l) => l.title.startsWith(PREFIX))) {
    try {
      await api(token, 'DELETE', `/labels/${l.id}`);
      log(`  Deleted stale label "${l.title}" (${l.id})`);
    } catch (err) {
      log(`  WARN: failed to delete stale label "${l.title}": ${String(err)}`);
    }
  }

  const teams = await api<Array<{ id: number; name: string }>>(token, 'GET', '/teams');
  for (const t of teams.filter((t) => t.name.startsWith(PREFIX))) {
    try {
      await api(token, 'DELETE', `/teams/${t.id}`);
      log(`  Deleted stale team "${t.name}" (${t.id})`);
    } catch (err) {
      log(`  WARN: failed to delete stale team "${t.name}": ${String(err)}`);
    }
  }

  ensureSecondaryUserRemoved();
}

// ============================================================================
// Seeding
// ============================================================================

interface Seeded {
  websiteId: number;
  websiteListViewId: number;
  websiteKanbanViewId: number;
  infraId: number;
  q3PlanningId: number;
  backlogId: number;
  backlogListViewId: number;
  productId: number;
  q2LaunchId: number;
  duplicatedLaunchId: number;
  duplicatedLaunchKanbanViewId: number;
  urgentLabelId: number;
  designTeamId: number;
  marketingTeamId: number;
  infraCommentId: number;
  infraCommentTaskId: number;
  loginBugTaskId: number;
}

async function createProject(token: string, title: string, parentProjectId?: number): Promise<number> {
  const body: Record<string, unknown> = { title: `${PREFIX}${title}` };
  if (parentProjectId) body.parent_project_id = parentProjectId;
  const p = await api<{ id: number }>(token, 'PUT', '/projects', body);
  return p.id;
}

interface ViewSummary {
  id: number;
  view_kind: string;
}

async function getViews(token: string, projectId: number): Promise<ViewSummary[]> {
  return api(token, 'GET', `/projects/${projectId}/views`);
}

async function getKanbanViewId(token: string, projectId: number): Promise<number> {
  const views = await getViews(token, projectId);
  const kanban = views.find((v) => v.view_kind === 'kanban');
  if (!kanban) throw new Error(`No kanban view for project ${projectId}`);
  return kanban.id;
}

async function getListViewId(token: string, projectId: number): Promise<number> {
  const views = await getViews(token, projectId);
  const list = views.find((v) => v.view_kind === 'list');
  if (!list) throw new Error(`No list view for project ${projectId}`);
  return list.id;
}

async function getBuckets(
  token: string,
  projectId: number,
  viewId: number,
): Promise<Array<{ id: number; title: string; position: number }>> {
  return api(token, 'GET', `/projects/${projectId}/views/${viewId}/buckets`);
}

/**
 * NOTE: `POST .../buckets/{bucket}` does a full-object-style update, not a
 * merge -- verified against a real request: renaming a bucket without also
 * resending its `position` silently reset the position to 0, which then
 * reshuffled column order in the UI (a bucket created afterwards for "In
 * Review" landed *after* "Done" instead of between "Doing" and "Done",
 * since its new default position sorted past the zeroed-out one). Always
 * pass the bucket's current `position` back through on every rename.
 */
async function renameBucket(
  token: string,
  projectId: number,
  viewId: number,
  bucketId: number,
  title: string,
  position: number,
): Promise<void> {
  await api(token, 'POST', `/projects/${projectId}/views/${viewId}/buckets/${bucketId}`, {
    title,
    position,
  });
}

async function createBucket(
  token: string,
  projectId: number,
  viewId: number,
  title: string,
  opts: { limit?: number; position?: number } = {},
): Promise<{ id: number }> {
  return api(token, 'PUT', `/projects/${projectId}/views/${viewId}/buckets`, {
    title,
    limit: opts.limit ?? 0,
    ...(opts.position !== undefined ? { position: opts.position } : {}),
  });
}

async function createTask(
  token: string,
  projectId: number,
  fields: { title: string; priority?: number; due_date?: string; description?: string },
): Promise<{ id: number }> {
  return api(token, 'PUT', `/projects/${projectId}/tasks`, fields);
}

async function moveTaskToBucket(
  token: string,
  projectId: number,
  viewId: number,
  bucketId: number,
  taskId: number,
): Promise<void> {
  await api(token, 'POST', `/projects/${projectId}/views/${viewId}/buckets/${bucketId}/tasks`, {
    task_id: taskId,
  });
}

async function seed(token: string, primaryJwt: string): Promise<Seeded> {
  log('Seeding demo data...');

  // --- Projects -------------------------------------------------------
  const websiteId = await createProject(token, 'Website Relaunch');
  const infraId = await createProject(token, 'Infra');
  const q3PlanningId = await createProject(token, 'Q3 Planning');
  const backlogId = await createProject(token, 'Backlog Intake');
  const productId = await createProject(token, 'Product');
  const q2LaunchId = await createProject(token, 'Q2 Product Launch', productId);
  log(
    `  Projects: website=${websiteId} infra=${infraId} q3planning=${q3PlanningId} ` +
      `backlog=${backlogId} product=${productId} q2launch=${q2LaunchId}`,
  );

  // --- Kanban board: "Website Relaunch" (Backlog / Doing / In Review / Done) ---
  const websiteKanbanViewId = await getKanbanViewId(token, websiteId);
  const websiteListViewId = await getListViewId(token, websiteId);
  const wBuckets = await getBuckets(token, websiteId, websiteKanbanViewId);
  const backlogBucket = wBuckets.find((b) => b.title === 'To-Do')!;
  const doingBucket = wBuckets.find((b) => b.title === 'Doing')!;
  const doneBucket = wBuckets.find((b) => b.title === 'Done')!;
  await renameBucket(
    token,
    websiteId,
    websiteKanbanViewId,
    backlogBucket.id,
    'Backlog',
    backlogBucket.position,
  );
  // Positioned explicitly between Doing (200) and Done (300) -- see the
  // createBucket doc comment: a create call's default position always
  // appends at the end, which would otherwise land "In Review" after
  // "Done".
  const inReviewBucket = await createBucket(token, websiteId, websiteKanbanViewId, 'In Review', {
    position: 250,
  });

  const now = new Date();
  const dueToday = new Date(now.getTime() + 6 * 3600 * 1000).toISOString();
  const dueTomorrow = new Date(now.getTime() + 30 * 3600 * 1000).toISOString();
  const dueThisWeek = new Date(now.getTime() + 4 * 24 * 3600 * 1000).toISOString();

  for (const title of ['Draft launch checklist', 'Collect stakeholder feedback', 'Audit old redirects']) {
    const t = await createTask(token, websiteId, { title });
    await moveTaskToBucket(token, websiteId, websiteKanbanViewId, backlogBucket.id, t.id);
  }

  // Moving a task into a bucket inserts it at the *top* (verified against a
  // real request: each successive move gets a smaller `position` than the
  // last) -- so to land the doc's required top-to-bottom order (login bug,
  // pricing copy, dark-mode toggle), move them into Doing in the reverse
  // order, login bug last.
  for (const title of ['Add dark-mode toggle', 'Update pricing copy']) {
    const t = await createTask(token, websiteId, { title });
    await moveTaskToBucket(token, websiteId, websiteKanbanViewId, doingBucket.id, t.id);
  }
  const loginBugTask = await createTask(token, websiteId, {
    title: 'Fix login redirect bug',
    priority: 4,
    due_date: dueToday,
  });
  await moveTaskToBucket(token, websiteId, websiteKanbanViewId, doingBucket.id, loginBugTask.id);

  const reviewTask = await createTask(token, websiteId, { title: 'Review new onboarding copy' });
  await moveTaskToBucket(token, websiteId, websiteKanbanViewId, inReviewBucket.id, reviewTask.id);

  for (const title of [
    'Set up staging environment',
    'Migrate DNS records',
    'Write launch announcement',
    'Retire old marketing site',
  ]) {
    const t = await createTask(token, websiteId, { title });
    await moveTaskToBucket(token, websiteId, websiteKanbanViewId, doneBucket.id, t.id);
  }

  // --- Infra / Q3 Planning: cross-project priority tasks for daily-triage ---
  await createTask(token, infraId, { title: 'Renew TLS cert', priority: 5, due_date: dueTomorrow });
  await createTask(token, q3PlanningId, {
    title: 'Finalize Q3 OKRs',
    priority: 3,
    due_date: dueThisWeek,
  });

  // --- Backlog Intake: ~40 tasks, some "sample-urgent"-labeled (power-moves) ---
  const backlogListViewId = await getListViewId(token, backlogId);
  const urgentLabel = await api<{ id: number }>(token, 'PUT', '/labels', {
    title: `${PREFIX}urgent`,
    hex_color: 'e74c3c',
  });
  const priorities = [1, 2, 3, 3, 4];
  for (let i = 1; i <= 40; i++) {
    const isUrgent = i % 5 === 0; // 8 urgent tasks
    const t = await createTask(token, backlogId, {
      title: `Backlog item ${i}`,
      priority: isUrgent ? 3 : priorities[i % priorities.length],
      description: `Imported backlog row ${i}.`,
    });
    if (isUrgent) {
      await api(token, 'PUT', `/tasks/${t.id}/labels`, { label_id: urgentLabel.id });
    }
  }

  // --- Product / Q2 Product Launch: hierarchy + duplicate (project-planning) ---
  const q2KanbanViewId = await getKanbanViewId(token, q2LaunchId);
  const q2Buckets = await getBuckets(token, q2LaunchId, q2KanbanViewId);
  const q2Todo = q2Buckets.find((b) => b.title === 'To-Do')!;
  for (const title of ['Finalize launch deck', 'Book press slots']) {
    const t = await createTask(token, q2LaunchId, { title });
    await moveTaskToBucket(token, q2LaunchId, q2KanbanViewId, q2Todo.id, t.id);
  }
  await createProject(token, 'Q3 Initiatives', productId);
  const dup = await api<{ duplicated_project: { id: number } }>(
    token,
    'PUT',
    `/projects/${q2LaunchId}/duplicate`,
    {},
  );
  const duplicatedLaunchId = dup.duplicated_project.id;
  const duplicatedLaunchKanbanViewId = await getKanbanViewId(token, duplicatedLaunchId);

  // --- Teams + secondary user (team-sharing) ---
  createSecondaryUser();
  const designTeam = await api<{ id: number }>(token, 'PUT', '/teams', { name: `${PREFIX}Design` });
  await api(token, 'PUT', `/projects/${websiteId}/teams`, { team_id: designTeam.id, permission: 1 });
  const marketingTeam = await api<{ id: number }>(token, 'PUT', '/teams', {
    name: `${PREFIX}Marketing`,
  });

  // --- Infra subscription + notifications + reaction (stay-informed) ---
  // Subscriptions are JWT-only (not in the token-minting GET /routes
  // groups) -- reuse the primary JWT from main() rather than logging in
  // again: Vikunja's own /login endpoint has its own (undocumented, fairly
  // tight) brute-force rate limit independent of general API rate
  // limiting, and this script must stay well under it across a run.
  await api(primaryJwt, 'PUT', `/subscriptions/project/${infraId}`, {});

  await api(token, 'PUT', `/projects/${infraId}/users`, {
    username: SECONDARY_USERNAME,
    permission: 1,
  });
  const secondaryToken = await login(SECONDARY_USERNAME, SECONDARY_PASSWORD);
  const infraTask = await api<{ id: number }>(secondaryToken, 'PUT', `/projects/${infraId}/tasks`, {
    title: 'Investigate elevated 5xx rate',
    priority: 4,
  });
  // Assigning e2e-test (user id 1) -> "assigned to you" notification.
  await api(secondaryToken, 'PUT', `/tasks/${infraTask.id}/assignees`, { user_id: 1 });
  // A comment on that task -> "commented on" notification; this is the one
  // stay-informed.md reacts to.
  const comment = await api<{ id: number }>(
    secondaryToken,
    'PUT',
    `/tasks/${infraTask.id}/comments`,
    { comment: 'Seeing this spike since the last deploy -- can you take a look?' },
  );
  // A second comment on the pre-existing "Renew TLS cert" task -> a third
  // unread notification, matching the doc narrative's "3 unread" count.
  const infraTasks = await api<Array<{ id: number; title: string }>>(
    token,
    'GET',
    `/projects/${infraId}/tasks`,
  );
  const tlsTask = infraTasks.find((t) => t.title === 'Renew TLS cert');
  if (tlsTask) {
    await api(secondaryToken, 'PUT', `/tasks/${tlsTask.id}/comments`, {
      comment: 'Reminder: this needs to happen before the cert expires.',
    });
  }

  return {
    websiteId,
    websiteListViewId,
    websiteKanbanViewId,
    infraId,
    q3PlanningId,
    backlogId,
    backlogListViewId,
    productId,
    q2LaunchId,
    duplicatedLaunchId,
    duplicatedLaunchKanbanViewId,
    urgentLabelId: urgentLabel.id,
    designTeamId: designTeam.id,
    marketingTeamId: marketingTeam.id,
    infraCommentId: comment.id,
    infraCommentTaskId: infraTask.id,
    loginBugTaskId: loginBugTask.id,
  };
}

// ============================================================================
// Playwright capture
// ============================================================================

interface Shot {
  file: string;
  page: string;
  snippet: string;
  alt: string;
  note?: string;
}

const shots: Shot[] = [];

async function uiLogin(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${VIKUNJA_WEB_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button.is-primary[type=button]');
  await page.waitForURL(`${VIKUNJA_WEB_URL}/`, { timeout: 15000 });
  await page.waitForTimeout(800);
}

async function shootFull(page: Page, file: string): Promise<void> {
  const dest = path.join(ASSETS_DIR, file);
  await page.screenshot({ path: dest, type: 'png' });
  const size = statSync(dest).size;
  log(`  Captured ${file} (${(size / 1024).toFixed(1)} KB)`);
}

async function shootLocator(
  page: Page,
  selector: string,
  file: string,
  filterText?: string,
): Promise<void> {
  const locator = filterText ? page.locator(selector, { hasText: filterText }) : page.locator(selector);
  const dest = path.join(ASSETS_DIR, file);
  await locator.first().screenshot({ path: dest, type: 'png' });
  const size = statSync(dest).size;
  log(`  Captured ${file} (${(size / 1024).toFixed(1)} KB, cropped)`);
}

/**
 * `.menu-container` (the project sidebar) has its own internal
 * `overflow-y: auto` scroll once the project list is longer than the
 * viewport -- a plain `locator.screenshot()` on it only captures whatever
 * is currently scrolled into view, which silently produces the *wrong*
 * (stale-scrolled) crop once enough unrelated leftover projects exist
 * above the one this script cares about (verified against a real run: with
 * 7 sibling projects above it, "sample-Product" scrolled off and its
 * children never rendered in the shot at all).
 *
 * This scrolls `anchorText`'s link into view first, then clips a fixed-size
 * region anchored on its *post-scroll* (i.e. viewport-relative, safe to use
 * directly in `page.screenshot({clip})`) bounding box -- covering the
 * anchor itself plus `rowsBelow` additional sidebar rows underneath it, so
 * the crop is both correct regardless of unrelated sidebar clutter above it
 * and tight per the "crop panes/columns" guidance rather than the whole,
 * often much taller, sidebar.
 */
async function shootSidebarRegion(
  page: Page,
  file: string,
  anchorText: string,
  rowsBelow: number,
): Promise<void> {
  const anchor = page.locator('.menu-container a', { hasText: anchorText }).first();
  // `scrollIntoViewIfNeeded()` scrolls the *minimum* distance needed, which
  // (verified against a real run) often lands the anchor flush against the
  // *bottom* of the viewport -- leaving no room below it for `rowsBelow`
  // more rows, so the clip silently gets clamped to almost nothing. Force
  // block:'start' instead so the anchor lands near the top, with the rest
  // of the viewport free for the rows underneath it.
  await anchor.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  const box = await anchor.boundingBox();
  if (!box) throw new Error(`Could not locate sidebar anchor "${anchorText}" for ${file}`);
  const rowHeight = box.height;
  const margin = 8;
  const clip = {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
    width: Math.min(VIEWPORT.width - box.x + margin, 300),
    height: rowHeight * (rowsBelow + 1) + margin * 2,
  };
  const dest = path.join(ASSETS_DIR, file);
  await page.screenshot({ path: dest, type: 'png', clip });
  const size = statSync(dest).size;
  log(`  Captured ${file} (${(size / 1024).toFixed(1)} KB, cropped)`);
}

async function captureAll(
  browser: Browser,
  s: Seeded,
  token: string,
  primaryJwt: string,
): Promise<void> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await uiLogin(page, PRIMARY_USERNAME, PRIMARY_PASSWORD);

  // ==== kanban-flow.md ====================================================
  await page.goto(`${VIKUNJA_WEB_URL}/projects/${s.websiteId}/${s.websiteKanbanViewId}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('.bucket', { timeout: 15000 });
  await page.waitForTimeout(500);
  // Four columns' worth of cards is a hair wider than the standard 1280
  // viewport (verified against a real run: "Done" was pushed fully
  // off-screen) -- widen just for this one shot so all four are visible at
  // once, matching what the placeholder describes, then restore 1280 for
  // everything else.
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.waitForTimeout(200);
  await shootFull(page, 'kanban-flow-01-board-columns.png');
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(200);
  shots.push({
    file: 'kanban-flow-01-board-columns.png',
    page: 'kanban-flow.md',
    snippet: 'four columns',
    alt: 'Vikunja Kanban view for the sample Website Relaunch project, showing four columns -- Backlog, Doing, In Review, Done -- with card counts in each column header',
  });

  await shootLocator(page, '.bucket', 'kanban-flow-02-doing-column.png', 'Doing');
  shots.push({
    file: 'kanban-flow-02-doing-column.png',
    page: 'kanban-flow.md',
    snippet: 'Doing column expanded',
    alt: 'The Doing column on the sample Website Relaunch board, expanded, showing three task cards -- "Fix login redirect bug", "Update pricing copy", "Add dark-mode toggle" -- top to bottom',
  });

  // Step 3: move the card via the real REST endpoint (the same one the MCP
  // tool's set-bucket subcommand calls), then capture the resulting board
  // state. Playwright cannot honestly capture a "mid-drag" animation frame
  // -- this is the completed state the doc's own "Resulting UI state" text
  // already describes.
  const wBucketsAfter = await getBuckets(token, s.websiteId, s.websiteKanbanViewId);
  const inReview = wBucketsAfter.find((b) => b.title === 'In Review')!;
  await moveTaskToBucket(token, s.websiteId, s.websiteKanbanViewId, inReview.id, s.loginBugTaskId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shootFull(page, 'kanban-flow-03-card-moved.png');
  shots.push({
    file: 'kanban-flow-03-card-moved.png',
    page: 'kanban-flow.md',
    snippet: 'mid-transition',
    alt: '"Fix login redirect bug" now under the In Review column header on the sample board, with Doing one card shorter than before',
    note: "Captured as the completed post-move state (Playwright can't honestly capture a mid-drag animation frame); caption adjusted from \"mid-transition\" to describe the resulting state instead.",
  });

  // Step 4: add a "Blocked" bucket with limit 3. The board is wider than
  // the viewport with 5 columns, so scroll the bucket container fully
  // right before capturing.
  await createBucket(token, s.websiteId, s.websiteKanbanViewId, 'Blocked', { limit: 3 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page
    .locator('.kanban-bucket-container')
    .first()
    .evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
  await page.waitForTimeout(300);
  await shootFull(page, 'kanban-flow-04-blocked-column.png');
  shots.push({
    file: 'kanban-flow-04-blocked-column.png',
    page: 'kanban-flow.md',
    snippet: 'new empty',
    alt: 'A new, empty "Blocked" column added after Done on the sample board, its header showing a "0 / 3" work-in-progress limit indicator',
  });

  // Step 5: the Done bucket is already the view's done_bucket_id by default
  // (Vikunja auto-designates the last default bucket as the done bucket on
  // project creation) -- open its "..." menu to show the checked
  // "Done bucket" option, the real board-settings surface for this.
  await page
    .locator('.kanban-bucket-container')
    .first()
    .evaluate((el) => {
      el.scrollLeft = 0;
    });
  await page.waitForTimeout(300);
  const doneBucketMenuButton = page
    .locator('.bucket', { hasText: 'Done' })
    .locator('button.dropdown-trigger');
  await doneBucketMenuButton.click();
  await page.waitForTimeout(400);
  await shootFull(page, 'kanban-flow-05-done-bucket.png');
  shots.push({
    file: 'kanban-flow-05-done-bucket.png',
    page: 'kanban-flow.md',
    snippet: 'checkmark icon',
    alt: 'The Done column\'s options menu on the sample board, showing "Done bucket" checked -- the real board-settings control for the view\'s done bucket',
  });
  await page.keyboard.press('Escape');

  // ==== daily-triage.md ====================================================
  await page.goto(`${VIKUNJA_WEB_URL}/tasks/by/upcoming`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shootFull(page, 'daily-triage-01-upcoming.png');
  shots.push({
    file: 'daily-triage-01-upcoming.png',
    page: 'daily-triage.md',
    snippet: 'Upcoming',
    alt: 'Vikunja\'s "Upcoming" cross-project task list showing tasks from multiple sample projects with due dates and priorities, sorted by urgency',
  });

  await page.goto(`${VIKUNJA_WEB_URL}/projects/${s.websiteId}/${s.websiteListViewId}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(600);
  await shootFull(page, 'daily-triage-02-website-list.png');
  shots.push({
    file: 'daily-triage-02-website-list.png',
    page: 'daily-triage.md',
    snippet: 'done-tasks filter',
    alt: 'Sample "Website Relaunch" project list view with the done-tasks filter toggled off, showing only open tasks',
  });

  // ==== power-moves.md =====================================================
  await page.goto(`${VIKUNJA_WEB_URL}/projects/${s.backlogId}/${s.backlogListViewId}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(800);
  await shootFull(page, 'power-moves-01-backlog-imported.png');
  shots.push({
    file: 'power-moves-01-backlog-imported.png',
    page: 'power-moves.md',
    snippet: '~40 tasks',
    alt: 'Sample "Backlog Intake" list view populated with 40 tasks, showing varying priority badges and "sample-urgent" label chips',
  });

  const backlogTasks = await api<Array<{ id: number; labels: Array<{ id: number }> | null }>>(
    token,
    'GET',
    `/projects/${s.backlogId}/tasks?per_page=50`,
  );
  const urgentIds = backlogTasks
    .filter((t) => (t.labels ?? []).some((l) => l.id === s.urgentLabelId))
    .map((t) => t.id);
  for (const id of urgentIds) {
    const task = await api<Record<string, unknown>>(token, 'GET', `/tasks/${id}`);
    await api(token, 'POST', `/tasks/${id}`, { ...task, priority: 5 });
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shootFull(page, 'power-moves-02-backlog-bulk-updated.png');
  shots.push({
    file: 'power-moves-02-backlog-bulk-updated.png',
    page: 'power-moves.md',
    snippet: 'DO NOW',
    alt: 'Sample "Backlog Intake" list view, the previously "sample-urgent"-labeled tasks now showing a priority-5 ("DO NOW") badge',
  });

  await api(token, 'PUT', '/filters', {
    title: `${PREFIX}Urgent backlog`,
    filters: { filter: `labels in ${s.urgentLabelId}` },
    is_favorite: true,
  });
  await page.goto(VIKUNJA_WEB_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shootSidebarRegion(page, 'power-moves-03-saved-filter-favorite.png', 'sample-Urgent backlog', 0);
  shots.push({
    file: 'power-moves-03-saved-filter-favorite.png',
    page: 'power-moves.md',
    snippet: 'Favorites section',
    alt: 'Vikunja sidebar showing "sample-Urgent backlog" listed as a saved-filter entry',
  });

  // ==== project-planning.md ================================================
  // Vikunja's sidebar shows child projects expanded by default -- no click
  // needed to reveal "sample-Q2 Product Launch" / "sample-Q3 Initiatives"
  // under "sample-Product".
  await page.goto(VIKUNJA_WEB_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await shootSidebarRegion(page, 'project-planning-01-sidebar-children.png', 'sample-Product', 2);
  shots.push({
    file: 'project-planning-01-sidebar-children.png',
    page: 'project-planning.md',
    snippet: 'both listed as children',
    alt: 'Vikunja sidebar showing "sample-Product" expanded with "sample-Q2 Product Launch" and the new "sample-Q3 Initiatives" both listed as children',
  });

  await shootSidebarRegion(page, 'project-planning-02-sidebar-tree.png', 'sample-Product', 2);
  shots.push({
    file: 'project-planning-02-sidebar-tree.png',
    page: 'project-planning.md',
    snippet: 'fully expanded under',
    alt: 'Vikunja sidebar fully expanded under "sample-Product", matching the project tree returned by get-tree',
  });

  await page.goto(
    `${VIKUNJA_WEB_URL}/projects/${s.duplicatedLaunchId}/${s.duplicatedLaunchKanbanViewId}`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(600);
  await shootFull(page, 'project-planning-03-duplicated-kanban.png');
  shots.push({
    file: 'project-planning-03-duplicated-kanban.png',
    page: 'project-planning.md',
    snippet: 'duplicated project',
    alt: 'The duplicated "sample-Q2 Product Launch - duplicate" project\'s Kanban board, matching the source project\'s columns and cards',
  });

  // ==== team-sharing.md =====================================================
  // Step 1's own action (share-with-user), performed live here rather than
  // during seed() -- the doc's "Setup for this walkthrough" only has the
  // Design team pre-existing; adding sample-alice is the demonstrated step.
  await api(token, 'PUT', `/projects/${s.websiteId}/users`, {
    username: SECONDARY_USERNAME,
    permission: 1,
  });
  const shareUrl = `${VIKUNJA_WEB_URL}/projects/${s.websiteId}/settings/share`;
  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shootLocator(page, '.modal-container', 'team-sharing-01-alice-added.png');
  shots.push({
    file: 'team-sharing-01-alice-added.png',
    page: 'team-sharing.md',
    snippet: 'alice added',
    alt: 'Project share panel showing sample-alice added under direct user shares with a "Read & write" permission badge',
  });

  await api(token, 'PUT', `/projects/${s.websiteId}/teams`, {
    team_id: s.marketingTeamId,
    permission: 0,
  });
  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shootLocator(page, '.modal-container', 'team-sharing-02-marketing-team-added.png');
  shots.push({
    file: 'team-sharing-02-marketing-team-added.png',
    page: 'team-sharing.md',
    snippet: 'Marketing (Read) added',
    alt: 'Project share panel Teams section with sample-Marketing (Read only) added below sample-Design (Read & write)',
  });

  await shootLocator(page, '.modal-container', 'team-sharing-03-full-panel.png');
  shots.push({
    file: 'team-sharing-03-full-panel.png',
    page: 'team-sharing.md',
    snippet: 'users and teams sections both expanded',
    alt: 'Full project Share panel with the Users and Teams sections both expanded, showing every user and team with access',
  });

  await api(token, 'DELETE', `/projects/${s.websiteId}/teams/${s.marketingTeamId}`);
  await page.goto(shareUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shootLocator(page, '.modal-container', 'team-sharing-04-marketing-removed.png');
  shots.push({
    file: 'team-sharing-04-marketing-removed.png',
    page: 'team-sharing.md',
    snippet: 'Marketing entry removed',
    alt: 'Project share panel Teams section with sample-Marketing removed and sample-Design still present',
  });
  await page.goto(VIKUNJA_WEB_URL, { waitUntil: 'networkidle' });

  // ==== stay-informed.md ====================================================
  // There's no distinct "subscribe bell" icon in the project header on this
  // Vikunja version -- subscription state instead shows as the project's
  // "..." menu entry toggling between "Subscribe"/"Unsubscribe". Capture
  // that as the nearest honest evidence of the subscribed state.
  await page.goto(`${VIKUNJA_WEB_URL}/projects/${s.infraId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('button:has(svg.fa-ellipsis)').first().click();
  await page.waitForTimeout(400);
  await shootFull(page, 'stay-informed-01-subscribed.png');
  shots.push({
    file: 'stay-informed-01-subscribed.png',
    page: 'stay-informed.md',
    snippet: 'subscribe bell icon',
    alt: 'Sample "Infra" project menu showing "Unsubscribe", confirming the project is now subscribed (this Vikunja version has no separate bell icon in the project header)',
    note: 'The doc placeholder describes a "subscribe bell icon" in the project header; this UI version has no such icon -- captured the project\'s "..." menu (Subscribe/Unsubscribe toggle) as the nearest honest evidence of subscription state instead.',
  });
  await page.keyboard.press('Escape');

  const bellButton = page.locator('.notifications button.trigger-button').first();
  await bellButton.click();
  await page.waitForTimeout(500);
  await shootFull(page, 'stay-informed-02-notifications-unread.png');
  shots.push({
    file: 'stay-informed-02-notifications-unread.png',
    page: 'stay-informed.md',
    snippet: 'three unread items',
    alt: 'Vikunja notification dropdown open, showing three unread notifications from the sample Infra activity (an assignment and two comments) with bold styling',
  });
  await page.keyboard.press('Escape');

  const notifications = await api<Array<{ id: number; name: string; read_at: string }>>(
    token,
    'GET',
    '/notifications?per_page=50',
  );
  const isUnread = (readAt: string) => readAt.startsWith('0001-01-01');
  const assigned = notifications.find((n) => isUnread(n.read_at) && n.name === 'task.assigned');
  if (assigned) {
    // POST /notifications/{id} isn't covered by the token-minting GET
    // /routes groups either (only the bulk POST /notifications "mark all
    // read" is) -- a tk_* API token gets a flat 401 here, same class of
    // gap as the subscriptions endpoint. Reuse the primary JWT from main()
    // (see the login-count comment in seed()).
    //
    // Despite the OpenAPI spec documenting this endpoint as taking no
    // request body (a "pure toggle"), and src/tools/notifications.ts's own
    // ensureNotificationRead comment describing it that way, an empty body
    // verifiably does NOT persist any change on this pinned server version
    // (confirmed with repeated POSTs against a real notification -- read_at
    // never left its zero-sentinel value). Sniffing the real frontend's own
    // request (Playwright network capture) showed it sends `read: true`
    // explicitly when marking read, which *does* persist. Send that
    // explicitly rather than relying on the documented blind-toggle
    // behavior -- this is a capture-script-only workaround; not a change
    // to src/tools/notifications.ts, which is out of scope for this item.
    await api(primaryJwt, 'POST', `/notifications/${assigned.id}`, { read: true });
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('.notifications button.trigger-button').first().click();
  await page.waitForTimeout(500);
  await shootFull(page, 'stay-informed-03-notification-read.png');
  shots.push({
    file: 'stay-informed-03-notification-read.png',
    page: 'stay-informed.md',
    snippet: 'now shown unbolded',
    alt: assigned
      ? 'Notification dropdown, the assignment notification now shown without bold styling, badge count reduced'
      : 'Notification dropdown after marking a notification read (no distinct unread assignment notification was found -- nearest honest state captured instead)',
    note: assigned
      ? undefined
      : 'No unread task.assigned notification was found to mark individually; see the script for detail.',
  });
  await page.keyboard.press('Escape');

  await api(token, 'PUT', `/comments/${s.infraCommentId}/reactions`, { value: '\u{1F44D}' });
  await page.goto(`${VIKUNJA_WEB_URL}/tasks/${s.infraCommentTaskId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await shootLocator(page, '.comments', 'stay-informed-04-reaction.png');
  shots.push({
    file: 'stay-informed-04-reaction.png',
    page: 'stay-informed.md',
    snippet: 'reaction chip',
    alt: 'Task comment thread on the sample Infra task, showing a comment with a thumbs-up reaction chip (count 1) beneath it',
  });

  await page.close();
}

// ============================================================================
// Doc updates
// ============================================================================

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacePlaceholder(content: string, shot: Shot): string {
  const lineRegex = new RegExp(`\`\\[SCREENSHOT:[^\\]]*${escapeRegExp(shot.snippet)}[^\\]]*\\]\`\n?`);
  if (!lineRegex.test(content)) {
    throw new Error(`Placeholder not found in doc for snippet: "${shot.snippet}" (${shot.file})`);
  }
  const replacement =
    `![${shot.alt}](assets/${shot.file})\n` + (shot.note ? `\n_${shot.note}_\n` : '');
  return content.replace(lineRegex, `${replacement}\n`);
}

function updateDoc(fileName: string): void {
  const filePath = path.join(SAMPLES_DIR, fileName);
  let content = readFileSync(filePath, 'utf-8');
  const docShots = shots.filter((s) => s.page === fileName);
  if (docShots.length === 0) throw new Error(`No captured shots recorded for ${fileName}`);
  for (const shot of docShots) {
    content = replacePlaceholder(content, shot);
  }
  writeFileSync(filePath, content);
  log(`  Updated ${fileName} (${docShots.length} placeholder(s) replaced)`);
}

function updateAllDocs(): void {
  log('Updating docs/samples/*.md with real screenshots...');
  for (const fileName of [
    'kanban-flow.md',
    'daily-triage.md',
    'power-moves.md',
    'project-planning.md',
    'team-sharing.md',
    'stay-informed.md',
  ]) {
    updateDoc(fileName);
  }
}

function updateAdminOpsDoc(): void {
  const filePath = path.join(SAMPLES_DIR, 'admin-ops.md');
  let content = readFileSync(filePath, 'utf-8');
  const note =
    '_Screenshot unavailable: the pinned local e2e stack (`vikunja/vikunja:2.3.0`, see ' +
    '[docs/LOCAL-TESTING.md](../LOCAL-TESTING.md#version-pinning-and-refresh)) does not yet ' +
    'implement the admin panel API or UI on this version -- `GET /admin/overview` 404s and no ' +
    '`admin` group appears in `GET /routes` at all. This is the documented spec/pinned-version ' +
    'gap (the vendored OpenAPI spec is ~1000 commits ahead of the pinned stable image), not a ' +
    'bug in the capture script. Re-run `scripts/capture-sample-screenshots.ts` once the stack is ' +
    're-pinned to a release that ships the admin panel._\n';
  const lineRegex = /`\[SCREENSHOT:[^\]]*\]`\n?/g;
  const count = (content.match(lineRegex) ?? []).length;
  if (count === 0) throw new Error('No [SCREENSHOT: ...] placeholders found in admin-ops.md');
  content = content.replace(lineRegex, `${note}\n`);
  writeFileSync(filePath, content);
  log(`  Updated admin-ops.md (${count} placeholder(s) replaced with an explanatory note)`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });

  log(`Logging in as '${PRIMARY_USERNAME}'...`);
  const primaryJwt = await login(PRIMARY_USERNAME, PRIMARY_PASSWORD);

  await cleanupByPrefix(primaryJwt);
  await revokeStaleTokens(primaryJwt);

  log('Minting a long-lived API token for the seed+capture run...');
  const token = await mintApiToken(primaryJwt);

  let seeded: Seeded | null = null;
  let browser: Browser | null = null;
  try {
    seeded = await seed(token, primaryJwt);

    log('Launching Chromium...');
    browser = await chromium.launch();
    await captureAll(browser, seeded, token, primaryJwt);

    updateAllDocs();
    updateAdminOpsDoc();

    const totalBytes = shots.reduce((sum, sh) => sum + statSync(path.join(ASSETS_DIR, sh.file)).size, 0);
    log('');
    log(`Captured ${shots.length} screenshots, ${(totalBytes / 1024).toFixed(1)} KB total.`);
    for (const sh of shots.filter((sh) => sh.note)) {
      log(`  NOTE (${sh.file}): ${sh.note}`);
    }
  } finally {
    if (browser) await browser.close();
    log('Cleaning up seeded sample- data...');
    // Reuse the long-lived API token minted above (still valid) rather than
    // logging in again -- Vikunja's own /login endpoint is itself
    // rate-limited, and this script already logs in up to three times
    // (primary, a fresh JWT for the JWT-only subscribe call, and the
    // secondary user) over the course of a single run.
    await cleanupByPrefix(token);
    log('Cleanup complete -- stack left clean. The token minted for this run ' +
      `("${TOKEN_TITLE}") is short-lived (1h) and swept by title at the start of the next run.`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- this is a CLI script, not src/
  console.error(err);
  process.exit(1);
});
