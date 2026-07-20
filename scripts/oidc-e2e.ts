#!/usr/bin/env npx tsx
/**
 * OIDC `oidc-http` transport-mode e2e lane (item H2b, docs/OIDC-RESOURCE-SERVER.md).
 *
 * Sibling to `scripts/mcp-e2e.ts` (which drives the `stdio` transport over a
 * real MCP `Client`). This script instead:
 *
 *   1. Builds the project (`npm run build`).
 *   2. Starts an in-process, loopback-only **mock OIDC issuer**: a real RSA
 *      keypair + a tiny HTTP server serving its JWKS document (reusing the
 *      exact same signing/JWKS helpers the unit/integration test suites use
 *      — `tests/auth/oidc/helpers.ts` — per design decision D9, "e2e identity
 *      provider = mock OIDC issuer as the CI default").
 *   3. Spawns `dist/index.js` as a REAL child process in `oidc-http` mode
 *      (`VIKUNJA_MCP_TRANSPORT=http`), configured to validate bearer tokens
 *      against that mock issuer, with a fresh, temporary, real (AES-256-GCM)
 *      credential vault file — and pointed at the REAL local Vikunja stack
 *      (`docker/e2e`, `npm run e2e:up`) for actual Vikunja credentials, the
 *      same way `docker/e2e/bootstrap.sh` obtains one.
 *   4. Drives the spawned server with real HTTP requests (JSON-RPC over the
 *      Streamable HTTP transport) exercising the full provisioning lifecycle:
 *        (a) unauthenticated request -> 401
 *        (b) authenticated, unprovisioned identity -> structured
 *            AUTH_REQUIRED "provision" prompt
 *        (c) `vikunja_auth provision` with the stack's real test token
 *        (d) a REAL end-to-end tool call (`vikunja_projects list`) as the
 *            now-provisioned identity, hitting the real local Vikunja
 *        (e) `vikunja_auth deprovision`, then re-checking status confirms
 *            the identity is unprovisioned again
 *
 * Requires the local e2e stack running (`VIKUNJA_VERSION=2.4.0 npm run
 * e2e:up`) — see docs/LOCAL-TESTING.md. Nothing here touches the network
 * beyond 127.0.0.1: the mock issuer, the spawned server, and the target
 * Vikunja stack are all loopback-only.
 *
 * Usage:
 *   npx tsx scripts/oidc-e2e.ts
 *   npm run test:e2e:oidc   (see package.json)
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  generateTestKey,
  signTestToken,
  startMockJwksServer,
  type MockJwksServer,
  type TestKey,
} from '../tests/auth/oidc/helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');

// Deliberately NOT `process.env.VIKUNJA_URL` — same safety rationale as
// scripts/mcp-e2e.ts: never silently point a data-mutating harness at a
// developer's real, ambient Vikunja instance.
const VIKUNJA_URL = process.env.MCP_E2E_VIKUNJA_URL || 'http://localhost:33456/api/v1';
const TEST_USERNAME = 'e2e-test';
const TEST_PASSWORD = 'VikunjaMcpE2E-2026!';
const TOKEN_TITLE = 'vikunja-mcp-oidc-e2e-harness';

const ISSUER = 'https://idp.example.test/realms/oidc-e2e';
const AUDIENCE = 'vikunja-mcp-ng';

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
        'This harness must only ever run against the disposable local e2e stack (npm run e2e:up).',
    );
  }
}

let failures = 0;
function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[oidc-e2e] ${msg}`);
}
function pass(name: string): void {
  log(`PASS - ${name}`);
}
function fail(name: string, detail: string): void {
  failures += 1;
  log(`FAIL - ${name}: ${detail}`);
}
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

// ----------------------------------------------------------------------------
// Real Vikunja credentials (same login + PUT /tokens flow as
// docker/e2e/bootstrap.sh and scripts/mcp-e2e.ts)
// ----------------------------------------------------------------------------

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
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TOKEN_TITLE, permissions, expires_at: expiresAt }),
  });
  if (res.status !== 200 && res.status !== 201) {
    return null;
  }
  const body = (await res.json()) as { token: string | null };
  return body.token ?? null;
}

async function getRealVikunjaApiToken(): Promise<string> {
  if (process.env.MCP_E2E_VIKUNJA_API_TOKEN) {
    log('Using MCP_E2E_VIKUNJA_API_TOKEN from the environment.');
    return process.env.MCP_E2E_VIKUNJA_API_TOKEN;
  }
  log(`Logging in to the real local Vikunja stack as '${TEST_USERNAME}'...`);
  const jwt = await login();
  const token = await mintApiToken(jwt);
  if (token) {
    log('Obtained a real tk_* API token from the local stack.');
    return token;
  }
  log('Falling back to the JWT itself as the real Vikunja credential.');
  return jwt;
}

// ----------------------------------------------------------------------------
// Minimal JSON-RPC-over-Streamable-HTTP client (mirrors
// tests/oidc/http-e2e.test.ts's proven raw-request approach — stateless mode
// needs no session/initialize continuity between calls).
// ----------------------------------------------------------------------------

interface RpcToolResult {
  statusCode: number;
  isError?: boolean;
  text: string;
}

async function callTool(
  port: number,
  id: number,
  name: string,
  args: Record<string, unknown>,
  token: string | undefined,
): Promise<RpcToolResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const statusCode = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  const bodyText = await res.text();

  if (statusCode >= 400) {
    return { statusCode, text: bodyText };
  }

  let messages: Array<{ result?: { isError?: boolean; content?: Array<{ text?: string }> } }>;
  if (contentType.includes('text/event-stream')) {
    messages = bodyText
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => JSON.parse(line.slice('data:'.length).trim()));
  } else if (bodyText.trim().length === 0) {
    messages = [];
  } else {
    messages = [JSON.parse(bodyText)];
  }
  const withResult = messages.find(m => m.result !== undefined);
  if (!withResult?.result) {
    return { statusCode, text: bodyText };
  }
  const text = withResult.result.content?.map(c => c.text ?? '').join('\n') ?? '';
  return { statusCode, isError: withResult.result.isError, text };
}

async function waitForHealthz(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (res.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(
    `Server did not become healthy within ${timeoutMs}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  assertLocalUrl(VIKUNJA_URL);

  log('Building the project (npm run build)...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (build.status !== 0) {
    throw new Error('Build failed; aborting oidc-e2e run.');
  }

  const realApiToken = await getRealVikunjaApiToken();

  log('Starting the in-process mock OIDC issuer (RSA keypair + loopback JWKS server)...');
  const key: TestKey = await generateTestKey('oidc-e2e-key-1');
  const jwks: MockJwksServer = await startMockJwksServer([key.jwk]);

  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-oidc-e2e-vault-'));
  const vaultPath = path.join(vaultDir, 'vault.json');
  const vaultKey = crypto.randomBytes(32).toString('hex');
  const port = 8877 + Math.floor(Math.random() * 500);

  log(`Spawning dist/index.js in oidc-http mode on 127.0.0.1:${port}...`);
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.VIKUNJA_API_TOKEN;
  delete childEnv.VIKUNJA_API_TOKEN_FILE;
  Object.assign(childEnv, {
    VIKUNJA_URL,
    VIKUNJA_MCP_TRANSPORT: 'http',
    VIKUNJA_MCP_HTTP_HOST: '127.0.0.1',
    VIKUNJA_MCP_HTTP_PORT: String(port),
    VIKUNJA_MCP_HTTP_PATH: '/mcp',
    VIKUNJA_MCP_OIDC_ISSUER: ISSUER,
    VIKUNJA_MCP_OIDC_AUDIENCE: AUDIENCE,
    VIKUNJA_MCP_OIDC_JWKS_URI: jwks.url,
    VIKUNJA_MCP_VAULT_PATH: vaultPath,
    VIKUNJA_MCP_VAULT_KEY: vaultKey,
  });

  let child: ChildProcess | undefined;
  try {
    child = spawn('node', [DIST_ENTRY], { cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const serverLogs: string[] = [];
    child.stdout?.on('data', d => serverLogs.push(String(d)));
    child.stderr?.on('data', d => serverLogs.push(String(d)));

    await waitForHealthz(port, 15_000);
    log('Server is healthy.');

    const aliceSub = `oidc-e2e-alice-${Date.now()}`;
    const aliceToken = await signTestToken(key.privateKey, {
      kid: key.kid,
      issuer: ISSUER,
      audience: AUDIENCE,
      sub: aliceSub,
    });

    await step('(a) unauthenticated request is rejected with 401', async () => {
      const result = await callTool(port, 1, 'vikunja_auth', { subcommand: 'status' }, undefined);
      if (result.statusCode !== 401) {
        throw new Error(`expected 401, got ${result.statusCode}: ${result.text}`);
      }
    });

    await step('(b) authenticated but unprovisioned identity gets the provision prompt', async () => {
      const result = await callTool(port, 2, 'vikunja_auth', { subcommand: 'status' }, aliceToken);
      if (result.statusCode !== 200) {
        throw new Error(`expected 200 (auth ok, tool reports unlinked), got ${result.statusCode}`);
      }
      if (!result.text.includes('Not linked')) {
        throw new Error(`expected an unlinked status, got: ${result.text}`);
      }
    });

    await step('(c) vikunja_auth provision links the real local-stack token', async () => {
      const result = await callTool(
        port,
        3,
        'vikunja_auth',
        { subcommand: 'provision', apiToken: realApiToken },
        aliceToken,
      );
      if (result.statusCode !== 200 || result.isError) {
        throw new Error(`provision failed: HTTP ${result.statusCode}, isError=${result.isError}: ${result.text}`);
      }
      if (!result.text.includes('linked')) {
        throw new Error(`expected a "linked" confirmation, got: ${result.text}`);
      }
      if (result.text.includes(realApiToken)) {
        throw new Error('provision response echoed the raw token — must be masked');
      }
    });

    // KNOWN FAILING as of item H2b (2026-07-21) — this is the real, valuable
    // finding this e2e lane exists to surface, not a harness bug: most tool
    // handlers (src/tools/projects/index.ts among them) gate on
    // `authManager.isAuthenticated()` against the CLOSURE `AuthManager`
    // captured at `registerTools()` time, and pass that SAME closure
    // reference straight through to `vikunjaRestRequest()` — never
    // consulting the ALS-resolved, per-identity `AuthManager` that
    // `getAuthManagerFromContext()` (src/client.ts) correctly returns. Even
    // the handful of tools that DO call `getAuthManagerFromContext()`
    // (notifications, tasks, reactions, ...) only use it as a
    // throw-if-unprovisioned gate and then discard its return value,
    // continuing to use the closure `authManager` for the actual REST call.
    // Net effect: in oidc-http mode, a successfully provisioned identity's
    // real tool calls do not use their own vaulted credential at all — they
    // use whatever the process-global/stdio `AuthManager` happens to be
    // (typically unauthenticated, as here, so this step fails; if an
    // operator's process-global env ever DID carry a credential, this would
    // be a cross-user credential leak, docs/OIDC-RESOURCE-SERVER.md §3d row
    // #1's "Primary leak risk" — not a hypothetical, a reproducible one).
    // tests/oidc/isolation.test.ts's "Credential isolation" test does not
    // catch this because it exercises `getAuthManagerFromContext()` directly
    // rather than through a real tool handler. This is a pre-existing gap
    // (not introduced by this PR) that needs a dedicated, cross-tool-surface
    // fix — see this item's PR description.
    await step('(d) real end-to-end tool call as the provisioned identity (list projects)', async () => {
      const result = await callTool(port, 4, 'vikunja_projects', { subcommand: 'list' }, aliceToken);
      if (result.statusCode !== 200 || result.isError) {
        throw new Error(`list projects failed: HTTP ${result.statusCode}, isError=${result.isError}: ${result.text}`);
      }
    });

    await step('(e) vikunja_auth deprovision unlinks the identity', async () => {
      const result = await callTool(port, 5, 'vikunja_auth', { subcommand: 'deprovision' }, aliceToken);
      if (result.statusCode !== 200 || result.isError) {
        throw new Error(`deprovision failed: HTTP ${result.statusCode}: ${result.text}`);
      }
      const statusResult = await callTool(port, 6, 'vikunja_auth', { subcommand: 'status' }, aliceToken);
      if (!statusResult.text.includes('Not linked')) {
        throw new Error(`expected unlinked status after deprovision, got: ${statusResult.text}`);
      }
    });

    if (failures > 0) {
      log('---- spawned server logs (for debugging failures) ----');
      // eslint-disable-next-line no-console
      console.log(serverLogs.join(''));
    }
  } finally {
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
    await jwks.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }

  log(`Done. ${failures === 0 ? 'All steps passed.' : `${failures} step(s) FAILED.`}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error('[oidc-e2e] Unhandled error:', error);
  process.exitCode = 1;
});
