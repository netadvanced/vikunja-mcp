#!/usr/bin/env node

/**
 * Vikunja MCP Server
 * Main entry point for the Model Context Protocol server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { AuthManager } from './auth/AuthManager';
import { registerTools } from './tools';
import { logger } from './utils/logger';
import { createSecureConnectionMessage, createSecureLogConfig } from './utils/security';
import { createVikunjaClientFactory, setGlobalClientFactory, type VikunjaClientFactory } from './client';
import { readSecretEnv } from './config/secrets';
import { ConfigurationManager } from './config/ConfigurationManager';
import { startHttpTransport } from './transport/httpTransport';
import { setupOidcHttpAuth } from './transport/oidcHttpAuth';

dotenv.config({ quiet: true });

const server = new McpServer({
  name: 'vikunja-mcp-ng',
  version: '0.3.0',
});

const authManager = new AuthManager();

let clientFactory: VikunjaClientFactory | null = null;

async function initializeFactory(): Promise<void> {
  try {
    clientFactory = await createVikunjaClientFactory(authManager);
    if (clientFactory) {
      await setGlobalClientFactory(clientFactory);
    }
  } catch (error) {
    logger.warn('Failed to initialize client factory during startup:', error);
    // Factory will be initialized on first authentication
  }
}

// Initialize factory during module load for both production and test environments
// This ensures the factory is available for tests
export const factoryInitializationPromise = initializeFactory()
  .then(() => {
    try {
      if (clientFactory) {
        registerTools(server, authManager, clientFactory);
      } else {
        registerTools(server, authManager, undefined);
      }
    } catch (error) {
      logger.error('Failed to initialize:', error);
      // Fall back to legacy registration for backwards compatibility
      registerTools(server, authManager, undefined);
    }
  })
  .catch((error) => {
    logger.warn('Failed to initialize client factory during module load:', error);
    registerTools(server, authManager, undefined);
  });

// Resolve VIKUNJA_API_TOKEN, honoring the VIKUNJA_API_TOKEN_FILE Docker-secrets
// convention. Setting both the plain variable and its _FILE variant is a hard
// startup error (see src/config/secrets.ts) rather than a silent precedence choice.
let vikunjaApiToken: string | undefined;
try {
  vikunjaApiToken = readSecretEnv('VIKUNJA_API_TOKEN');
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (process.env.VIKUNJA_URL && vikunjaApiToken) {
  const connectionMessage = createSecureConnectionMessage(
    process.env.VIKUNJA_URL,
    vikunjaApiToken
  );
  logger.info(`Auto-authenticating: ${connectionMessage}`);
  authManager.connect(process.env.VIKUNJA_URL, vikunjaApiToken);
  const detectedAuthType = authManager.getAuthType();
  logger.info(`Using detected auth type: ${detectedAuthType}`);
}

/**
 * Transport mode selection (docs/OIDC-RESOURCE-SERVER.md §2 "Modes").
 *
 * `stdio` is the default and MUST remain byte-for-byte behaviorally
 * unchanged — this is the epic's hard invariant (see
 * tests/index.test.ts's "stdio transport invariant" suite). By the time
 * `main()` runs, `factoryInitializationPromise` has already resolved, and
 * `registerTools()` (called from within it) has already loaded and cached
 * the application config via `ConfigurationManager.loadConfiguration()`
 * (see `resolveModulesConfig()` in `src/tools/index.ts`) — so calling
 * `loadConfiguration()` again here is a cache hit with no additional side
 * effects (no repeated "Configuration loaded successfully" log) in the
 * default, happy-path case.
 *
 * `http` mode is new and opt-in (`transport=http` / `VIKUNJA_MCP_TRANSPORT`)
 * and starts the Streamable HTTP transport instead of stdio — see
 * `src/transport/httpTransport.ts`. Without the OIDC middleware seam
 * registered (item H1b, parallel), it refuses to start rather than serve
 * unauthenticated HTTP.
 */
async function main(): Promise<void> {
  await factoryInitializationPromise;

  const appConfig = ConfigurationManager.getInstance().loadConfiguration();

  if (appConfig.transport === 'http') {
    // Build and register the OIDC JWT-validation middleware on the transport
    // auth seam BEFORE starting the listener (docs/OIDC-RESOURCE-SERVER.md
    // §3b). When no `oidc` config is present we deliberately skip this — and
    // `startHttpTransport` then refuses to start rather than serve
    // unauthenticated HTTP (deny-mixed-mode, §2 "Selection rule").
    if (appConfig.oidc) {
      await setupOidcHttpAuth(appConfig.oidc, appConfig.vault);
    }
    // Stateless HTTP mode builds a fresh, fully-registered `McpServer` per
    // request (the SDK's stateless transport cannot be reused across
    // requests; a shared server cannot back concurrent per-request
    // transports — see src/transport/httpTransport.ts). The module-level
    // `server` above stays the stdio-mode server and is left unconnected here.
    await startHttpTransport(() => {
      const requestServer = new McpServer({ name: 'vikunja-mcp-ng', version: '0.3.0' });
      registerTools(requestServer, authManager, clientFactory ?? undefined);
      return requestServer;
    }, appConfig.http);
    logger.info('Vikunja MCP server started (http transport)');
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Vikunja MCP server started');

  const config = createSecureLogConfig({
    mode: process.env.MCP_MODE,
    debug: process.env.DEBUG,
    hasAuth: !!process.env.VIKUNJA_URL && !!vikunjaApiToken,
    url: process.env.VIKUNJA_URL,
    token: vikunjaApiToken,
  });

  logger.debug('Configuration loaded', config);
}

// Exported for direct invocation in tests (mode selection, refuse-to-start,
// and the stdio invariant regression tests — see tests/index.test.ts). Not
// otherwise part of this module's public API.
export { main };

// Only start the server if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  main().catch((error) => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

// Essential exports only - eliminated 80+ lines of unnecessary barrel exports
// Use direct imports instead of centralized re-exports for better tree-shaking

// Core types that are commonly imported by external code
export { MCPError, ErrorCode } from './types/errors';
export type { TaskResponseData, FilterExpression, Task } from './types';
export type { ParseResult } from './types/filters';
export type { AorpBuilderConfig, AorpFactoryResult } from './types';

// Core utilities that are widely used across the codebase
export { logger } from './utils/logger';
export { isAuthenticationError } from './utils/auth-error-handler';
export { withRetry, RETRY_CONFIG } from './utils/retry';
export { transformApiError, handleFetchError, handleStatusCodeError } from './utils/error-handler';
export { parseFilterString } from './utils/filters';
export { validateTaskCountLimit } from './utils/memory';
export { createStandardResponse, createAorpErrorResponse as createErrorResponse } from './utils/response-factory';

// Additional exports for task modules
export type { SimpleResponse } from './utils/simple-response';

// Session utilities for external usage
export { getAuthManagerFromContext, clearGlobalClientFactory } from './client';
