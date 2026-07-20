/**
 * Threat-model integration tests, per docs/OIDC-RESOURCE-SERVER.md §4
 * ("Defended" list) — item H2b.
 *
 * These drive the REAL Streamable HTTP transport (H1a) + REAL JWT validator
 * (H1b) against a local mock JWKS server, plus a REAL, file-backed,
 * AES-256-GCM vault (`src/auth/oidc/vaultCredentialSource.ts`, the H2b
 * interim implementation) and a local loopback stub standing in for
 * Vikunja's `/info` and `/projects` endpoints (so `vikunja_auth provision`'s
 * `verifyConnection()` round trip succeeds without a real Vikunja server —
 * `scripts/oidc-e2e.ts` runs the equivalent flow against the REAL local
 * stack; this suite is the fully-offline, CI-safe counterpart). Nothing here
 * touches the network beyond 127.0.0.1.
 *
 * Covered here (the six items item H2b's instructions call out by name):
 *   1. Audience confusion — a token minted for a different client is rejected.
 *   2. Expired / not-yet-valid (`nbf` in the future) tokens are rejected.
 *   3. `alg: none` and HS256 tokens are rejected.
 *   4. An oversized `Authorization` header does not crash or wedge the server.
 *   5. Malformed `Authorization` schemes are rejected uniformly.
 *   6. Vault-at-rest: the vault file on disk never contains the plaintext token.
 *   7. Log-leak scan: running the real provisioning flow with DEBUG logging
 *      never prints the raw token to the captured log output.
 *
 * Several of these (audience, expired, alg confusion) are already unit-tested
 * directly against the validator in tests/auth/oidc/jwtValidator.test.ts —
 * this suite's job is to prove the SAME defences hold through the full
 * transport+middleware+vault chain, not to re-derive the validator's logic.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as jose from 'jose';
import { startHttpTransport, type HttpTransportHandle } from '../../src/transport/httpTransport';
import { setOidcAuthMiddleware } from '../../src/transport/oidcMiddlewareSeam';
import { createOidcHttpAuthMiddleware } from '../../src/transport/oidcHttpAuth';
import { createOidcJwtValidator } from '../../src/auth/oidc/jwtValidator';
import {
  getVaultCredentialSource,
  resetVaultCredentialSourceForTests,
} from '../../src/auth/oidc/vaultCredentialSource';
import {
  generateTestKey,
  signTestToken,
  buildAlgNoneToken,
  startMockJwksServer,
  type MockJwksServer,
  type TestKey,
} from '../auth/oidc/helpers';

const ISSUER = 'https://idp.example.test/realms/threat-model';
const AUDIENCE = 'vikunja-mcp-ng';

let nextPort = 23870;
function allocatePort(): number {
  return nextPort++;
}

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw request helper that tolerates the connection being reset (oversized-header case). */
function rawRequest(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'POST',
        path: options.path ?? '/mcp',
        headers: options.headers,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function parseMcpMessages(res: RawResponse): unknown[] {
  const contentType = String(res.headers['content-type'] ?? '');
  if (contentType.includes('text/event-stream')) {
    return res.body
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => JSON.parse(line.slice('data:'.length).trim()));
  }
  if (res.body.trim().length === 0) {
    return [];
  }
  return [JSON.parse(res.body)];
}

function bearer(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function toolCallBody(id: number, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

function extractToolResult(res: RawResponse): {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
} {
  const messages = parseMcpMessages(res) as Array<{
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  }>;
  const withResult = messages.find(m => m.result !== undefined);
  if (!withResult?.result) {
    throw new Error(`No tool result in response: ${res.body}`);
  }
  return withResult.result;
}

/** Minimal loopback stub standing in for Vikunja's /info + /projects (provision's verifyConnection). */
function startFakeVikunja(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    // vikunjaRestRequest joins the configured base URL (which already ends
    // in `/api/v1`) with the endpoint path, so real requests land on
    // `/api/v1/info` etc. — match by suffix rather than assuming no prefix.
    if (pathname.endsWith('/info')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: '2.4.0-fake' }));
      return;
    }
    if (pathname.endsWith('/projects')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({}));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/api/v1`,
        close: () => new Promise<void>(r => server.close(() => r())),
      });
    });
  });
}

describe('OIDC threat model (docs/OIDC-RESOURCE-SERVER.md §4)', () => {
  let key: TestKey;
  let jwks: MockJwksServer;
  let fakeVikunja: { url: string; close: () => Promise<void> };
  let handle: HttpTransportHandle | undefined;
  let port: number;
  let vaultDir: string;
  let vaultPath: string;

  beforeAll(async () => {
    key = await generateTestKey('threat-model-key-1');
    jwks = await startMockJwksServer([key.jwk]);
    fakeVikunja = await startFakeVikunja();
  });

  afterAll(async () => {
    await jwks.close();
    await fakeVikunja.close();
  });

  beforeEach(async () => {
    port = allocatePort();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-vault-threat-'));
    vaultPath = path.join(vaultDir, 'vault.json');

    // Configure the SAME env-driven singleton `vikunja_auth`'s
    // provision/deprovision/status subcommands consult
    // (`getVaultCredentialSource()`, src/auth/oidc/vaultCredentialSource.ts)
    // so the auth-middleware's credential lookup and the tool's provisioning
    // calls operate on one shared vault file, exactly as in production.
    process.env.VIKUNJA_MCP_VAULT_PATH = vaultPath;
    process.env.VIKUNJA_MCP_VAULT_KEY = Buffer.alloc(32, 7).toString('hex');
    process.env.VIKUNJA_URL = fakeVikunja.url;
    resetVaultCredentialSourceForTests();

    const validator = createOidcJwtValidator(
      { issuer: ISSUER, audience: AUDIENCE, jwksUri: jwks.url },
      { jwtVerify: jose.jwtVerify, createRemoteJWKSet: jose.createRemoteJWKSet },
    );
    const vault = getVaultCredentialSource();
    if (!vault) {
      throw new Error('test setup error: vault should be configured via env vars above');
    }
    setOidcAuthMiddleware(createOidcHttpAuthMiddleware({ validator, credentialSource: vault }));

    handle = await startHttpTransport(
      () => {
        // A minimal real McpServer registering only vikunja_auth — these
        // tests exercise the auth boundary, not the tool surface, so a
        // full registerTools() isn't needed and keeps each case fast.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { registerAuthTool } = require('../../src/tools/auth');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AuthManager } = require('../../src/auth/AuthManager');
        const server = new McpServer({ name: 'threat-model-server', version: '0.0.0' });
        registerAuthTool(server, new AuthManager());
        return server;
      },
      { host: '127.0.0.1', port, path: '/mcp' },
    );
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    setOidcAuthMiddleware(undefined);
    delete process.env.VIKUNJA_MCP_VAULT_PATH;
    delete process.env.VIKUNJA_MCP_VAULT_KEY;
    delete process.env.VIKUNJA_URL;
    resetVaultCredentialSourceForTests();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  describe('1. Audience confusion', () => {
    it('rejects a token minted for a different client/audience in the same realm', async () => {
      const token = await signTestToken(key.privateKey, {
        kid: key.kid,
        issuer: ISSUER,
        audience: 'some-other-client', // NOT vikunja-mcp-ng
        sub: 'attacker',
      });
      const res = await rawRequest(port, {
        headers: bearer(token),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_token' });
    });
  });

  describe('2. Expired / not-yet-valid tokens', () => {
    it('rejects an expired token (well beyond clock-skew tolerance)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await signTestToken(key.privateKey, {
        kid: key.kid,
        issuer: ISSUER,
        audience: AUDIENCE,
        sub: 'user-1',
        issuedAt: now - 7200,
        expiresAt: now - 3600,
      });
      const res = await rawRequest(port, {
        headers: bearer(token),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a token whose nbf is in the future beyond clock-skew tolerance', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await signTestToken(key.privateKey, {
        kid: key.kid,
        issuer: ISSUER,
        audience: AUDIENCE,
        sub: 'user-1',
        notBefore: now + 3600,
        expiresAt: now + 7200,
      });
      const res = await rawRequest(port, {
        headers: bearer(token),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('3. Algorithm confusion', () => {
    it('rejects an alg:none token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = buildAlgNoneToken({
        iss: ISSUER,
        aud: AUDIENCE,
        sub: 'attacker',
        iat: now,
        exp: now + 3600,
      });
      const res = await rawRequest(port, {
        headers: bearer(token),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects an HS256 token "signed" with the RSA public key material as an HMAC secret', async () => {
      const publicJwk = await jose.exportJWK(key.publicKey);
      const secret = Buffer.from(JSON.stringify(publicJwk));
      const now = Math.floor(Date.now() / 1000);
      const token = await new jose.SignJWT({ sub: 'attacker' })
        .setProtectedHeader({ alg: 'HS256', kid: key.kid })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(secret);
      const res = await rawRequest(port, {
        headers: bearer(token),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('4. Oversized Authorization header', () => {
    it('does not crash the server, and the server keeps serving subsequent normal requests', async () => {
      // Larger than Node's default max HTTP header size (16KB). Node's own
      // http parser rejects this at the protocol level before it ever
      // reaches our middleware or tool code — empirically a clean `431
      // Request Header Fields Too Large` with the connection then closed,
      // rather than a hard socket reset. Either outcome (a 431, or a
      // rejected/reset connection) is an acceptable defence; the property
      // actually under test is resilience: the request must not crash the
      // process or wedge the listener for subsequent callers.
      const oversizedToken = 'a'.repeat(64 * 1024);

      let observed: { statusCode?: number; failed?: boolean };
      try {
        const res = await rawRequest(port, {
          headers: bearer(oversizedToken),
          body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
        });
        observed = { statusCode: res.statusCode };
      } catch {
        observed = { failed: true };
      }
      const gracefullyRejected = observed.failed === true || (observed.statusCode ?? 0) >= 400;
      expect(gracefullyRejected).toBe(true);

      // The server process/listener must have survived — prove it by
      // sending a normal, valid request right after and getting a normal
      // (rejected-but-well-formed) response.
      const res = await rawRequest(port, {
        headers: bearer('not-a-real-token'),
        body: toolCallBody(2, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('5. Malformed Authorization schemes', () => {
    it.each([
      ['no scheme at all', 'just-a-raw-string'],
      ['Basic scheme', 'Basic dXNlcjpwYXNz'],
      ['lowercase bearer with garbage token', 'bearer garbage-not-a-jwt'],
      ['Bearer with empty token', 'Bearer '],
    ])('rejects %s uniformly with a generic 401', async (_label, headerValue) => {
      const res = await rawRequest(port, {
        headers: { ...bearer(undefined), Authorization: headerValue },
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_token' });
    });

    it('rejects a request with no Authorization header at all', async () => {
      const res = await rawRequest(port, {
        headers: bearer(undefined),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'status' }),
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('6. Vault-at-rest verification', () => {
    it('the vault file on disk never contains the plaintext provisioned token', async () => {
      const secretToken = 'tk_super-secret-plaintext-marker-999';
      const token = await signTestToken(key.privateKey, {
        kid: key.kid,
        issuer: ISSUER,
        audience: AUDIENCE,
        sub: 'vault-check-user',
      });

      const res = await rawRequest(port, {
        headers: bearer(token),
        body: toolCallBody(1, 'vikunja_auth', { subcommand: 'provision', apiToken: secretToken }),
      });
      expect(res.statusCode).toBe(200);
      const result = extractToolResult(res);
      expect(result.isError).toBeFalsy();

      expect(fs.existsSync(vaultPath)).toBe(true);
      const rawBytes = fs.readFileSync(vaultPath, 'utf-8');
      // Literal grep of the vault file for the token, per the work item's
      // exact framing: the plaintext must never appear anywhere in the file.
      expect(rawBytes).not.toContain(secretToken);
      expect(rawBytes.includes(secretToken)).toBe(false);
    });
  });

  describe('7. Log-leak scan', () => {
    it('never prints the raw token to logs, even with DEBUG-level logging active', async () => {
      const secretToken = 'tk_debug-log-leak-check-marker-777';
      const token = await signTestToken(key.privateKey, {
        kid: key.kid,
        issuer: ISSUER,
        audience: AUDIENCE,
        sub: 'log-check-user',
      });

      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = 'true';
      const captured: string[] = [];
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });

      try {
        // Re-require the logger fresh under DEBUG=true — the singleton
        // reads its level once at module-load time (src/utils/logger.ts).
        await jest.isolateModulesAsync(async () => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('../../src/utils/logger');
        });

        const res = await rawRequest(port, {
          headers: bearer(token),
          body: toolCallBody(1, 'vikunja_auth', {
            subcommand: 'provision',
            apiToken: secretToken,
          }),
        });
        expect(res.statusCode).toBe(200);
      } finally {
        consoleErrorSpy.mockRestore();
        if (originalDebug === undefined) {
          delete process.env.DEBUG;
        } else {
          process.env.DEBUG = originalDebug;
        }
      }

      const allLogOutput = captured.join('\n');
      expect(allLogOutput).not.toContain(secretToken);
      expect(allLogOutput).not.toContain(token);
    });
  });
});
