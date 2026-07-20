/**
 * Tests for the opt-in Streamable HTTP transport bootstrap
 * (src/transport/httpTransport.ts).
 *
 * These are deliberately near-integration tests: a real `McpServer`, a real
 * SDK `StreamableHTTPServerTransport`, and a real `http.Server` bound to an
 * OS-assigned loopback port (port 0). This is the most faithful way to
 * verify the refuse-to-start gate, the health endpoints, the auth-seam
 * routing, and DNS-rebinding Host-header protection actually behave as
 * specified (docs/OIDC-RESOURCE-SERVER.md §3a) rather than merely mocking
 * past them.
 */

import * as http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  startHttpTransport,
  resolveAllowedHosts,
  type HttpTransportHandle,
} from '../../src/transport/httpTransport';
import { setOidcAuthMiddleware, type HttpRequestWithAuth } from '../../src/transport/oidcMiddlewareSeam';
import { ConfigurationError } from '../../src/config/types';
import type { HttpConfig } from '../../src/config/types';

// Fixed, incrementing ports rather than OS-assigned port 0: the default
// `allowedHosts` derivation (`resolveAllowedHosts`) is `host:port` from
// *configured* port, so a real client's Host header must match it exactly.
// A deterministic port keeps that match correct without a listen-then-relisten
// dance to discover an OS-assigned port ahead of construction time.
let nextTestPort = 19870;
function allocatePort(): number {
  return nextTestPort++;
}

function baseHttpConfig(overrides: Partial<HttpConfig> = {}): HttpConfig {
  return {
    host: '127.0.0.1',
    port: allocatePort(),
    path: '/mcp',
    ...overrides,
  };
}

function newServer(): McpServer {
  return new McpServer({ name: 'test-server', version: '0.0.0' });
}

function getPort(handle: HttpTransportHandle): number {
  const address = handle.httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an AddressInfo (TCP) address');
  }
  return address.port;
}

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/mcp',
        headers: options.headers,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('httpTransport', () => {
  afterEach(() => {
    setOidcAuthMiddleware(undefined);
  });

  describe('resolveAllowedHosts', () => {
    it('defaults to the bind host:port pair when unconfigured', () => {
      expect(resolveAllowedHosts(baseHttpConfig({ host: '127.0.0.1', port: 8765 }))).toEqual([
        '127.0.0.1:8765',
      ]);
    });

    it('uses the explicitly configured allowedHosts list', () => {
      expect(
        resolveAllowedHosts(baseHttpConfig({ allowedHosts: ['gateway.example.org:8765'] }))
      ).toEqual(['gateway.example.org:8765']);
    });

    it('falls back to the default when allowedHosts is an empty array', () => {
      expect(resolveAllowedHosts(baseHttpConfig({ host: '0.0.0.0', port: 9000, allowedHosts: [] }))).toEqual([
        '0.0.0.0:9000',
      ]);
    });
  });

  describe('refuse-to-start (deny-mixed-mode rule)', () => {
    it('refuses to start when no OIDC middleware is registered', async () => {
      const mcpServer = newServer();

      await expect(startHttpTransport(mcpServer, baseHttpConfig())).rejects.toThrow(ConfigurationError);
    });

    it('the refusal error references the OIDC middleware requirement and H1b', async () => {
      const mcpServer = newServer();

      await expect(startHttpTransport(mcpServer, baseHttpConfig())).rejects.toThrow(
        /OIDC authentication middleware/i
      );
    });

    it('does not open a TCP listener when refusing to start', async () => {
      const mcpServer = newServer();
      const listenSpy = jest.spyOn(http.Server.prototype, 'listen');

      await expect(startHttpTransport(mcpServer, baseHttpConfig())).rejects.toThrow();
      expect(listenSpy).not.toHaveBeenCalled();

      listenSpy.mockRestore();
    });
  });

  describe('with OIDC middleware registered', () => {
    let handle: HttpTransportHandle;

    afterEach(async () => {
      if (handle) {
        await handle.close();
      }
    });

    it('starts and serves /healthz unauthenticated even when the middleware would reject', async () => {
      setOidcAuthMiddleware(async () => false);
      handle = await startHttpTransport(newServer(), baseHttpConfig());
      const port = getPort(handle);

      const res = await request(port, { path: '/healthz' });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });

    it('starts and serves /readyz unauthenticated even when the middleware would reject', async () => {
      setOidcAuthMiddleware(async () => false);
      handle = await startHttpTransport(newServer(), baseHttpConfig());
      const port = getPort(handle);

      const res = await request(port, { path: '/readyz' });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    });

    it('404s on a path other than the configured MCP path', async () => {
      setOidcAuthMiddleware(async () => true);
      handle = await startHttpTransport(newServer(), baseHttpConfig());
      const port = getPort(handle);

      const res = await request(port, { path: '/not-mcp' });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: 'not_found' });
    });

    it('routes an authorized request through to the real SDK transport', async () => {
      let sawAuth: HttpRequestWithAuth['auth'];
      setOidcAuthMiddleware(async req => {
        req.auth = { token: 'x', clientId: 'test-client', scopes: [] };
        sawAuth = req.auth;
        return true;
      });
      handle = await startHttpTransport(newServer(), baseHttpConfig());
      const port = getPort(handle);

      // Deliberately malformed JSON: proves the request reached the real
      // transport (which returns a JSON-RPC parse-error 400), rather than
      // being intercepted by the auth seam (401) or the path router (404).
      const res = await request(port, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: '{not valid json',
      });

      expect(res.statusCode).toBe(400);
      expect(sawAuth).toEqual({ token: 'x', clientId: 'test-client', scopes: [] });
    });

    it('does not invoke the transport when the middleware already responded (returns false)', async () => {
      setOidcAuthMiddleware(async (_req, res) => {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'custom_forbidden' }));
        return false;
      });
      handle = await startHttpTransport(newServer(), baseHttpConfig());
      const port = getPort(handle);

      const res = await request(port, { method: 'POST' });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ error: 'custom_forbidden' });
    });

    it('returns 401 invalid_token when the middleware throws', async () => {
      setOidcAuthMiddleware(async () => {
        throw new Error('boom');
      });
      handle = await startHttpTransport(newServer(), baseHttpConfig());
      const port = getPort(handle);

      const res = await request(port, { method: 'POST' });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: 'invalid_token' });
    });

    it('rejects a request with a Host header outside allowedHosts (DNS-rebinding protection)', async () => {
      setOidcAuthMiddleware(async () => true);
      handle = await startHttpTransport(
        newServer(),
        baseHttpConfig({ allowedHosts: ['127.0.0.1:1'] }) // intentionally wrong port
      );
      const port = getPort(handle);

      const res = await request(port, {
        method: 'POST',
        headers: { Host: `evil.example.com:${port}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('close() shuts the listener down', async () => {
      setOidcAuthMiddleware(async () => true);
      handle = await startHttpTransport(newServer(), baseHttpConfig());

      expect(handle.httpServer.listening).toBe(true);
      await handle.close();
      expect(handle.httpServer.listening).toBe(false);

      // Prevent the afterEach hook from closing an already-closed server.
      handle = undefined as unknown as HttpTransportHandle;
    });
  });
});
