/**
 * Opt-in Streamable HTTP transport bootstrap
 * (docs/OIDC-RESOURCE-SERVER.md §2 "Modes", §3a "Streamable HTTP transport").
 *
 * `stdio` (src/index.ts's existing `StdioServerTransport` path) remains the
 * default and is untouched by this module. `http` mode is opt-in
 * (`transport=http`) and uses the SDK's `StreamableHTTPServerTransport` in
 * **stateless** mode (`sessionIdGenerator` omitted, decision D5): every
 * request is authenticated and isolated purely from its bearer token, with
 * no MCP-level session keyspace to keep aligned with the OIDC `sub`.
 *
 * A fresh `StreamableHTTPServerTransport` **and** a fresh `McpServer` are
 * built per request (via the injected `createMcpServer` factory) and torn
 * down when the response finishes. This is the SDK's required stateless
 * usage: `@modelcontextprotocol/sdk`'s stateless transport refuses to be
 * reused across requests ("Stateless transport cannot be reused across
 * requests. Create a new transport per request." — it would otherwise leak
 * message-id/response state between two different callers), and a single
 * shared `McpServer` cannot back concurrent per-request transports because
 * `server.connect()` binds exactly one transport at a time. Per-request
 * construction is what makes genuinely concurrent, per-identity-isolated
 * requests correct (§3d ALS context-integrity property).
 *
 * This module builds the transport plumbing only; it does NOT validate bearer
 * tokens itself — that is the OIDC middleware registered on
 * `src/transport/oidcMiddlewareSeam.ts` (item H1b, wired in via
 * src/transport/oidcHttpAuth.ts). Per the spec's deny-mixed-mode rule (§2
 * "Selection rule": "Any missing → hard startup error"), `startHttpTransport`
 * refuses to start whenever no OIDC middleware has been registered — never
 * serve unauthenticated HTTP.
 */

import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { HttpConfig } from '../config/types';
import { ConfigurationError } from '../config/types';
import { getOidcAuthMiddleware, type HttpRequestWithAuth } from './oidcMiddlewareSeam';
import { runWithRequestContext, takeAttachedRequestContext } from '../context/requestContext';
import { logger } from '../utils/logger';

/**
 * Builds a fully-registered `McpServer` for a single request. Called once per
 * MCP request (stateless mode requires a fresh server + transport per call);
 * production passes a factory that runs `registerTools` against the process's
 * `AuthManager`/`VikunjaClientFactory` (see `src/index.ts`).
 */
export type McpServerFactory = () => McpServer | Promise<McpServer>;

/** Handle returned by `startHttpTransport`, letting callers (and tests) shut the listener down cleanly. */
export interface HttpTransportHandle {
  readonly httpServer: http.Server;
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
 * never serve unauthenticated HTTP. Until an OIDC middleware is registered
 * via `setOidcAuthMiddleware()` (src/transport/oidcHttpAuth.ts), `http` mode
 * is structurally unable to start; only `transport=stdio` (the default) is
 * supported.
 */
export async function startHttpTransport(
  createMcpServer: McpServerFactory,
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
  const requestPath = httpConfig.path;

  const httpServer = http.createServer((req, res) => {
    handleIncomingRequest(req, res, {
      createMcpServer,
      allowedHosts,
      authMiddleware,
      requestPath,
    }).catch(error => {
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
    },
  };
}

interface RequestHandlerContext {
  createMcpServer: McpServerFactory;
  allowedHosts: string[];
  authMiddleware: NonNullable<ReturnType<typeof getOidcAuthMiddleware>>;
  requestPath: string;
}

async function handleIncomingRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RequestHandlerContext
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
    // TODO(H2): extend with JWKS reachability + vault-file-openable checks
    // once the vault exists (§3a "Health/readiness" describes the full
    // contract).
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname !== ctx.requestPath) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  let authorized: boolean;
  try {
    authorized = await ctx.authMiddleware(req as HttpRequestWithAuth, res);
  } catch (error) {
    logger.warn('OIDC authentication middleware threw unexpectedly:', error);
    sendJson(res, 401, { error: 'invalid_token' });
    return;
  }

  if (!authorized) {
    // Middleware already wrote the 401/403 response; nothing more to do.
    return;
  }

  // Fresh transport + server per request (stateless mode requires it — see
  // the module header). `sessionIdGenerator` is deliberately omitted (not
  // set to `undefined`) to satisfy `exactOptionalPropertyTypes`.
  const transport = new StreamableHTTPServerTransport({
    enableDnsRebindingProtection: true,
    allowedHosts: ctx.allowedHosts,
  });
  const mcpServer = await ctx.createMcpServer();

  try {
    // Cast through `Transport`: the SDK's own `StreamableHTTPServerTransport`
    // does not perfectly satisfy its own `Transport` interface under
    // `exactOptionalPropertyTypes: true` — a pre-existing SDK type quirk, not
    // a functional mismatch (see other `as unknown as` casts in this codebase
    // for the same accommodation pattern).
    await mcpServer.connect(transport as unknown as Transport);

    // If the auth middleware attached a per-identity `RequestContext` (the
    // OIDC HTTP-auth middleware does — src/transport/oidcHttpAuth.ts), open
    // the ALS scope around `handleRequest` so every tool call, and every
    // await it spawns, resolves credentials/rate-limit/storage keys for
    // *this* caller (docs/OIDC-RESOURCE-SERVER.md §3d, D6). The seam's
    // boolean-returning middleware cannot hold the scope open itself — it
    // returns before this point — so the scope is opened here, the one place
    // that actually drives `handleRequest`. A middleware that attaches
    // nothing (a generic seam, or a test stub) runs with no scope, exactly as
    // before — keeping the seam transport-agnostic.
    const requestContext = takeAttachedRequestContext(req);
    if (requestContext) {
      await runWithRequestContext(requestContext, () =>
        transport.handleRequest(req as HttpRequestWithAuth, res)
      );
    } else {
      await transport.handleRequest(req as HttpRequestWithAuth, res);
    }
  } finally {
    // Tear down this request's transport + server. `handleRequest` has
    // already fully written the response (including any SSE stream) by the
    // time it resolves, so closing here never truncates a reply.
    await transport.close().catch(() => undefined);
    await mcpServer.close().catch(() => undefined);
  }
}
