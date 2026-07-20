/**
 * Wave-H1 acceptance proof: in-process, end-to-end OIDC HTTP transport.
 *
 * This is the integration test the three H1 sub-items were designed to be
 * wired together for (docs/OIDC-RESOURCE-SERVER.md §3a/§3b/§3c/§3d). It starts
 * the REAL Streamable HTTP transport (H1a) on a loopback port, in front of a
 * REAL JWT validator (H1b) backed by a local mock JWKS server, feeding a REAL
 * per-identity ALS request context (H1c) and the H1 stub credential source —
 * then drives it over the wire with actual MCP JSON-RPC and asserts the whole
 * chain behaves:
 *
 *   (a) no bearer token                -> HTTP 401 + WWW-Authenticate (transport+middleware)
 *   (b) valid token, unprovisioned sub -> structured AUTH_REQUIRED tool error
 *                                         (transport -> middleware -> ALS -> credential source)
 *   (c) two different subs concurrently -> each request's tool error is masked
 *                                          to its OWN sub, never the other's
 *                                          (ALS context integrity — the
 *                                          load-bearing isolation property, §3d)
 *
 * Nothing here touches the network beyond 127.0.0.1.
 */

import * as http from 'node:http';
import * as jose from 'jose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startHttpTransport, type HttpTransportHandle } from '../../src/transport/httpTransport';
import { setOidcAuthMiddleware } from '../../src/transport/oidcMiddlewareSeam';
import { createOidcHttpAuthMiddleware } from '../../src/transport/oidcHttpAuth';
import { createOidcJwtValidator } from '../../src/auth/oidc/jwtValidator';
import { OidcStubCredentialSource } from '../../src/auth/CredentialSource';
import { registerTools } from '../../src/tools';
import { AuthManager } from '../../src/auth/AuthManager';
import { createVikunjaClientFactory } from '../../src/client';
import {
  generateTestKey,
  signTestToken,
  startMockJwksServer,
  type MockJwksServer,
  type TestKey,
} from '../auth/oidc/helpers';

const ISSUER = 'https://idp.example.test/realms/h1';
const AUDIENCE = 'vikunja-mcp-ng';

// Deterministic loopback ports: the transport's default DNS-rebinding
// `allowedHosts` derivation is `host:port` from the *configured* port, so the
// client's Host header must match exactly.
let nextPort = 21870;
function allocatePort(): number {
  return nextPort++;
}

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

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

/** Extracts JSON-RPC messages from a Streamable-HTTP response (SSE or plain JSON). */
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

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'h1-e2e', version: '0.0.0' },
  },
});

function toolCallBody(id: number, name: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

/** Pull the single tool-result object out of a parsed MCP response. */
function extractToolResult(res: RawResponse): {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
} {
  const messages = parseMcpMessages(res) as Array<{
    result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    error?: unknown;
  }>;
  const withResult = messages.find(m => m.result !== undefined);
  if (!withResult?.result) {
    throw new Error(`No tool result in response: ${res.body}`);
  }
  return withResult.result;
}

describe('OIDC HTTP transport — wave-H1 end-to-end acceptance', () => {
  let key: TestKey;
  let jwks: MockJwksServer;
  let handle: HttpTransportHandle | undefined;
  let port: number;

  beforeAll(async () => {
    key = await generateTestKey('h1-key-1');
    jwks = await startMockJwksServer([key.jwk]);
  });

  afterAll(async () => {
    await jwks.close();
  });

  beforeEach(async () => {
    port = allocatePort();

    // Real validator (H1b) against the loopback mock JWKS, injected with
    // jose's own statically-imported exports (the DI seam that keeps the
    // validator testable under Jest's CommonJS runner).
    const validator = createOidcJwtValidator(
      { issuer: ISSUER, audience: AUDIENCE, jwksUri: jwks.url },
      { jwtVerify: jose.jwtVerify, createRemoteJWKSet: jose.createRemoteJWKSet },
    );

    // Real integration middleware (H1a seam + H1b validator + H1c stub source).
    setOidcAuthMiddleware(
      createOidcHttpAuthMiddleware({
        validator,
        credentialSource: new OidcStubCredentialSource(),
      }),
    );

    // A fresh, fully-registered tool surface per request (stateless mode).
    // The closure AuthManager is deliberately left UNCONNECTED here — this is
    // the H2a acceptance proof for the closure-gate precedence fix
    // (docs/OIDC-RESOURCE-SERVER.md §3c, H1 integration owner-attention #2):
    // every tool's up-front `authManager.isAuthenticated()` gate now consults
    // the per-request ALS context FIRST (`hasRequestContext()`, src/client.ts)
    // and defers to `getAuthManagerFromContext()` whenever one is bound,
    // rather than ever evaluating the (always-unauthenticated-in-oidc-http-
    // mode) closure manager. Before that fix, this test needed a placeholder
    // credential connected here purely to make the closure gate pass so
    // execution could reach the real, per-identity check — see git history
    // for the workaround this replaced. A real client factory is still
    // supplied so clientFactory-gated tools (e.g. vikunja_notifications)
    // register.
    const closureAuth = new AuthManager();
    const clientFactory = await createVikunjaClientFactory(closureAuth);

    handle = await startHttpTransport(() => {
      const server = new McpServer({ name: 'h1-e2e-server', version: '0.0.0' });
      registerTools(server, closureAuth, clientFactory);
      return server;
    }, { host: '127.0.0.1', port, path: '/mcp' });
  });

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    setOidcAuthMiddleware(undefined);
  });

  async function mintToken(sub: string): Promise<string> {
    return signTestToken(key.privateKey, {
      kid: key.kid,
      issuer: ISSUER,
      audience: AUDIENCE,
      sub,
    });
  }

  it('(a) rejects a request with no bearer token: HTTP 401 + WWW-Authenticate', async () => {
    const res = await rawRequest(port, {
      headers: bearer(undefined),
      body: toolCallBody(2, 'vikunja_notifications', { subcommand: 'list' }),
    });

    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'] ?? '')).toContain('Bearer');
    expect(String(res.headers['www-authenticate'] ?? '')).toContain('invalid_token');
    expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_token' });
  });

  it('(a2) rejects a garbage bearer token the same way (validator rejects it)', async () => {
    const res = await rawRequest(port, {
      headers: bearer('not-a-real-jwt'),
      body: toolCallBody(2, 'vikunja_notifications', { subcommand: 'list' }),
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid_token' });
  });

  it('(b0) valid token: MCP initialize handshake succeeds over the transport', async () => {
    const res = await rawRequest(port, {
      headers: bearer(await mintToken('init-user')),
      body: INITIALIZE_BODY,
    });

    expect(res.statusCode).toBe(200);
    const messages = parseMcpMessages(res) as Array<{
      result?: { serverInfo?: { name?: string } };
    }>;
    const init = messages.find(m => m.result?.serverInfo);
    expect(init?.result?.serverInfo?.name).toBe('h1-e2e-server');
  });

  it('(b) valid token for an unprovisioned sub -> structured AUTH_REQUIRED provision prompt', async () => {
    const token = await mintToken('unprovisioned-user-42');
    const res = await rawRequest(port, {
      headers: bearer(token),
      body: toolCallBody(2, 'vikunja_notifications', { subcommand: 'list' }),
    });

    // The token is valid, so HTTP-level auth succeeds (200); the missing
    // credential surfaces as a structured tool error, not an HTTP failure.
    expect(res.statusCode).toBe(200);
    const result = extractToolResult(res);
    expect(result.isError).toBe(true);
    const text = result.content?.map(c => c.text ?? '').join('\n') ?? '';
    // Proves the credential source (OidcStubCredentialSource -> null ->
    // createOidcAuthRequiredError) is in the chain: the generic "not
    // connected" message would say "vikunja_auth.connect", the provisioning
    // prompt says this instead.
    expect(text).toContain("haven't linked a Vikunja API token");
    expect(text).toContain('vikunja_auth provision');
  });

  it('(c) two different subs concurrently: each error is masked to its OWN sub (ALS integrity)', async () => {
    // Distinct first-4 chars so maskCredential ("abcd...") distinguishes them.
    const tokenA = await mintToken('aaaa-alice-subject');
    const tokenB = await mintToken('bbbb-bob-subject');

    const [resA, resB] = await Promise.all([
      rawRequest(port, {
        headers: bearer(tokenA),
        body: toolCallBody(10, 'vikunja_notifications', { subcommand: 'list' }),
      }),
      rawRequest(port, {
        headers: bearer(tokenB),
        body: toolCallBody(11, 'vikunja_notifications', { subcommand: 'list' }),
      }),
    ]);

    const textA = extractToolResult(resA).content?.map(c => c.text ?? '').join('\n') ?? '';
    const textB = extractToolResult(resB).content?.map(c => c.text ?? '').join('\n') ?? '';

    // Each response carries ITS OWN masked sub, never the other's — no ALS
    // bleed across the two interleaved requests.
    expect(textA).toContain('aaaa...');
    expect(textA).not.toContain('bbbb...');
    expect(textB).toContain('bbbb...');
    expect(textB).not.toContain('aaaa...');
  });
});
