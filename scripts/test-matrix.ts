#!/usr/bin/env npx tsx
/**
 * One-command version-matrix test runner (Wave item T1, tracking issue #28).
 *
 * For a chosen Vikunja server version *and* DB backend, this script:
 *
 *   1. Ensures the local e2e stack (docker/e2e/docker-compose.yml) is up and
 *      healthy *on that version and backend* — recreating it (`npm run
 *      e2e:down` + `npm run e2e:up`) if a running stack reports a different
 *      version via GET /api/v1/info or a different DB backend (detected via
 *      `docker compose ps`, see `getRunningBackend`), or bringing it up
 *      fresh if it isn't running at all. The stack's own version pin
 *      defaults to 2.3.0 but is env-driven (see docker/e2e/docker-compose.yml's
 *      `VIKUNJA_VERSION` interpolation) — this script drives that the same
 *      way a human would: `VIKUNJA_VERSION=X.Y.Z npm run e2e:up`. The DB
 *      backend (item F2, tracking issue #28 — added so SQLite-only failure
 *      classes like #116's lock-storm-under-circuit-breaker aren't invisible
 *      to every run) works the same way: `VIKUNJA_DB=sqlite npm run e2e:up`,
 *      default `postgres` (see docker/e2e/bootstrap.sh).
 *   2. Runs BOTH existing test harnesses against it:
 *        - `npm run test:mcp`     (scripts/test-mcp.ts,  ~23 direct-REST checks)
 *        - `npm run test:e2e:mcp` (scripts/mcp-e2e.ts,   ~50+ MCP-tool-layer checks)
 *   3. Reads the *actual* running server version from GET /api/v1/info
 *      (never trusted from the env var alone — a requested tag might not
 *      exist, or the server might report something more specific).
 *   4. Parses each harness's own pass/fail/skip/server-drift lines out of
 *      its stdout (both harnesses already print one line per check in a
 *      stable, greppable format — see `parseHarnessOutput` below) and
 *      writes a verdict file to `e2e-verdicts/vikunja-<server-ver>-<db>.md`
 *      (the matrix is now version × db) with a `PASS`/`FAIL` header and the
 *      full per-check list.
 *
 * Usage:
 *   npm run test:matrix                                          # 2.3.0 / postgres (defaults)
 *   VIKUNJA_VERSION=2.4.0 npm run test:matrix                     # a different tag, still postgres
 *   VIKUNJA_DB=sqlite npm run test:matrix                         # default version, sqlite backend
 *   VIKUNJA_VERSION=2.4.0 VIKUNJA_DB=sqlite npm run test:matrix   # both dimensions
 *
 * See docs/LOCAL-TESTING.md's "Version-matrix testing" section for the full
 * writeup, including what to do when a new Vikunja release ships.
 *
 * SAFETY: exactly like scripts/mcp-e2e.ts, this script never reads the
 * ambient `VIKUNJA_URL` / `VIKUNJA_API_TOKEN` env vars a developer's shell
 * may already export (via direnv, a personal MCP client config, etc.) to
 * point the *server* at a real Vikunja account — this repo's own directory
 * has exactly such a production `.envrc`. Every child process this script
 * spawns gets a copy of `process.env` with those (plus
 * `VIKUNJA_API_TOKEN_FILE`) stripped, and `npm run test:mcp` is handed the
 * local stack's freshly-minted credentials explicitly instead. The target
 * URL is always the hard-coded local e2e port and is asserted to resolve to
 * localhost/127.0.0.1 before any test traffic is sent.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Configuration
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const LOCAL_API_URL = 'http://localhost:33456/api/v1';
const ENV_FILE = path.join(REPO_ROOT, 'docker', 'e2e', '.env');
const VERDICT_DIR = path.join(REPO_ROOT, 'e2e-verdicts');

const OUR_VERSION = (
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as { version: string }
).version;

function log(msg: string): void {
  // eslint-disable-next-line no-console -- this is a CLI script, not src/
  console.log(`[test-matrix] ${msg}`);
}

// ============================================================================
// Safety: never let ambient VIKUNJA_URL/VIKUNJA_API_TOKEN leak into anything
// this script spawns. See file header and docs/LOCAL-TESTING.md.
// ============================================================================

function safeBaseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.VIKUNJA_URL;
  delete env.VIKUNJA_API_TOKEN;
  delete env.VIKUNJA_API_TOKEN_FILE;
  return env;
}

function assertLocalUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(
      `Refusing to run: target host "${host}" (from ${url}) is not localhost/127.0.0.1. ` +
        'This runner must only ever point test:mcp at the disposable local e2e stack.',
    );
  }
}

// ============================================================================
// Child process helper — streams output live (so a human watching still
// sees progress on a ~minute-plus e2e run) while also capturing it for
// parsing.
// ============================================================================

interface RunResult {
  code: number;
  output: string;
}

function runCapture(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env });
    let output = '';
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      output += s;
      process.stdout.write(s);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      output += s;
      process.stderr.write(s);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

// ============================================================================
// Stack version detection / alignment
// ============================================================================

interface VikunjaInfo {
  version?: string;
}

type DbBackend = 'postgres' | 'sqlite';

async function getRunningServerVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${LOCAL_API_URL}/info`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as VikunjaInfo;
    return body.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Detects which DB-backend variant of the e2e stack (if any) is currently
 * running, by asking `docker compose ps` which of the two mutually
 * exclusive `vikunja`/`vikunja-sqlite` services (see docker-compose.yml's
 * profile design) is up. GET /api/v1/info doesn't report the DB backend, so
 * this is the only reliable signal short of inspecting container env vars.
 * Returns `null` if neither is running (or the docker compose call itself
 * fails, e.g. Docker not running).
 */
async function getRunningBackend(): Promise<DbBackend | null> {
  const composeFile = path.join(REPO_ROOT, 'docker', 'e2e', 'docker-compose.yml');
  const res = await runCaptureQuiet(
    'docker',
    ['compose', '-f', composeFile, '--profile', 'postgres', '--profile', 'sqlite', 'ps', '--services', '--filter', 'status=running'],
    safeBaseEnv(),
  );
  if (res.code !== 0) return null;
  const services = res.output
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (services.includes('vikunja-sqlite')) return 'sqlite';
  if (services.includes('vikunja')) return 'postgres';
  return null;
}

/** Like runCapture, but doesn't echo to this process's own stdout/stderr -- for status probes. */
function runCaptureQuiet(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/** "v2.3.0" -> "2.3.0"; leaves already-bare versions untouched. */
function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}

/**
 * Brings the local e2e stack up on `desiredVersion`/`desiredDb`, recreating
 * it (down -v, then up) if it's currently running a different version or a
 * different DB backend, and returns the *actual* server-reported version
 * string (from GET /info) once confirmed healthy.
 */
async function ensureStack(desiredVersion: string, desiredDb: DbBackend): Promise<string> {
  log(`Desired Vikunja version: ${desiredVersion} (db backend: ${desiredDb})`);
  const running = await getRunningServerVersion();
  const runningDb = running ? await getRunningBackend() : null;

  if (running && normalizeVersion(running) === desiredVersion && runningDb === desiredDb) {
    log(`Stack already up reporting ${running} on ${runningDb} (matches ${desiredVersion}/${desiredDb}) -- reusing it.`);
  } else if (running) {
    log(
      `Stack is up but reports ${running} on ${runningDb ?? 'an undetected backend'}, not ` +
        `${desiredVersion}/${desiredDb} -- recreating it.`,
    );
    const down = await runCapture('npm', ['run', 'e2e:down'], safeBaseEnv());
    if (down.code !== 0) {
      throw new Error('npm run e2e:down failed while switching Vikunja versions/backends -- see output above.');
    }
  } else {
    log(`Stack not reachable at ${LOCAL_API_URL} -- bringing it up fresh.`);
  }

  // Always run e2e:up (idempotent, and mints a fresh docker/e2e/.env token
  // in *this* worktree) even when the stack was already on the right
  // version/backend and didn't need recreating.
  const up = await runCapture('npm', ['run', 'e2e:up'], {
    ...safeBaseEnv(),
    VIKUNJA_VERSION: desiredVersion,
    VIKUNJA_DB: desiredDb,
  });
  if (up.code !== 0) {
    throw new Error('npm run e2e:up failed -- see output above.');
  }

  const finalVersion = await getRunningServerVersion();
  if (!finalVersion) {
    throw new Error('Stack came up but GET /api/v1/info did not respond -- cannot confirm server version.');
  }
  if (normalizeVersion(finalVersion) !== desiredVersion) {
    throw new Error(
      `Stack is up but GET /api/v1/info reports "${finalVersion}", not the requested ` +
        `"${desiredVersion}". Check that vikunja/vikunja:${desiredVersion} exists on Docker Hub ` +
        '(https://hub.docker.com/r/vikunja/vikunja/tags).',
    );
  }
  log(`Confirmed via GET /api/v1/info: server is running ${finalVersion}.`);
  return finalVersion;
}

// ============================================================================
// Harness output parsing
//
// Both scripts/test-mcp.ts and scripts/mcp-e2e.ts print one line per check
// in a stable format (`  ✓ name`, `  ✗ name (error)`, `  ⊘ name (skipped:
// reason)`) plus, in mcp-e2e.ts's case, `  ⚠ name (server-drift, tolerated:
// summary)` for the one known, tracked Vikunja 2.3.0 regression (see
// driftTolerated() there). Parsing that stdout — rather than modifying
// either harness's return shape — keeps this runner decoupled from their
// internals; only the four line prefixes below are load-bearing.
// ============================================================================

type CheckStatus = 'pass' | 'fail' | 'skip' | 'server-drift';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
}

function parseHarnessOutput(output: string): CheckResult[] {
  const out: CheckResult[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    let m: RegExpMatchArray | null;

    if ((m = line.match(/^\s*✓\s+(.+)$/))) {
      out.push({ name: m[1].trim(), status: 'pass' });
      continue;
    }
    if ((m = line.match(/^\s*⚠\s+(.+?)\s*\(server-drift,\s*tolerated:\s*(.*)\)\s*$/))) {
      out.push({ name: m[1].trim(), status: 'server-drift', detail: m[2].trim() });
      continue;
    }
    if ((m = line.match(/^\s*⊘\s+(.+?)\s*\(skipped:\s*(.*)\)\s*$/))) {
      out.push({ name: m[1].trim(), status: 'skip', detail: m[2].trim() });
      continue;
    }
    if ((m = line.match(/^\s*✗\s+(.+?)\s*\((.*)\)\s*$/))) {
      out.push({ name: m[1].trim(), status: 'fail', detail: m[2].trim() });
      continue;
    }
  }
  return out;
}

function extractFindingsBlock(output: string): string | null {
  const idx = output.indexOf('[Findings]');
  if (idx === -1) return null;
  // Everything from "[Findings]" to the end of the harness's own output
  // (or, if there's another bracketed section after it, stop there — none
  // of the current harnesses print one, but this is defensive).
  return output.slice(idx).trimEnd();
}

// ============================================================================
// Verdict rendering
// ============================================================================

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
  'server-drift': 'server-drift',
};

function renderChecklist(checks: CheckResult[]): string {
  if (checks.length === 0) return '(no checks parsed out of this harness\'s output -- see raw log above)';
  return checks
    .map((c) => {
      const label = STATUS_LABEL[c.status];
      const detail = c.detail ? ` (${c.detail})` : '';
      return `- [${label}] ${c.name}${detail}`;
    })
    .join('\n');
}

interface HarnessRun {
  label: string;
  npmScript: string;
  code: number;
  checks: CheckResult[];
  findingsBlock: string | null;
}

function harnessIsGreen(run: HarnessRun): boolean {
  const hardFailures = run.checks.filter((c) => c.status === 'fail').length;
  return run.code === 0 && hardFailures === 0;
}

function renderVerdict(params: {
  serverVersion: string;
  requestedVersion: string;
  db: DbBackend;
  runs: HarnessRun[];
}): { verdict: 'PASS' | 'FAIL'; markdown: string } {
  const { serverVersion, requestedVersion, db, runs } = params;
  const normalizedServerVersion = normalizeVersion(serverVersion);
  const overallPass = runs.every(harnessIsGreen);
  const verdict: 'PASS' | 'FAIL' = overallPass ? 'PASS' : 'FAIL';

  const lines: string[] = [];
  lines.push(`# vikunja-mcp-ng ${OUR_VERSION} vs Vikunja ${normalizedServerVersion} (${db}): ${verdict}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Requested VIKUNJA_VERSION: ${requestedVersion}`);
  lines.push(`DB backend (VIKUNJA_DB): ${db}`);
  lines.push(`Server-reported version (GET /api/v1/info): ${serverVersion}`);
  lines.push('');

  for (const run of runs) {
    const passed = run.checks.filter((c) => c.status === 'pass').length;
    const failed = run.checks.filter((c) => c.status === 'fail').length;
    const skipped = run.checks.filter((c) => c.status === 'skip').length;
    const drifted = run.checks.filter((c) => c.status === 'server-drift').length;

    lines.push(`## \`${run.npmScript}\` (${run.label}, ${run.checks.length} checks)`);
    lines.push('');
    lines.push(renderChecklist(run.checks));
    lines.push('');
    lines.push(
      `Summary: Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}, ` +
        `Server-drift (tolerated): ${drifted}. Exit code: ${run.code}.`,
    );
    lines.push('');

    if (run.findingsBlock) {
      lines.push('<details><summary>Raw findings block from this harness</summary>');
      lines.push('');
      lines.push('```');
      lines.push(run.findingsBlock);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  lines.push('## Verdict');
  lines.push('');
  if (overallPass) {
    lines.push(
      'PASS -- both harnesses completed with zero non-tolerated failures. Any `[server-drift]` ' +
        'entries above are known, tracked server-side regressions on this Vikunja version ' +
        '(tolerated, not silently skipped) -- see each entry\'s detail for the tracking reference.',
    );
  } else {
    const failing = runs.filter((r) => !harnessIsGreen(r)).map((r) => r.npmScript);
    lines.push(
      `FAIL -- one or more checks failed that are not a recognized/tolerated server-drift case: ` +
        `${failing.join(', ')}. See the [FAIL] entries above for detail.`,
    );
  }

  return { verdict, markdown: lines.join('\n') + '\n' };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const requestedVersion = (process.env.VIKUNJA_VERSION || '2.3.0').trim();
  const requestedDb = (process.env.VIKUNJA_DB || 'postgres').trim();
  if (requestedDb !== 'postgres' && requestedDb !== 'sqlite') {
    throw new Error(`VIKUNJA_DB must be 'postgres' or 'sqlite', got '${requestedDb}'.`);
  }
  const db: DbBackend = requestedDb;

  log(`vikunja-mcp-ng ${OUR_VERSION} -- version-matrix run against Vikunja ${requestedVersion} (db: ${db})`);

  const serverVersion = await ensureStack(requestedVersion, db);

  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(`Expected ${ENV_FILE} to exist after npm run e2e:up -- bootstrap did not write it.`);
  }
  const localCreds = readEnvFile(ENV_FILE);
  const localUrl = localCreds.VIKUNJA_URL;
  const localToken = localCreds.VIKUNJA_API_TOKEN;
  if (!localUrl || !localToken) {
    throw new Error(`${ENV_FILE} is missing VIKUNJA_URL/VIKUNJA_API_TOKEN -- re-run npm run e2e:up.`);
  }
  assertLocalUrl(localUrl);

  const runs: HarnessRun[] = [];

  log('\n=== Running: npm run test:mcp (REST layer) ===\n');
  const restEnv = { ...safeBaseEnv(), VIKUNJA_URL: localUrl, VIKUNJA_API_TOKEN: localToken };
  const restRun = await runCapture('npm', ['run', 'test:mcp'], restEnv);
  runs.push({
    label: 'REST layer',
    npmScript: 'npm run test:mcp',
    code: restRun.code,
    checks: parseHarnessOutput(restRun.output),
    findingsBlock: extractFindingsBlock(restRun.output),
  });

  log('\n=== Running: npm run test:e2e:mcp (MCP tool layer) ===\n');
  const e2eEnv = safeBaseEnv();
  const e2eRun = await runCapture('npm', ['run', 'test:e2e:mcp'], e2eEnv);
  runs.push({
    label: 'MCP tool layer',
    npmScript: 'npm run test:e2e:mcp',
    code: e2eRun.code,
    checks: parseHarnessOutput(e2eRun.output),
    findingsBlock: extractFindingsBlock(e2eRun.output),
  });

  const { verdict, markdown } = renderVerdict({ serverVersion, requestedVersion, db, runs });

  fs.mkdirSync(VERDICT_DIR, { recursive: true });
  const verdictPath = path.join(VERDICT_DIR, `vikunja-${normalizeVersion(serverVersion)}-${db}.md`);
  fs.writeFileSync(verdictPath, markdown);

  log(`\n=== Verdict: ${verdict} ===`);
  log(`Wrote ${verdictPath}`);

  process.exit(verdict === 'PASS' ? 0 : 1);
}

function readEnvFile(file: string): Record<string, string> {
  const content = fs.readFileSync(file, 'utf-8');
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[test-matrix] Fatal error:', e);
  process.exit(1);
});
