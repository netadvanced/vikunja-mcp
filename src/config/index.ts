/**
 * Configuration Module Entry Point
 * Centralized configuration management for the Vikunja MCP server
 */

export * from './types';
export * from './ConfigurationManager';
export * from './secrets';

// Re-export commonly used functions for convenience
export {
  getConfiguration,
  getAuthConfig,
  getLoggingConfig,
  getRateLimitConfig,
  getFeatureFlagsConfig,
  isFeatureEnabled,
  getModulesConfig,
  isReadOnly,
  getTemplatesConfig,
} from './ConfigurationManager';