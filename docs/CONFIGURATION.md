# Configuration Management

## Overview

The Vikunja MCP server uses a centralized configuration system that replaces scattered `process.env` usage with type-safe, validated configuration management. This system addresses TD-002 (Environment Variable Sprawl) by consolidating 33 environment variables into a unified architecture.

## Quick Start

### Basic Usage

```typescript
import { getConfiguration, getAuthConfig, getRateLimitConfig } from './config';

// Get complete configuration
const config = await getConfiguration();

// Get specific sections
const authConfig = await getAuthConfig();
const rateLimiting = await getRateLimitConfig();

// Check feature flags
const isEnabled = await isFeatureEnabled('enableServerSideFiltering');
```

### Environment Setup

1. Copy `.env.example` to `.env`
2. Configure your Vikunja connection:
   ```env
   VIKUNJA_URL=https://your-vikunja-instance.com
   VIKUNJA_API_TOKEN=your-api-token-here
   ```
3. Set your environment:
   ```env
   NODE_ENV=development  # or test, production
   ```

## Configuration Architecture

### Configuration Sections

The configuration is organized into four main sections:

#### 1. Authentication (`AuthConfig`)
```typescript
interface AuthConfig {
  vikunjaUrl?: string;     // Vikunja server URL
  vikunjaToken?: string;   // API or JWT token
  mcpMode?: string;        // MCP server mode
}
```

#### 2. Logging (`LoggingConfig`)
```typescript
interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  debug: boolean;
  environment: Environment;
}
```

#### 3. Rate Limiting (`RateLimitConfig`)
```typescript
interface RateLimitConfig {
  enabled: boolean;
  default: RateLimitSettings;    // Standard tools
  expensive: RateLimitSettings;  // Resource-intensive operations
  bulk: RateLimitSettings;       // Batch operations
  export: RateLimitSettings;     // Export operations
}

interface RateLimitSettings {
  requestsPerMinute: number;
  requestsPerHour: number;
  maxRequestSize: number;
  maxResponseSize: number;
  executionTimeout: number;
}
```

#### 4. Feature Flags (`FeatureFlagsConfig`)
```typescript
interface FeatureFlagsConfig {
  enableServerSideFiltering: boolean;
  enableAdvancedMetrics: boolean;
  enableExperimentalFeatures: boolean;
}
```

#### 5. Templates (`TemplatesConfig`)
```typescript
interface TemplatesConfig {
  persistPath?: string;   // File-backed persistence — see Templates Persistence below
}
```

### Environment Profiles

The system automatically applies environment-specific defaults:

#### Development Profile
- **Logging**: Debug level, verbose output
- **Rate Limiting**: Disabled for easier testing
- **Features**: Experimental features enabled

#### Test Profile
- **Logging**: Error level only to reduce noise
- **Rate Limiting**: Disabled for test performance
- **Features**: Conservative settings for consistent behavior

#### Production Profile
- **Logging**: Info level for operational visibility
- **Rate Limiting**: Full protection enabled
- **Features**: Only stable features enabled

## Configuration Priority

Configuration values are resolved in the following priority order (highest to lowest):

1. **Programmatic Sources** - Direct configuration objects (used by tests / embedders)
2. **Environment Variables** - System environment variables — **always win over the config file**
3. **Config File** - Optional `vikunja-mcp.config.json` (see [Config File](#config-file) below)
4. **Environment Profiles** - Dev/test/production defaults
5. **Schema Defaults** - Fallback values defined in schema

## Config File

Non-sensitive configuration can be layered in from an optional JSON file. It is safe to
commit, safe to mount read-only into a container (e.g. as a Docker `config`), and is
**never** the place for secrets — see [Secrets Management](#secrets-management).

- **Default path**: `vikunja-mcp.config.json` in the process's current working directory.
  If it doesn't exist, it is silently skipped — the file is entirely optional.
- **Override path**: set `VIKUNJA_MCP_CONFIG=/path/to/file.json`. When this variable is
  set explicitly, a missing or unreadable file is a **hard startup error** (fail fast) —
  an explicit path that can't be read is assumed to be a misconfiguration, not something
  to silently ignore.
- **Malformed file**: invalid JSON, or JSON whose top-level value isn't an object, is
  always a hard startup error with a message naming the file path and the parse problem —
  regardless of whether the path was explicit or the default.
- **Shape**: the file mirrors `ApplicationConfig` — any of `auth` (non-secret fields
  only), `logging`, `rateLimiting`, `featureFlags`, `modules`, `templates` may be
  present; anything omitted falls back to the environment profile / schema default.

Example `vikunja-mcp.config.json`:

```json
{
  "modules": {
    "webhooks": false,
    "batchImport": { "enabled": true }
  },
  "logging": {
    "level": "info"
  },
  "readOnly": false
}
```

## Module Gating

Each Vikunja entity's tools live behind a **module** toggle, resolved once at
tool-registration time (`registerTools` in `src/tools/index.ts`). A disabled module's
tools are never registered with the MCP server — they are invisible to the client, not
merely rejected at call time.

### Module Config Shape

A module's value is a plain boolean today, but the object form is accepted so
per-subcommand granularity can be added later **without a breaking change**:

```json
{ "modules": { "tasks": false } }
```

```json
{ "modules": { "tasks": { "enabled": true } } }
```

The object form already tolerates (and ignores, for now) extra boolean keys, so a future
release can start honoring `{"tasks": {"enabled": true, "delete": false}}` without
requiring any config migration.

### Known Modules

| Module | Default | Notes |
|---|---|---|
| `tasks` | **ON** | Gates the entire task tool family (CRUD, bulk, assignees, comments, reminders, labels, relations) together |
| `projects` | **ON** | |
| `labels` | **ON** | |
| `teams` | **ON** | |
| `users` | **ON** | Also requires JWT authentication — see [Composing with Auth-Type Gating](#composing-with-auth-type-gating) |
| `webhooks` | **ON** | |
| `filters` | **ON** | |
| `templates` | **ON** | |
| `export` | **ON** | Also requires JWT authentication |
| `batchImport` | **ON** | |
| `notifications` | **ON** | Gates `vikunja_notifications` |
| `subscriptions` | **ON** | Gates `vikunja_subscriptions` |
| `reactions` | **ON** | Gates `vikunja_reactions` |
| `admin` | **OFF** ⚠️ | Gates `vikunja_admin` (instance-admin operations: overview, all-projects listing + owner reassignment, user list/create/delete, admin-flag + status toggles). Deny-by-default AND JWT-only — see [Composing with Auth-Type Gating](#composing-with-auth-type-gating). `delete-user` additionally requires an explicit `confirm: true` tool argument. |
| `userDeletion` | **OFF** (reserved) | No tool implements this yet. Deny-by-default — destructive. |
| `tokenManagement` | **OFF** ⚠️ | Gates `vikunja_tokens` (API token list/create/delete for the connected account). Deny-by-default — credential-adjacent. No auth-type restriction at registration time (unlike `admin`/`users`/`export`), but the underlying `/tokens` endpoints may reject API-token sessions server-side — see `src/tools/tokens.ts`. |

Ordinary modules default **ON** (matching pre-existing behavior — this system is
additive, not a breaking change). The three reserved "dangerous" modules default **OFF**
(deny-by-default): `admin` and `tokenManagement` now have tools wired to them and ship
already gated closed until an operator opts in; `userDeletion` remains fully reserved
(no tool yet) for the same reason.

### Module Env Var Overrides

Each module has a matching boolean-only env var override (env vars carry the boolean
shorthand only — the object form with future per-subcommand keys is a config-file-only
feature):

```env
VIKUNJA_MCP_MODULE_TASKS=true
VIKUNJA_MCP_MODULE_PROJECTS=true
VIKUNJA_MCP_MODULE_LABELS=true
VIKUNJA_MCP_MODULE_TEAMS=true
VIKUNJA_MCP_MODULE_USERS=true
VIKUNJA_MCP_MODULE_WEBHOOKS=true
VIKUNJA_MCP_MODULE_FILTERS=true
VIKUNJA_MCP_MODULE_TEMPLATES=true
VIKUNJA_MCP_MODULE_EXPORT=true
VIKUNJA_MCP_MODULE_BATCH_IMPORT=true
VIKUNJA_MCP_MODULE_NOTIFICATIONS=true
VIKUNJA_MCP_MODULE_SUBSCRIPTIONS=true
VIKUNJA_MCP_MODULE_REACTIONS=true

# Reserved / dangerous — deny-by-default
VIKUNJA_MCP_MODULE_ADMIN=false
VIKUNJA_MCP_MODULE_USER_DELETION=false
VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT=false
```

As with every other setting, these env vars always win over the config file.

### Composing with Auth-Type Gating

Module config can only **narrow** what authentication already allows — it can never
**expand** it. The `users` and `export` tools have always required JWT authentication
(API-token auth excludes them for backward compatibility); `admin` composes with the
same JWT-only gate. Module gating is applied *in addition to*, never instead of, that
check:

```typescript
const jwtAuthenticated = authManager.isAuthenticated() && authManager.getAuthType() === 'jwt';
if (jwtAuthenticated && isModuleEnabled(modules.users)) {
  registerUsersTool(server, authManager, clientFactory);
}
// ... and further down:
if (jwtAuthenticated && isModuleEnabled(modules.admin)) {
  registerAdminTool(server, authManager, clientFactory);
}
```

Setting `VIKUNJA_MCP_MODULE_USERS=true` while authenticated with an API token does
**not** register the users tool — there is no config setting that can grant access auth
doesn't already permit. The same is true of `VIKUNJA_MCP_MODULE_ADMIN=true`: with an
API-token session, `vikunja_admin` stays unregistered regardless of the config value.
`tokenManagement` is the one deny-by-default module that does **not** compose with the
JWT-only gate — `vikunja_tokens` registers for either session type once its module key
is enabled, since the underlying endpoints' auth requirement is a runtime server
behavior rather than something this server enforces at registration time.

## Global Read-Only Safety Mode

A separate, orthogonal safety layer from module gating: instead of hiding a tool from the
MCP client entirely (module gating), read-only mode keeps every tool **visible and
registered**, but rejects any subcommand that writes or destroys data on the connected
Vikunja instance — read subcommands (`list`, `get`, `status`, ...) keep working normally.
This is useful for a read-only "explore my tasks" session, a demo environment, or any
deployment where an operator wants to guarantee an AI assistant cannot mutate data no
matter what a tool call asks for.

- **Config file key**: `readOnly` (boolean, default `false`) at the top level of
  `vikunja-mcp.config.json` — a peer of `modules`/`logging`/etc., not nested under either.
- **Env override**: `VIKUNJA_MCP_READ_ONLY` (boolean shorthand, `true`/`false`) — as with
  every other setting, the env var always wins over the config file.

```json
{ "readOnly": true }
```

```env
VIKUNJA_MCP_READ_ONLY=true
```

### What gets rejected

Rejection happens at dispatch, inside each tool's handler, via a single shared guard
(`assertWriteAllowed` in `src/utils/read-only.ts`) that every tool dispatcher calls once,
right after its existing auth check — not 24 copy-pasted `if (readOnly)` checks. The guard
consults one classification table per tool (`subcommand -> read | write | destructive`),
built from the actual Vikunja API semantics of each subcommand (see the module's doc
comment for the full rubric and the rationale behind edge cases like the dual-purpose
`comment` subcommand, `vikunja_batch_import`'s `dryRun`, and the fully-exempt
`vikunja_auth` tool). A rejected call fails with a consistent, clearly-worded error:

```
server is in read-only mode: 'vikunja_tasks' subcommand 'delete' is a destructive
operation and is rejected. Set 'readOnly' to false in vikunja-mcp.config.json
(or unset VIKUNJA_MCP_READ_ONLY) to allow writes.
```

Notes on scope:

- **`vikunja_auth`** (`connect`/`status`/`refresh`/`disconnect`/`info`) is entirely exempt
  — those subcommands only manage the MCP server's local session, never a Vikunja
  resource, so read-only mode never blocks them.
- **Dynamic classification**: a small number of subcommands classify themselves based on
  the actual call arguments rather than a fixed table entry — `vikunja_tasks`'/
  `vikunja_task_comments`' dual-purpose `comment` subcommand (creates when text is
  supplied, otherwise lists — classified `read` only when no comment text is given) and
  `vikunja_batch_import` (classified `read` only when `dryRun: true`, since a dry run
  never writes).
- Module gating and read-only mode compose independently: a module disabled entirely
  (§ Module Gating above) is invisible regardless of `readOnly`; a module left enabled
  under `readOnly: true` stays visible but write/destructive calls into it are rejected.

### MCP Tool Annotations

The same per-tool classification tables drive the MCP SDK's `ToolAnnotations`
(`readOnlyHint` / `destructiveHint` / `idempotentHint`), registered alongside every tool's
schema so MCP clients can render tool cards accurately and apply their own consent/
confirmation UX for destructive calls. Because a single MCP tool name here fans out to
several subcommands with different semantics, the tool-level hints are derived
conservatively:

- `readOnlyHint` is `true` only when **every** subcommand on that tool is classified
  `read` (today: `vikunja_auth` and `vikunja_export_project`).
- `destructiveHint` is `true` when **any** subcommand is classified `destructive` (true
  for nearly every CRUD-shaped tool, since almost all of them expose a `delete`-shaped
  operation).
- `idempotentHint` is set `true` only for tools on an explicit, hand-reviewed allowlist
  where every non-read subcommand is genuinely idempotent — currently just
  `vikunja_notifications` (`mark-read`/`mark-all-read` are ensure-semantics: marking an
  already-read notification as read again is a no-op). It is intentionally *not* inferred
  automatically from the read/write/destructive table, since idempotency is a semantic
  judgment call the three-way classification doesn't capture (e.g. `vikunja_teams`'
  `members:toggleAdmin` is a `write`, not a `delete`, but explicitly is **not**
  idempotent — it flips a flag rather than setting it).

## Templates Persistence

`vikunja_templates` templates are **session-only by default**: they live in the same
in-memory `SimpleFilterStorage` as saved filters, scoped to the connected session, and
are lost when the server process restarts. Set a persist path to make them durable
across restarts.

- **Config key**: `templates.persistPath` in `vikunja-mcp.config.json`.
- **Env var**: `VIKUNJA_MCP_TEMPLATES_FILE=/path/to/templates.json` — **wins over the
  config file**, same precedence as every other setting (see
  [Configuration Priority](#configuration-priority)).
- **Unset (default)**: templates stay in-memory only — behavior is byte-identical to
  before this feature existed.
- **Set**: the file is loaded once, tolerantly, the first time `vikunja_templates` is
  used after startup — a missing file (first run / fresh volume) or a corrupt/malformed
  file both fall back to an empty template set (logged as a warning for the corrupt
  case), **never** a crash. Every `create` / `update` / `delete` mutation then
  write-throughs the full current template set back to the file, **atomically**: written
  to a temp file in the same directory, then renamed over the target, so a reader never
  observes a half-written file and a crash mid-write can't corrupt the previous good
  state. The parent directory is created automatically if it doesn't exist yet.

This is intentionally a plain JSON file, not a database — SQLite was evaluated for this
work item and parked (native-dependency cost outweighs the need for a single opt-in
file; see `docs/ROADMAP.md`). The path is a single file, which makes it trivial to mount
as a Docker volume:

```yaml
services:
  vikunja-mcp:
    image: ghcr.io/netadvanced/vikunja-mcp-ng:latest
    environment:
      VIKUNJA_URL: "https://vikunja.example.com/api/v1"
      VIKUNJA_API_TOKEN_FILE: /run/secrets/vikunja_api_token
      VIKUNJA_MCP_TEMPLATES_FILE: /data/templates.json
    volumes:
      - vikunja-mcp-templates:/data
    secrets:
      - source: vikunja_api_token
        target: vikunja_api_token
        mode: 0400

volumes:
  vikunja-mcp-templates:

secrets:
  vikunja_api_token:
    file: ./secrets/vikunja_api_token.txt
```

Or via the config file instead of the env var:

```json
{
  "templates": {
    "persistPath": "/data/templates.json"
  }
}
```

The template file contains no credentials — it's a plain JSON array of template
definitions (project/task shape, no auth data) — so, like the rest of the config file, it
doesn't need Docker-secrets treatment; only the volume itself needs to persist across
container recreations.

## Secrets Management

**The config file is for non-sensitive settings only.** It's designed to be safe to
commit to source control and safe to mount as a read-only Docker/Swarm `config` — so
credentials must never be written into it. Secrets belong in environment variables.

### The `*_FILE` Convention

Every sensitive environment variable also accepts a `<NAME>_FILE` variant that names a
file whose contents are read at startup and used in place of the plain variable — the
same convention the official `postgres`/`mysql` Docker images use
(`POSTGRES_PASSWORD_FILE`, etc.), which plugs directly into Docker/Swarm/Kubernetes
secrets mounted as files.

Currently sensitive variables (audited against every `process.env.*` read under `src/`):

| Variable | `_FILE` variant |
|---|---|
| `VIKUNJA_API_TOKEN` | `VIKUNJA_API_TOKEN_FILE` |

Behavior:

- File contents are read once at startup and **trimmed of surrounding whitespace**
  (trailing newlines from `echo`/`printf`-created secret files are common and would
  otherwise silently corrupt the token).
- Setting **both** the plain variable and its `_FILE` variant is a **hard startup
  error** — never a silent precedence choice. This matches the postgres-image
  convention and avoids a class of bug where an operator believes they've moved a
  secret into a file but the plain env var (e.g. left over in a `.env` file) is still
  silently taking priority.
- Neither set: the plain variable's absence is handled exactly as before (e.g. no
  auto-authentication).

```env
# Use a file-mounted secret instead of the plain token
VIKUNJA_API_TOKEN_FILE=/run/secrets/vikunja_token
```

```env
# Hard error at startup — remove one of these
VIKUNJA_API_TOKEN=tk_xxx
VIKUNJA_API_TOKEN_FILE=/run/secrets/vikunja_token
```

### Docker Swarm Example

Config file mounted as a `config` (non-sensitive), token mounted as a `secret`:

```yaml
version: "3.8"

services:
  vikunja-mcp:
    image: ghcr.io/netadvanced/vikunja-mcp-ng:latest
    environment:
      VIKUNJA_URL: "https://vikunja.example.com/api/v1"
      VIKUNJA_API_TOKEN_FILE: /run/secrets/vikunja_api_token
      VIKUNJA_MCP_CONFIG: /etc/vikunja-mcp/vikunja-mcp.config.json
    configs:
      - source: vikunja_mcp_config
        target: /etc/vikunja-mcp/vikunja-mcp.config.json
        mode: 0444
    secrets:
      - source: vikunja_api_token
        target: vikunja_api_token
        mode: 0400

configs:
  vikunja_mcp_config:
    file: ./vikunja-mcp.config.json

secrets:
  vikunja_api_token:
    file: ./secrets/vikunja_api_token.txt
```

Deploy with:

```bash
docker swarm init  # if not already a swarm manager
docker stack deploy -c docker-compose.yml vikunja-mcp
```

The token file (`./secrets/vikunja_api_token.txt`) should contain only the token,
optionally with a trailing newline — it will be trimmed automatically. It should never
be committed to source control; the config file (`./vikunja-mcp.config.json`) is safe to
commit since it contains no credentials.

## Environment Variables Reference

### Authentication Variables
```env
VIKUNJA_URL=https://vikunja.example.com
VIKUNJA_API_TOKEN=tk_your_token_here     # or VIKUNJA_API_TOKEN_FILE=/path/to/token — see Secrets Management
MCP_MODE=server
```

### Config File Variable
```env
VIKUNJA_MCP_CONFIG=/path/to/vikunja-mcp.config.json   # optional; see Config File
```

### Module Gating Variables
```env
VIKUNJA_MCP_MODULE_TASKS=true               # see Module Gating for the full list and defaults
```

### Global Read-Only Mode Variable
```env
VIKUNJA_MCP_READ_ONLY=true                  # optional, default false; see Global Read-Only Safety Mode
```

### Templates Persistence Variable
```env
VIKUNJA_MCP_TEMPLATES_FILE=/path/to/templates.json   # optional; see Templates Persistence
```

### Logging Variables
```env
LOG_LEVEL=info                    # error, warn, info, debug
DEBUG=false                       # true/false
NODE_ENV=production              # development, test, production
```

### Rate Limiting Variables
```env
# Global control
RATE_LIMIT_ENABLED=true

# Default tool limits
RATE_LIMIT_PER_MINUTE=60
RATE_LIMIT_PER_HOUR=1000
MAX_REQUEST_SIZE=1048576          # 1MB in bytes
MAX_RESPONSE_SIZE=10485760        # 10MB in bytes
TOOL_TIMEOUT=30000               # 30 seconds in milliseconds

# Expensive tool limits
EXPENSIVE_RATE_LIMIT_PER_MINUTE=10
EXPENSIVE_RATE_LIMIT_PER_HOUR=100
EXPENSIVE_MAX_REQUEST_SIZE=2097152
EXPENSIVE_MAX_RESPONSE_SIZE=52428800
EXPENSIVE_TOOL_TIMEOUT=120000

# Bulk operation limits
BULK_RATE_LIMIT_PER_MINUTE=5
BULK_RATE_LIMIT_PER_HOUR=50
BULK_MAX_REQUEST_SIZE=5242880
BULK_MAX_RESPONSE_SIZE=104857600
BULK_TOOL_TIMEOUT=300000

# Export operation limits
EXPORT_RATE_LIMIT_PER_MINUTE=2
EXPORT_RATE_LIMIT_PER_HOUR=10
EXPORT_MAX_REQUEST_SIZE=1048576
EXPORT_MAX_RESPONSE_SIZE=1073741824
EXPORT_TOOL_TIMEOUT=600000
```

### Feature Flag Variables
```env
VIKUNJA_ENABLE_SERVER_SIDE_FILTERING=true
```

## Usage Patterns

### Application Initialization

```typescript
import { ConfigurationManager, getConfiguration } from './config';

async function initializeApplication() {
  try {
    // Load and validate configuration early
    const config = await getConfiguration();
    
    // Use validated configuration
    if (config.auth.vikunjaUrl && config.auth.vikunjaToken) {
      await connectToVikunja(config.auth.vikunjaUrl, config.auth.vikunjaToken);
    }
    
    // Configure components
    const logger = await createLogger(config.logging);
    const rateLimiter = await createRateLimiter(config.rateLimiting);
    
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }
}
```

### Component Configuration

```typescript
// Before: Direct environment usage
export class RateLimitingMiddleware {
  constructor() {
    this.requestsPerMinute = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10);
    this.enabled = process.env.RATE_LIMIT_ENABLED !== 'false';
  }
}

// After: Configuration injection
export class RateLimitingMiddleware {
  constructor(private config: RateLimitConfig) {
    // Configuration already validated and typed
  }
  
  static async create(): Promise<RateLimitingMiddleware> {
    const config = await getRateLimitConfig();
    return new RateLimitingMiddleware(config);
  }
}
```

### Feature Flag Checks

```typescript
// Simple boolean check
if (await isFeatureEnabled('enableServerSideFiltering')) {
  return useServerSideStrategy();
} else {
  return useClientSideStrategy();
}

// Configuration-dependent logic
const featureFlags = await getFeatureFlagsConfig();
const strategy = featureFlags.enableServerSideFiltering ? 
  'server-side' : 'client-side';
```

## Testing with Configuration

### Test Configuration Injection

```typescript
import { ConfigurationManager } from '../src/config';

describe('RateLimitingMiddleware', () => {
  beforeEach(() => {
    // Reset singleton for clean test state
    ConfigurationManager.reset();
  });

  it('should respect custom rate limits', async () => {
    // Inject test configuration
    const manager = ConfigurationManager.getInstance({
      sources: {
        rateLimiting: {
          enabled: true,
          default: {
            requestsPerMinute: 5,  // Very low for testing
            requestsPerHour: 50,
            maxRequestSize: 1000,
            maxResponseSize: 10000,
            executionTimeout: 5000,
          }
        }
      }
    });
    
    const config = await manager.getRateLimitConfig();
    expect(config.default.requestsPerMinute).toBe(5);
  });
});
```

### Environment-Specific Testing

```typescript
// Test development profile behavior
it('should disable rate limiting in development', async () => {
  const manager = ConfigurationManager.getInstance({
    environment: Environment.DEVELOPMENT
  });
  
  const config = await manager.getRateLimitConfig();
  expect(config.enabled).toBe(false);
});

// Test validation errors
it('should reject invalid configuration', async () => {
  const manager = ConfigurationManager.getInstance({
    sources: {
      rateLimiting: {
        default: {
          requestsPerMinute: -1  // Invalid negative value
        }
      }
    }
  });
  
  await expect(manager.getConfiguration()).rejects.toThrow(ConfigurationError);
});
```

## Error Handling

### Configuration Errors

The system provides detailed validation errors:

```typescript
try {
  const config = await getConfiguration();
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error('Configuration validation failed:');
    console.error(`Field: ${error.field}`);
    console.error(`Message: ${error.message}`);
    console.error(`Value: ${error.value}`);
  }
}
```

### Common Error Scenarios

1. **Invalid URL Format**
   ```
   Configuration error in validation: Configuration validation failed:
     - auth.vikunjaUrl: Invalid url
   ```

2. **Negative Rate Limits**
   ```
   Configuration error in validation: Configuration validation failed:
     - rateLimiting.default.requestsPerMinute: Number must be greater than 0
   ```

3. **Invalid Log Level**
   ```
   Configuration error in validation: Configuration validation failed:
     - logging.level: Invalid enum value. Expected 'error' | 'warn' | 'info' | 'debug', received 'verbose'
   ```

## Migration from Legacy Configuration

### Step 1: Update Imports
```typescript
// Before
const maxSize = parseInt(process.env.MAX_REQUEST_SIZE || '1048576', 10);

// After
import { getRateLimitConfig } from './config';
const config = await getRateLimitConfig();
const maxSize = config.default.maxRequestSize;
```

### Step 2: Handle Async Configuration
```typescript
// Before: Synchronous constructor
class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || 'info';
  }
}

// After: Async factory
class Logger {
  constructor(private config: LoggingConfig) {}
  
  static async create(): Promise<Logger> {
    const config = await getLoggingConfig();
    return new Logger(config);
  }
}
```

### Step 3: Update Tests
```typescript
// Before: Environment manipulation
beforeEach(() => {
  process.env.RATE_LIMIT_PER_MINUTE = '30';
});

// After: Configuration injection
beforeEach(() => {
  ConfigurationManager.reset();
  ConfigurationManager.getInstance({
    sources: { rateLimiting: { default: { requestsPerMinute: 30 } } }
  });
});
```

## Performance Considerations

### Configuration Caching
- Configuration is loaded once and cached per ConfigurationManager instance
- Subsequent calls to `getConfiguration()` return cached values
- Use `ConfigurationManager.reset()` to clear cache (testing only)

### Memory Usage
- Configuration schemas use minimal memory overhead
- Zod validation occurs only during initial load
- No performance impact on application runtime

### Startup Performance
- Configuration loading adds ~1-5ms to application startup
- All validation errors are caught early in startup process
- Async loading prevents blocking main application logic

## Best Practices

### 1. Load Configuration Early
```typescript
// Good: Load configuration at application startup
async function main() {
  const config = await getConfiguration();
  // Initialize components with configuration
}

// Avoid: Loading configuration in hot paths
async function handleRequest() {
  const config = await getConfiguration(); // Cache hit, but still async
  // Handle request
}
```

### 2. Use Type-Safe Configuration
```typescript
// Good: Use typed configuration sections
const rateLimits = await getRateLimitConfig();
const limit = rateLimits.default.requestsPerMinute; // TypeScript knows this is number

// Avoid: Accessing nested properties without types
const config = await getConfiguration();
const limit = (config as any).rateLimiting.default.requestsPerMinute;
```

### 3. Handle Configuration Errors Gracefully
```typescript
// Good: Specific error handling
try {
  const config = await getConfiguration();
} catch (error) {
  if (error instanceof ConfigurationError) {
    logger.error('Configuration validation failed', { error: error.message });
    process.exit(1);
  }
  throw error; // Re-throw unexpected errors
}

// Avoid: Generic error handling
try {
  const config = await getConfiguration();
} catch (error) {
  console.error('Something went wrong:', error);
}
```

### 4. Test with Configuration Injection
```typescript
// Good: Inject test configuration
const testManager = ConfigurationManager.getInstance({
  sources: { /* test configuration */ }
});

// Avoid: Manipulating process.env in tests
process.env.RATE_LIMIT_PER_MINUTE = '30';
```

## Troubleshooting

### Common Issues

1. **Configuration Not Loading**
   - Check that `getConfiguration()` is awaited
   - Verify environment variables are set correctly
   - Check for validation errors in logs

2. **Environment Variables Not Recognized**
   - Verify variable names match `.env.example`
   - Check for typos in environment variable names
   - Ensure values are in correct format (numbers, booleans)

3. **Test Failures After Migration**
   - Reset ConfigurationManager in test setup
   - Replace environment manipulation with configuration injection
   - Update mocks to use new configuration patterns

### Debug Configuration Loading

```typescript
// Enable detailed configuration logging
const config = await ConfigurationManager.getInstance({
  sources: { logging: { level: 'debug' } }
}).getConfiguration();

// Configuration loading details will be logged
```

This centralized configuration system eliminates the 57 hours of technical debt from environment variable sprawl while providing type safety, better testing capabilities, and improved developer experience.