/**
 * Opt-in Streamable HTTP transport bootstrap
 * (docs/OIDC-RESOURCE-SERVER.md §2 "Modes", §3a "Streamable HTTP transport").
 *
 * `stdio` (src/index.ts's existing `StdioServerTransport` path) remains the
 * default and is untouched by this module. `http` mode is opt-in
 * (`transport=http`) and uses the SDK's `StreamableHTTPServerTransport` in
 * **stateless** mode (`sessionIdGenerator: undefined`, decision D5): every
 * request is authenticated and isolated purely from its bearer token, with
 * no MCP-level session keyspace to keep aligned with the OIDC `sub`.
 *
 * This module builds the transport plumbing only. It deliberately does NOT
 * validate bearer tokens itself — that is item H1b (a parallel wave-H1 work
 * item, docs/OIDC-RESOURCE-SERVER.md §3b). Per the spec's deny-mixed-mode
 * rule (§2 "Selection rule": "Any missing → hard startup error (fail loud,
 * never silently downgrade a hosted deployment to no-auth)"),
 * `startHttpTransport` refuses to start whenever no OIDC middleware has been
 * registered via `src/transport/oidcMiddlewareSeam.ts` — see that module's
 * TODO(H1b) for the seam contract H1b implements against.
 */

import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { HttpConfig } from '../config/types';
import { ConfigurationError } from '../config/types';
import { getOidcAuthMiddleware, type HttpRequestWithAuth } from './oidcMiddlewareSeam';
import { logger } from '../utils/logger';

/** Handle returned by `startHttpTransport`, letting callers (and tests) shut the listener down cleanly. */
export interface HttpTransportHandle {
  readonly httpServer: http.Server;
  readonly transport: StreamableHTTPServerTransport;
  close(): Promise<void>;
}

/**
 * Resolve the effective `allowedHosts` list used for the SDK transport's
 * DNS-rebinding protection. When `http.allowedHosts` isn't explicitly
 * configured, defaults to the bind `host:port` pair so the default loopback
 * binding gets working protection out of the box (§3a "Host binding /
 * DNS-rebinding stance").
 */
export function resolveAllowedHosts(httpConfig: HttpConfig): string[] {
  if (httpConfig.allowedHosts && httpConfig.allowedHosts.length > 0) {
    return httpConfig.allowedHosts;
  }
  return [`${httpConfig.host}:${httpConfig.port}`];
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  if (res.headersSent) {
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Start the opt-in Streamable HTTP transport.
 *
 * Throws `ConfigurationError` synchronously (before any listener is opened)
 * when no OIDC authentication middleware is registered — this server must
 * never serve unauthenticated HTTP. Until item H1b lands and registers a
 * middleware via `setOidcAuthMiddleware()`, `http` mode is structurally
 * unable to start; only `transport=stdio` (the default) is supported.
 */
export async function startHttpTransport(
  mcpServer: McpServer,
  httpConfig: HttpConfig
): Promise<HttpTransportHandle> {
  const authMiddleware = getOidcAuthMiddleware();
  if (!authMiddleware) {
    throw new ConfigurationError(
      'transport',
      'transport=http requires the OIDC authentication middleware to be ' +
        'registered (docs/OIDC-RESOURCE-SERVER.md §3b, item H1b). Refusing ' +
        'to start an HTTP listener without it — this server must never ' +
        'serve unauthenticated HTTP (deny-mixed-mode rule, §2 "Selection ' +
        'rule"). Only transport=stdio is supported until that middleware is ' +
        'configured.'
    );
  }

  const allowedHosts = resolveAllowedHosts(httpConfig);

  // Stateless mode (decision D5): `sessionIdGenerator` is deliberately
  // omitted (not set to `undefined`) rather than passed explicitly, to
  // satisfy `exactOptionalPropertyTypes` — omitting the key is
  // functionally identical to the SDK's own "stateless" example, which
  // reads the option as absent either way.
  const transport = new StreamableHTTPServerTransport({
    enableDnsRebindingProtection: true,
    allowedHosts,
  });

  // Cast through `Transport`: the SDK's own `StreamableHTTPServerTransport`
  // does not perfectly satisfy its own `Transport` interface under
  // `exactOptionalPropertyTypes: true` (its `onclose`/`onerror`/`onmessage`
  // setters accept `| undefined`, which the interface's optional properties
  // disallow under this compiler flag) — a pre-existing SDK type quirk, not
  // a functional mismatch; see other `as unknown as` casts in this codebase
  // for the same `exactOptionalPropertyTypes` accommodation pattern.
  await mcpServer.connect(transport as unknown as Transport);

  const requestPath = httpConfig.path;

  const httpServer = http.createServer((req, res) => {
    handleIncomingRequest(req, res, transport, authMiddleware, requestPath).catch(error => {
      logger.error('Unhandled error while handling HTTP MCP request:', error);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    httpServer.once('error', onError);
    httpServer.listen(httpConfig.port, httpConfig.host, () => {
      httpServer.removeListener('error', onError);
      resolve();
    });
  });

  logger.info(
    `Vikunja MCP HTTP transport listening on ${httpConfig.host}:${httpConfig.port}${requestPath}`
  );

  return {
    httpServer,
    transport,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close(error => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await transport.close();
    },
  };
}

async function handleIncomingRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  transport: StreamableHTTPServerTransport,
  authMiddleware: NonNullable<ReturnType<typeof getOidcAuthMiddleware>>,
  requestPath: string
): Promise<void> {
  const rawUrl = req.url ?? '/';
  const pathname = rawUrl.split('?')[0];

  // Health/readiness sit outside the MCP path and the JWT middleware
  // entirely (§3a "Health/readiness") — liveness never touches the vault or
  // Vikunja, so it stays reachable even for an unauthenticated caller.
  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (req.method === 'GET' && pathname === '/readyz') {
    // TODO(H1b/H2): extend with JWKS reachability + vault-file-openable
    // checks once those components exist (§3a "Health/readiness" describes
    // the full contract; neither the JWT middleware nor the vault exist
    // yet in this item's scope).
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname !== requestPath) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  let authorized: boolean;
  try {
    authorized = await authMiddleware(req as HttpRequestWithAuth, res);
  } catch (error) {
    logger.warn('OIDC authentication middleware threw unexpectedly:', error);
    sendJson(res, 401, { error: 'invalid_token' });
    return;
  }

  if (!authorized) {
    // Middleware already wrote the 401/403 response; nothing more to do.
    return;
  }

  await transport.handleRequest(req as HttpRequestWithAuth, res);
}
