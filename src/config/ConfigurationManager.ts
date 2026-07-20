/**
 * Centralized Configuration Manager
 * Replaces scattered process.env usage with type-safe configuration management
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type {
  ApplicationConfig,
  ConfigLoadOptions,
  AuthConfig,
  LoggingConfig,
  RateLimitConfig,
  FeatureFlagsConfig,
  ModulesConfig,
  TemplatesConfig,
  HttpConfig,
  TransportMode,
} from './types';
import {
  Environment,
  ConfigurationError,
  ApplicationConfigSchema,
} from './types';
import { readSecretEnv } from './secrets';
import { logger } from '../utils/logger';

/** Default location of the optional JSON config file, relative to cwd. */
const DEFAULT_CONFIG_FILE_NAME = 'vikunja-mcp.config.json';


/**
 * Environment-specific configuration overrides
 */
type EnvironmentProfile = {
  logging?: Partial<LoggingConfig>;
  rateLimiting?: Partial<RateLimitConfig>;
  auth?: Partial<AuthConfig>;
  featureFlags?: Partial<FeatureFlagsConfig>;
};

const ENVIRONMENT_PROFILES: Record<Environment, EnvironmentProfile> = {
  [Environment.DEVELOPMENT]: {
    logging: {
      level: 'debug' as const,
      debug: true,
      environment: Environment.DEVELOPMENT,
    },
    // Rate limiting disabled in development for easier local testing
    rateLimiting: {
      enabled: false,
    },
    featureFlags: {
      enableServerSideFiltering: true,
      enableExperimentalFeatures: true,
    },
  },

  [Environment.TEST]: {
    logging: {
      level: 'error' as const,
      debug: false,
      environment: Environment.TEST,
    },
    // Rate limiting disabled in tests for speed and determinism
    rateLimiting: {
      enabled: false,
    },
    featureFlags: {
      enableServerSideFiltering: false,
    },
  },

  [Environment.PRODUCTION]: {
    logging: {
      level: 'info' as const,
      debug: false,
      environment: Environment.PRODUCTION,
    },
    // Full rate limiting protection enabled in production
    rateLimiting: {
      enabled: true,
    },
    featureFlags: {
      enableServerSideFiltering: true,
      enableAdvancedMetrics: true,
    },
  },
};

/**
 * Centralized Configuration Manager
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager | null = null;
  private config: ApplicationConfig | null = null;
  private readonly loadOptions: ConfigLoadOptions;

  private constructor(options: ConfigLoadOptions = {}) {
    this.loadOptions = {
      strict: false,
      prefix: 'VIKUNJA_MCP',
      ...options,
    };
  }

  /**
   * Get singleton instance of ConfigurationManager
   */
  public static getInstance(options?: ConfigLoadOptions): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager(options);
    }
    return ConfigurationManager.instance;
  }

  /**
   * Reset singleton instance (for testing)
   */
  public static reset(): void {
    ConfigurationManager.instance = null;
  }

  /**
   * Load and validate configuration from multiple sources
   */
  public loadConfiguration(): ApplicationConfig {
    if (this.config) {
      return this.config;
    }

    try {
      // 1. Detect environment
      const environment = this.detectEnvironment();
      
      // 2. Load base configuration from environment profile
      const profileConfig = ENVIRONMENT_PROFILES[environment] || {};

      // 3. Load optional JSON config file (non-sensitive, safe to mount as a
      //    Docker config). Path is `vikunja-mcp.config.json` by default, or
      //    overridable via VIKUNJA_MCP_CONFIG.
      const fileConfig = this.loadFromConfigFile();

      // 4. Load configuration from environment variables (always wins over
      //    the config file — see docs/CONFIGURATION.md)
      const envConfig = this.loadFromEnvironmentVariables();

      // 5. Load configuration from additional sources (programmatic/test injection)
      const sourceConfig = this.loadOptions.sources || {};

      // 6. Merge configurations using deep merge. Layering, lowest to highest
      //    priority: profile defaults -> config file -> env vars -> sources.
      const rawConfig = this.deepMerge(
        { environment },
        profileConfig,
        fileConfig,
        envConfig,
        sourceConfig
      );
      
      // 7. Validate and transform configuration
      this.config = this.validateConfiguration(rawConfig);

      // 8. Log configuration summary (without sensitive values)
      this.logConfigurationSummary();
      
      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ConfigurationError(
          'validation',
          `Configuration validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      }
      throw error;
    }
  }

  /**
   * Get current configuration (load if not already loaded)
   */
  public async getConfiguration(): Promise<ApplicationConfig> {
    if (!this.config) {
      return Promise.resolve(this.loadConfiguration());
    }
    return this.config;
  }

  /**
   * Get specific configuration section
   */
  public async getAuthConfig(): Promise<AuthConfig> {
    const config = await this.getConfiguration();
    return config.auth;
  }

  public async getLoggingConfig(): Promise<LoggingConfig> {
    const config = await this.getConfiguration();
    return config.logging;
  }

  public async getRateLimitConfig(): Promise<RateLimitConfig> {
    const config = await this.getConfiguration();
    return config.rateLimiting;
  }

  public async getFeatureFlagsConfig(): Promise<FeatureFlagsConfig> {
    const config = await this.getConfiguration();
    return config.featureFlags;
  }

  public async getModulesConfig(): Promise<ModulesConfig> {
    const config = await this.getConfiguration();
    return config.modules;
  }

  public async getTemplatesConfig(): Promise<TemplatesConfig> {
    const config = await this.getConfiguration();
    return config.templates;
  }

  public async getHttpConfig(): Promise<HttpConfig> {
    const config = await this.getConfiguration();
    return config.http;
  }

  /**
   * The transport mode (`stdio` | `http`). Synchronous, like `isReadOnly()`,
   * because `src/index.ts`'s startup branch needs a cheap, non-async check
   * before it has awaited anything else; `loadConfiguration()` itself is
   * synchronous and cached after the first call.
   */
  public getTransportMode(): TransportMode {
    return this.loadConfiguration().transport;
  }

  /**
   * Whether the server is in global read-only safety mode. Synchronous
   * (unlike the other getters above) because `src/utils/read-only.ts`'s
   * per-dispatch guard needs a cheap, non-async check; `loadConfiguration()`
   * itself is synchronous and cached after the first call.
   */
  public isReadOnly(): boolean {
    return this.loadConfiguration().readOnly;
  }

  /**
   * Check if a feature is enabled
   */
  public async isFeatureEnabled(featureName: string): Promise<boolean> {
    const featureFlags = await this.getFeatureFlagsConfig();
    return featureFlags[featureName as keyof FeatureFlagsConfig] === true;
  }

  /**
   * Detect current environment
   */
  private detectEnvironment(): Environment {
    if (this.loadOptions.environment) {
      return this.loadOptions.environment;
    }

    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    const jestWorker = process.env.JEST_WORKER_ID;
    
    if (jestWorker || nodeEnv === 'test') {
      return Environment.TEST;
    }
    
    if (nodeEnv === 'production') {
      return Environment.PRODUCTION;
    }
    
    return Environment.DEVELOPMENT;
  }

  /**
   * Load configuration from an optional JSON config file.
   *
   * The file location defaults to `vikunja-mcp.config.json` in the current
   * working directory, overridable via `VIKUNJA_MCP_CONFIG`. The config file
   * is intended for non-sensitive settings only (module gating, rate limits,
   * feature flags, etc.) — it is safe to mount read-only as a Docker config.
   * Secrets belong in environment variables (optionally via the `*_FILE`
   * convention — see `./secrets.ts`), never in this file.
   *
   * - Explicit path (via env var) that cannot be read: hard error.
   * - Default path that does not exist: silently skipped (file is optional).
   * - File exists but contains invalid JSON or a non-object value: hard
   *   error either way, so misconfiguration is never masked.
   */
  private loadFromConfigFile(): Partial<ApplicationConfig> {
    const explicitPath = process.env.VIKUNJA_MCP_CONFIG;
    const configPath = explicitPath ?? path.resolve(process.cwd(), DEFAULT_CONFIG_FILE_NAME);

    let raw: string;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
    } catch (error) {
      if (explicitPath) {
        throw new ConfigurationError(
          'configFile',
          `Failed to read config file at ${configPath} (from VIKUNJA_MCP_CONFIG): ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
      // Default config file is optional — absence is not an error.
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ConfigurationError(
        'configFile',
        `Config file at ${configPath} is not valid JSON: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConfigurationError(
        'configFile',
        `Config file at ${configPath} must contain a JSON object at the top level.`
      );
    }

    return parsed as Partial<ApplicationConfig>;
  }

  /**
   * Load configuration from environment variables
   * See docs/CONFIGURATION.md for the full environment variable reference.
   */
  private loadFromEnvironmentVariables(): Partial<ApplicationConfig> {
    const result: Record<string, unknown> = {};

    // Authentication variables
    const auth: Record<string, unknown> = {};
    this.assignEnvValue(auth, 'vikunjaUrl', process.env.VIKUNJA_URL, false);
    // Sensitive: supports the VIKUNJA_API_TOKEN_FILE Docker-secrets convention.
    this.assignEnvValue(auth, 'vikunjaToken', readSecretEnv('VIKUNJA_API_TOKEN'), false);
    this.assignEnvValue(auth, 'mcpMode', process.env.MCP_MODE, false);
    if (Object.keys(auth).length > 0) {
      result.auth = auth;
    }

    // Logging variables
    const logging: Record<string, unknown> = {};
    this.assignEnvValue(logging, 'level', process.env.LOG_LEVEL, false);
    this.assignEnvValue(logging, 'debug', process.env.DEBUG, true);
    if (Object.keys(logging).length > 0) {
      result.logging = logging;
    }

    // Rate limiting variables
    const rateLimiting: Record<string, unknown> = {};
    this.assignEnvValue(rateLimiting, 'enabled', process.env.RATE_LIMIT_ENABLED, true);

    const defaultSettings: Record<string, unknown> = {};
    this.assignEnvValue(defaultSettings, 'requestsPerMinute', process.env.RATE_LIMIT_PER_MINUTE, true);
    this.assignEnvValue(defaultSettings, 'requestsPerHour', process.env.RATE_LIMIT_PER_HOUR, true);
    this.assignEnvValue(defaultSettings, 'maxRequestSize', process.env.MAX_REQUEST_SIZE, true);
    this.assignEnvValue(defaultSettings, 'maxResponseSize', process.env.MAX_RESPONSE_SIZE, true);
    this.assignEnvValue(defaultSettings, 'executionTimeout', process.env.TOOL_TIMEOUT, true);
    if (Object.keys(defaultSettings).length > 0) {
      rateLimiting.default = defaultSettings;
    }

    const expensiveSettings: Record<string, unknown> = {};
    this.assignEnvValue(expensiveSettings, 'requestsPerMinute', process.env.EXPENSIVE_RATE_LIMIT_PER_MINUTE, true);
    this.assignEnvValue(expensiveSettings, 'requestsPerHour', process.env.EXPENSIVE_RATE_LIMIT_PER_HOUR, true);
    this.assignEnvValue(expensiveSettings, 'maxRequestSize', process.env.EXPENSIVE_MAX_REQUEST_SIZE, true);
    this.assignEnvValue(expensiveSettings, 'maxResponseSize', process.env.EXPENSIVE_MAX_RESPONSE_SIZE, true);
    this.assignEnvValue(expensiveSettings, 'executionTimeout', process.env.EXPENSIVE_TOOL_TIMEOUT, true);
    if (Object.keys(expensiveSettings).length > 0) {
      rateLimiting.expensive = expensiveSettings;
    }

    const bulkSettings: Record<string, unknown> = {};
    this.assignEnvValue(bulkSettings, 'requestsPerMinute', process.env.BULK_RATE_LIMIT_PER_MINUTE, true);
    this.assignEnvValue(bulkSettings, 'requestsPerHour', process.env.BULK_RATE_LIMIT_PER_HOUR, true);
    this.assignEnvValue(bulkSettings, 'maxRequestSize', process.env.BULK_MAX_REQUEST_SIZE, true);
    this.assignEnvValue(bulkSettings, 'maxResponseSize', process.env.BULK_MAX_RESPONSE_SIZE, true);
    this.assignEnvValue(bulkSettings, 'executionTimeout', process.env.BULK_TOOL_TIMEOUT, true);
    if (Object.keys(bulkSettings).length > 0) {
      rateLimiting.bulk = bulkSettings;
    }

    const exportSettings: Record<string, unknown> = {};
    this.assignEnvValue(exportSettings, 'requestsPerMinute', process.env.EXPORT_RATE_LIMIT_PER_MINUTE, true);
    this.assignEnvValue(exportSettings, 'requestsPerHour', process.env.EXPORT_RATE_LIMIT_PER_HOUR, true);
    this.assignEnvValue(exportSettings, 'maxRequestSize', process.env.EXPORT_MAX_REQUEST_SIZE, true);
    this.assignEnvValue(exportSettings, 'maxResponseSize', process.env.EXPORT_MAX_RESPONSE_SIZE, true);
    this.assignEnvValue(exportSettings, 'executionTimeout', process.env.EXPORT_TOOL_TIMEOUT, true);
    if (Object.keys(exportSettings).length > 0) {
      rateLimiting.export = exportSettings;
    }

    if (Object.keys(rateLimiting).length > 0) {
      result.rateLimiting = rateLimiting;
    }

    // Feature flag variables
    const featureFlags: Record<string, unknown> = {};
    this.assignEnvValue(
      featureFlags,
      'enableServerSideFiltering',
      process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING,
      true
    );
    if (Object.keys(featureFlags).length > 0) {
      result.featureFlags = featureFlags;
    }

    // Module gating variables. Env vars only carry the boolean shorthand —
    // per-subcommand object-form granularity is a config-file-only feature.
    const modules: Record<string, unknown> = {};
    this.assignEnvValue(modules, 'tasks', process.env.VIKUNJA_MCP_MODULE_TASKS, true);
    this.assignEnvValue(modules, 'projects', process.env.VIKUNJA_MCP_MODULE_PROJECTS, true);
    this.assignEnvValue(modules, 'labels', process.env.VIKUNJA_MCP_MODULE_LABELS, true);
    this.assignEnvValue(modules, 'teams', process.env.VIKUNJA_MCP_MODULE_TEAMS, true);
    this.assignEnvValue(modules, 'users', process.env.VIKUNJA_MCP_MODULE_USERS, true);
    this.assignEnvValue(modules, 'webhooks', process.env.VIKUNJA_MCP_MODULE_WEBHOOKS, true);
    this.assignEnvValue(modules, 'filters', process.env.VIKUNJA_MCP_MODULE_FILTERS, true);
    this.assignEnvValue(modules, 'templates', process.env.VIKUNJA_MCP_MODULE_TEMPLATES, true);
    this.assignEnvValue(modules, 'export', process.env.VIKUNJA_MCP_MODULE_EXPORT, true);
    this.assignEnvValue(modules, 'batchImport', process.env.VIKUNJA_MCP_MODULE_BATCH_IMPORT, true);
    this.assignEnvValue(
      modules,
      'notifications',
      process.env.VIKUNJA_MCP_MODULE_NOTIFICATIONS,
      true
    );
    this.assignEnvValue(
      modules,
      'subscriptions',
      process.env.VIKUNJA_MCP_MODULE_SUBSCRIPTIONS,
      true
    );
    this.assignEnvValue(modules, 'reactions', process.env.VIKUNJA_MCP_MODULE_REACTIONS, true);
    this.assignEnvValue(modules, 'admin', process.env.VIKUNJA_MCP_MODULE_ADMIN, true);
    this.assignEnvValue(modules, 'userDeletion', process.env.VIKUNJA_MCP_MODULE_USER_DELETION, true);
    this.assignEnvValue(
      modules,
      'tokenManagement',
      process.env.VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT,
      true
    );
    this.assignEnvValue(
      modules,
      'caldavTokens',
      process.env.VIKUNJA_MCP_MODULE_CALDAV_TOKENS,
      true
    );
    this.assignEnvValue(modules, 'backgrounds', process.env.VIKUNJA_MCP_MODULE_BACKGROUNDS, true);
    if (Object.keys(modules).length > 0) {
      result.modules = modules;
    }

    // Global read-only safety mode. Top-level (not nested under `modules`)
    // since it gates write/destructive subcommands across every tool, not
    // tool registration itself. See src/utils/read-only.ts.
    this.assignEnvValue(result, 'readOnly', process.env.VIKUNJA_MCP_READ_ONLY, true);

    // Templates persistence path. Env var wins over the config file — see
    // docs/CONFIGURATION.md — which falls out naturally here because this
    // env-derived layer is merged after the config-file layer in
    // loadConfiguration()'s deepMerge call.
    const templates: Record<string, unknown> = {};
    this.assignEnvValue(templates, 'persistPath', process.env.VIKUNJA_MCP_TEMPLATES_FILE, false);
    if (Object.keys(templates).length > 0) {
      result.templates = templates;
    }

    // Transport mode (docs/OIDC-RESOURCE-SERVER.md §2.1). `stdio` (default,
    // unchanged) or `http` (opt-in Streamable HTTP transport).
    this.assignEnvValue(result, 'transport', process.env.VIKUNJA_MCP_TRANSPORT, false);

    // HTTP transport settings — only consulted when `transport=http`.
    const http: Record<string, unknown> = {};
    this.assignEnvValue(http, 'host', process.env.VIKUNJA_MCP_HTTP_HOST, false);
    this.assignEnvValue(http, 'port', process.env.VIKUNJA_MCP_HTTP_PORT, true);
    this.assignEnvValue(http, 'path', process.env.VIKUNJA_MCP_HTTP_PATH, false);
    const allowedHostsRaw = process.env.VIKUNJA_MCP_HTTP_ALLOWED_HOSTS;
    if (allowedHostsRaw !== undefined) {
      http.allowedHosts = allowedHostsRaw
        .split(',')
        .map(host => host.trim())
        .filter(host => host.length > 0);
    }
    if (Object.keys(http).length > 0) {
      result.http = http;
    }

    // OIDC resource-server settings — only consulted when `transport=http`
    // (docs/OIDC-RESOURCE-SERVER.md §3b). A comma-separated `AUDIENCE`/
    // `ALLOWED_ALGS` becomes an array; a single value stays a string. When
    // no OIDC env vars are set at all this stays absent, so `http` mode with
    // no OIDC config refuses to start (deny-mixed-mode, §2).
    const oidc: Record<string, unknown> = {};
    this.assignEnvValue(oidc, 'issuer', process.env.VIKUNJA_MCP_OIDC_ISSUER, false);
    const audienceRaw = process.env.VIKUNJA_MCP_OIDC_AUDIENCE;
    if (audienceRaw !== undefined) {
      const audiences = audienceRaw
        .split(',')
        .map(value => value.trim())
        .filter(value => value.length > 0);
      oidc.audience = audiences.length === 1 ? audiences[0] : audiences;
    }
    this.assignEnvValue(oidc, 'jwksUri', process.env.VIKUNJA_MCP_OIDC_JWKS_URI, false);
    const allowedAlgsRaw = process.env.VIKUNJA_MCP_OIDC_ALLOWED_ALGS;
    if (allowedAlgsRaw !== undefined) {
      oidc.allowedAlgs = allowedAlgsRaw
        .split(',')
        .map(value => value.trim())
        .filter(value => value.length > 0);
    }
    this.assignEnvValue(oidc, 'clockSkewSec', process.env.VIKUNJA_MCP_OIDC_CLOCK_SKEW_SEC, true);
    this.assignEnvValue(oidc, 'requiredScope', process.env.VIKUNJA_MCP_OIDC_REQUIRED_SCOPE, false);
    if (Object.keys(oidc).length > 0) {
      result.oidc = oidc;
    }

    // Credential vault path (docs/OIDC-RESOURCE-SERVER.md §3c) — only the
    // (non-secret) file path lives in config; the master key
    // (`VIKUNJA_MCP_VAULT_KEY[_FILE]`) is read directly from the environment
    // via the `_FILE` secrets convention (`src/config/secrets.ts`), never
    // through this config layer.
    const vault: Record<string, unknown> = {};
    this.assignEnvValue(vault, 'path', process.env.VIKUNJA_MCP_VAULT_PATH, false);
    if (Object.keys(vault).length > 0) {
      result.vault = vault;
    }

    return result as Partial<ApplicationConfig>;
  }

  /**
   * Assign a parsed environment variable value onto a target object,
   * skipping unset variables entirely so profile/schema defaults apply.
   */
  private assignEnvValue(
    target: Record<string, unknown>,
    key: string,
    rawValue: string | undefined,
    parse: boolean
  ): void {
    if (rawValue === undefined) {
      return;
    }
    target[key] = parse ? this.parseEnvironmentValue(rawValue) : rawValue;
  }

  /**
   * Parse a raw environment variable string into a boolean, number, or string
   */
  private parseEnvironmentValue(value: string): string | number | boolean {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    return value;
  }


  /**
   * Deep merge multiple configuration objects
   */
  private deepMerge(...objects: Record<string, unknown>[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const obj of objects) {
      if (!obj || typeof obj !== 'object') continue;
      
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (
            result[key] &&
            typeof result[key] === 'object' &&
            typeof obj[key] === 'object' &&
            !Array.isArray(result[key]) &&
            !Array.isArray(obj[key])
          ) {
            result[key] = this.deepMerge(
              result[key] as Record<string, unknown>, 
              obj[key] as Record<string, unknown>
            );
          } else {
            result[key] = obj[key];
          }
        }
      }
    }
    
    return result;
  }

  
  /**
   * Validate configuration using Zod schema
   */
  private validateConfiguration(rawConfig: unknown): ApplicationConfig {
    try {
      return ApplicationConfigSchema.parse(rawConfig);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Provide detailed validation errors
        const errors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          received: 'received' in err ? err.received : 'unknown',
          expected: 'expected' in err ? err.expected : 'unknown',
        }));
        
        throw new ConfigurationError(
          'validation',
          `Configuration validation failed:\n${errors.map(e => `  - ${e.path}: ${e.message}`).join('\n')}`,
          { errors, rawConfig }
        );
      }
      throw error;
    }
  }

  /**
   * Log configuration summary without sensitive values
   */
  private logConfigurationSummary(): void {
    if (!this.config) return;
    
    const summary = {
      environment: this.config.environment,
      auth: {
        hasUrl: !!this.config.auth.vikunjaUrl,
        hasToken: !!this.config.auth.vikunjaToken,
        mcpMode: this.config.auth.mcpMode,
      },
      logging: this.config.logging,
      rateLimiting: {
        enabled: this.config.rateLimiting.enabled,
        profiles: {
          default: this.config.rateLimiting.default.requestsPerMinute,
          expensive: this.config.rateLimiting.expensive.requestsPerMinute,
          bulk: this.config.rateLimiting.bulk.requestsPerMinute,
          export: this.config.rateLimiting.export.requestsPerMinute,
        },
      },
      featureFlags: this.config.featureFlags,
      modules: this.config.modules,
      readOnly: this.config.readOnly,
      templates: {
        persistenceEnabled: !!this.config.templates.persistPath,
      },
      transport: this.config.transport,
      http:
        this.config.transport === 'http'
          ? {
              host: this.config.http.host,
              port: this.config.http.port,
              path: this.config.http.path,
              allowedHostsConfigured: !!this.config.http.allowedHosts,
              // Presence only — never the issuer/audience/JWKS values
              // themselves, which are non-secret but noisy; the boolean is
              // enough to confirm the deny-mixed-mode gate is satisfied.
              oidcConfigured: !!this.config.oidc,
            }
          : undefined,
    };

    logger.info('Configuration loaded successfully', summary);
  }
}

// Export singleton instance getter
export const getConfiguration = (): Promise<ApplicationConfig> => ConfigurationManager.getInstance().getConfiguration();
export const getAuthConfig = (): Promise<AuthConfig> => ConfigurationManager.getInstance().getAuthConfig();
export const getLoggingConfig = (): Promise<LoggingConfig> => ConfigurationManager.getInstance().getLoggingConfig();
export const getRateLimitConfig = (): Promise<RateLimitConfig> => ConfigurationManager.getInstance().getRateLimitConfig();
export const getFeatureFlagsConfig = (): Promise<FeatureFlagsConfig> => ConfigurationManager.getInstance().getFeatureFlagsConfig();
export const isFeatureEnabled = (featureName: string): Promise<boolean> => ConfigurationManager.getInstance().isFeatureEnabled(featureName);
export const getModulesConfig = (): Promise<ModulesConfig> => ConfigurationManager.getInstance().getModulesConfig();
export const isReadOnly = (): boolean => ConfigurationManager.getInstance().isReadOnly();
export const getTemplatesConfig = (): Promise<TemplatesConfig> => ConfigurationManager.getInstance().getTemplatesConfig();
export const getHttpConfig = (): Promise<HttpConfig> => ConfigurationManager.getInstance().getHttpConfig();
export const getTransportMode = (): TransportMode => ConfigurationManager.getInstance().getTransportMode();
