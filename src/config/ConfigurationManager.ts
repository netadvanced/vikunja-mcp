/**
 * Centralized Configuration Manager
 * Replaces scattered process.env usage with type-safe configuration management
 */

import { z } from 'zod';
import type {
  ApplicationConfig,
  ConfigLoadOptions,
  AuthConfig,
  LoggingConfig,
  RateLimitConfig,
  FeatureFlagsConfig,
} from './types';
import {
  Environment,
  ConfigurationError,
  ApplicationConfigSchema,
} from './types';
import { logger } from '../utils/logger';


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
      
      // 3. Load configuration from environment variables
      const envConfig = this.loadFromEnvironmentVariables();
      
      // 4. Load configuration from additional sources
      const sourceConfig = this.loadOptions.sources || {};
      
      // 5. Merge configurations using deep merge (sources override env vars, env vars override profile)
      const rawConfig = this.deepMerge(
        { environment },
        profileConfig,
        envConfig,
        sourceConfig
      );
      
      // 6. Validate and transform configuration
      this.config = this.validateConfiguration(rawConfig);
      
      // 7. Log configuration summary (without sensitive values)
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
   * Load configuration from environment variables
   * See docs/CONFIGURATION.md for the full environment variable reference.
   */
  private loadFromEnvironmentVariables(): Partial<ApplicationConfig> {
    const result: Record<string, unknown> = {};

    // Authentication variables
    const auth: Record<string, unknown> = {};
    this.assignEnvValue(auth, 'vikunjaUrl', process.env.VIKUNJA_URL, false);
    this.assignEnvValue(auth, 'vikunjaToken', process.env.VIKUNJA_API_TOKEN, false);
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