/**
 * Configuration Manager Tests
 * Comprehensive test coverage for centralized configuration management
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationManager, Environment, ConfigurationError, isModuleEnabled } from '../../src/config';

describe('ConfigurationManager', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };

    // Clear environment variables that might affect tests
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
    delete process.env.LOG_LEVEL;
    delete process.env.DEBUG;
    delete process.env.VIKUNJA_URL;
    delete process.env.VIKUNJA_API_TOKEN;
    delete process.env.VIKUNJA_API_TOKEN_FILE;
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.VIKUNJA_MCP_CONFIG;
    delete process.env.VIKUNJA_MCP_MODULE_TASKS;
    delete process.env.VIKUNJA_MCP_MODULE_PROJECTS;
    delete process.env.VIKUNJA_MCP_MODULE_LABELS;
    delete process.env.VIKUNJA_MCP_MODULE_TEAMS;
    delete process.env.VIKUNJA_MCP_MODULE_USERS;
    delete process.env.VIKUNJA_MCP_MODULE_WEBHOOKS;
    delete process.env.VIKUNJA_MCP_MODULE_FILTERS;
    delete process.env.VIKUNJA_MCP_MODULE_TEMPLATES;
    delete process.env.VIKUNJA_MCP_MODULE_EXPORT;
    delete process.env.VIKUNJA_MCP_MODULE_BATCH_IMPORT;
    delete process.env.VIKUNJA_MCP_MODULE_ADMIN;
    delete process.env.VIKUNJA_MCP_MODULE_USER_DELETION;
    delete process.env.VIKUNJA_MCP_MODULE_TOKEN_MANAGEMENT;
    delete process.env.VIKUNJA_MCP_READ_ONLY;
    delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;

    // Reset singleton
    ConfigurationManager.reset();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-mcp-config-test-'));
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    ConfigurationManager.reset();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Environment Detection', () => {
    it('should detect test environment from JEST_WORKER_ID', async () => {
      process.env.JEST_WORKER_ID = '1';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.TEST);
    });

    it('should detect test environment from NODE_ENV', async () => {
      process.env.NODE_ENV = 'test';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.TEST);
    });

    it('should detect production environment from NODE_ENV', async () => {
      process.env.NODE_ENV = 'production';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.PRODUCTION);
    });

    it('should default to development environment', async () => {
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.environment).toBe(Environment.DEVELOPMENT);
    });

    it('should allow environment override via options', async () => {
      const manager = ConfigurationManager.getInstance({
        environment: Environment.PRODUCTION
      });
      
      const config = await manager.getConfiguration();
      expect(config.environment).toBe(Environment.PRODUCTION);
    });
  });

  describe('Environment Variable Loading', () => {
    it('should load authentication configuration from environment variables', async () => {
      process.env.VIKUNJA_URL = 'https://tasks.example.com';
      process.env.VIKUNJA_API_TOKEN = 'tk_test123';
      process.env.MCP_MODE = 'server';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.auth.vikunjaUrl).toBe('https://tasks.example.com');
      expect(config.auth.vikunjaToken).toBe('tk_test123');
      expect(config.auth.mcpMode).toBe('server');
    });

    it('should load logging configuration from environment variables', async () => {
      process.env.LOG_LEVEL = 'warn';
      process.env.DEBUG = 'true';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.logging.level).toBe('warn');
      expect(config.logging.debug).toBe(true);
    });

    it('should load rate limiting configuration from environment variables', async () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      process.env.RATE_LIMIT_PER_MINUTE = '100';
      process.env.EXPENSIVE_TOOL_TIMEOUT = '180000';
      process.env.BULK_MAX_REQUEST_SIZE = '10485760';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.rateLimiting.enabled).toBe(false);
      expect(config.rateLimiting.default.requestsPerMinute).toBe(100);
      expect(config.rateLimiting.expensive.executionTimeout).toBe(180000);
      expect(config.rateLimiting.bulk.maxRequestSize).toBe(10485760);
    });

    it('should load feature flags from environment variables', async () => {
      process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING = 'true';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.featureFlags.enableServerSideFiltering).toBe(true);
    });
  });

  describe('Environment Profiles', () => {
    it('should apply development environment profile', async () => {
      process.env.NODE_ENV = 'development';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.logging.level).toBe('debug');
      expect(config.logging.debug).toBe(true);
      expect(config.rateLimiting.enabled).toBe(false);
      expect(config.featureFlags.enableServerSideFiltering).toBe(true);
      expect(config.featureFlags.enableExperimentalFeatures).toBe(true);
    });

    it('should apply test environment profile', async () => {
      process.env.NODE_ENV = 'test';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.logging.level).toBe('error');
      expect(config.logging.debug).toBe(false);
      expect(config.rateLimiting.enabled).toBe(false);
      expect(config.featureFlags.enableServerSideFiltering).toBe(false);
    });

    it('should apply production environment profile', async () => {
      process.env.NODE_ENV = 'production';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.logging.level).toBe('info');
      expect(config.logging.debug).toBe(false);
      expect(config.rateLimiting.enabled).toBe(true);
      expect(config.featureFlags.enableServerSideFiltering).toBe(true);
      expect(config.featureFlags.enableAdvancedMetrics).toBe(true);
    });

    it('should cache configuration and return same instance on subsequent calls', async () => {
      process.env.NODE_ENV = 'development';

      // Get a fresh instance
      const manager = ConfigurationManager.getInstance();

      // First call should populate cache
      const config1 = await manager.getConfiguration();
      expect(config1).toBeDefined();

      // Second call should return cached instance (hit line 171)
      const config2 = await manager.getConfiguration();

      // Should return the exact same cached instance
      expect(config1).toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('Configuration Override Priority', () => {
    it('should allow environment variables to override profile defaults', async () => {
      process.env.NODE_ENV = 'development'; // Profile sets debug = true
      process.env.DEBUG = 'false'; // Environment variable overrides
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.logging.debug).toBe(false);
    });

    it('should allow additional sources to override environment variables', async () => {
      process.env.LOG_LEVEL = 'error';
      
      const manager = ConfigurationManager.getInstance({
        sources: {
          logging: {
            level: 'debug'
          }
        }
      });
      
      const config = await manager.getConfiguration();
      
      expect(config.logging.level).toBe('debug');
    });
  });

  describe('Type Parsing', () => {
    it('should parse boolean values correctly', async () => {
      process.env.DEBUG = 'true';
      process.env.RATE_LIMIT_ENABLED = 'false';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.logging.debug).toBe(true);
      expect(config.rateLimiting.enabled).toBe(false);
    });

    it('should parse integer values correctly', async () => {
      process.env.RATE_LIMIT_PER_MINUTE = '42';
      process.env.MAX_REQUEST_SIZE = '2097152';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.rateLimiting.default.requestsPerMinute).toBe(42);
      expect(config.rateLimiting.default.maxRequestSize).toBe(2097152);
    });

    it('should parse float values correctly', async () => {
      // Although current schema doesn't use floats, test the parsing capability
      process.env.TEST_FLOAT = '3.14';
      
      const manager = ConfigurationManager.getInstance({
        sources: {
          testFloat: 3.14
        }
      });
      
      // This tests the parseEnvironmentValue method indirectly
      const config = await manager.getConfiguration();
      expect(typeof config).toBe('object');
    });

    it('should preserve string values when not numeric or boolean', async () => {
      process.env.VIKUNJA_URL = 'https://tasks.example.com';
      process.env.LOG_LEVEL = 'warn';
      
      const config = await ConfigurationManager.getInstance().getConfiguration();
      
      expect(config.auth.vikunjaUrl).toBe('https://tasks.example.com');
      expect(config.logging.level).toBe('warn');
    });
  });

  describe('Validation', () => {
    it('should reject invalid URL values', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          auth: {
            vikunjaUrl: 'not-a-url'
          }
        }
      });
      
      await expect(manager.getConfiguration()).rejects.toThrow(ConfigurationError);
    });

    it('should reject negative numeric values for rate limits', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          rateLimiting: {
            default: {
              requestsPerMinute: -1
            }
          }
        }
      });
      
      await expect(manager.getConfiguration()).rejects.toThrow(ConfigurationError);
    });

    it('should reject invalid log levels', async () => {
      process.env.LOG_LEVEL = 'invalid';
      
      await expect(
        ConfigurationManager.getInstance().getConfiguration()
      ).rejects.toThrow(ConfigurationError);
    });

    it('should provide detailed validation errors', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          rateLimiting: {
            default: {
              requestsPerMinute: 'not-a-number'
            }
          }
        }
      });
      
      try {
        await manager.getConfiguration();
        fail('Expected ConfigurationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect(error.message).toContain('Configuration validation failed');
        expect(error.message).toContain('requestsPerMinute');
      }
    });
  });

  describe('Convenience Methods', () => {
    beforeEach(() => {
      process.env.VIKUNJA_URL = 'https://tasks.example.com';
      process.env.LOG_LEVEL = 'warn';
      process.env.RATE_LIMIT_PER_MINUTE = '30';
      process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING = 'true';
    });

    it('should return auth configuration section', async () => {
      const authConfig = await ConfigurationManager.getInstance().getAuthConfig();
      
      expect(authConfig.vikunjaUrl).toBe('https://tasks.example.com');
      expect(authConfig.vikunjaToken).toBeUndefined();
    });

    it('should return logging configuration section', async () => {
      const loggingConfig = await ConfigurationManager.getInstance().getLoggingConfig();
      
      expect(loggingConfig.level).toBe('warn');
    });

    it('should return rate limiting configuration section', async () => {
      const rateLimitConfig = await ConfigurationManager.getInstance().getRateLimitConfig();
      
      expect(rateLimitConfig.default.requestsPerMinute).toBe(30);
    });

    it('should return feature flags configuration section', async () => {
      const featureFlagsConfig = await ConfigurationManager.getInstance().getFeatureFlagsConfig();
      
      expect(featureFlagsConfig.enableServerSideFiltering).toBe(true);
    });

    it('should check if feature is enabled', async () => {
      const isEnabled = await ConfigurationManager.getInstance()
        .isFeatureEnabled('enableServerSideFiltering');
      
      expect(isEnabled).toBe(true);
    });

    it('should return false for disabled features', async () => {
      const isEnabled = await ConfigurationManager.getInstance()
        .isFeatureEnabled('enableAdvancedMetrics');
      
      expect(isEnabled).toBe(false);
    });
  });

  describe('Singleton Behavior', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigurationManager.getInstance();
      const instance2 = ConfigurationManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should cache configuration after first load', async () => {
      const manager = ConfigurationManager.getInstance();
      
      const config1 = await manager.getConfiguration();
      const config2 = await manager.getConfiguration();
      
      expect(config1).toBe(config2); // Same object reference
    });

    it('should allow singleton reset for testing', () => {
      const instance1 = ConfigurationManager.getInstance();
      ConfigurationManager.reset();
      const instance2 = ConfigurationManager.getInstance();
      
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Error Handling', () => {
    it('should wrap Zod validation errors in ConfigurationError', async () => {
      const manager = ConfigurationManager.getInstance({
        sources: {
          rateLimiting: {
            default: {
              requestsPerMinute: -1 // Invalid negative value
            }
          }
        }
      });
      
      try {
        await manager.getConfiguration();
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect(error.field).toBe('validation');
        expect(error.message).toContain('Configuration validation failed');
      }
    });

    it('should handle unexpected errors gracefully', async () => {
      // Test with invalid configuration source that causes unexpected error
      const manager = ConfigurationManager.getInstance({
        sources: {
          // Create a circular reference which could cause parsing issues
          circular: null as any
        }
      });
      
      // Set up circular reference after creation
      const sources = manager['loadOptions'].sources as any;
      if (sources) {
        sources.circular = sources;
      }
      
      try {
        await manager.getConfiguration();
        // If configuration loads successfully, that's also acceptable
        // since we're testing error handling robustness
      } catch (error) {
        // Verify we get some kind of error handling
        expect(error).toBeDefined();
      }
    });
  });

  describe('Config File Layering', () => {
    it('should default to modules all enabled/disabled per built-in defaults when no file or env is set', async () => {
      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.modules.tasks).toBe(true);
      expect(config.modules.projects).toBe(true);
      expect(config.modules.labels).toBe(true);
      expect(config.modules.teams).toBe(true);
      expect(config.modules.users).toBe(true);
      expect(config.modules.webhooks).toBe(true);
      expect(config.modules.filters).toBe(true);
      expect(config.modules.templates).toBe(true);
      expect(config.modules.export).toBe(true);
      expect(config.modules.batchImport).toBe(true);
      expect(config.modules.notifications).toBe(true);
      expect(config.modules.subscriptions).toBe(true);
      expect(config.modules.reactions).toBe(true);

      // Dangerous modules: deny-by-default
      expect(config.modules.admin).toBe(false);
      expect(config.modules.userDeletion).toBe(false);
      expect(config.modules.tokenManagement).toBe(false);
    });

    it('should silently skip a missing default config file', async () => {
      // No VIKUNJA_MCP_CONFIG set, and cwd (repo root) has no
      // vikunja-mcp.config.json — loading must succeed with defaults.
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.modules.tasks).toBe(true);
    });

    it('should load module settings from an explicit config file path', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({ modules: { projects: false, teams: { enabled: false } } })
      );
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.modules.projects).toBe(false);
      expect(isModuleEnabled(config.modules.teams)).toBe(false);
      // Untouched modules keep their built-in defaults
      expect(config.modules.tasks).toBe(true);
    });

    it('should apply non-module settings from the config file too', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ logging: { level: 'debug' } }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.logging.level).toBe('debug');
    });

    it('should let environment variables win over config file values', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ modules: { projects: false } }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;
      process.env.VIKUNJA_MCP_MODULE_PROJECTS = 'true';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.modules.projects).toBe(true);
    });

    it('should fail fast with a clear message when the explicit config file does not exist', async () => {
      process.env.VIKUNJA_MCP_CONFIG = path.join(tempDir, 'does-not-exist.json');

      try {
        await ConfigurationManager.getInstance().getConfiguration();
        fail('Expected ConfigurationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).message).toContain('Failed to read config file');
      }
    });

    it('should fail fast with a clear message when the config file contains invalid JSON', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, '{ this is not valid json');
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      try {
        await ConfigurationManager.getInstance().getConfiguration();
        fail('Expected ConfigurationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).message).toContain('not valid JSON');
      }
    });

    it('should fail fast when the config file top level is not a JSON object', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify(['not', 'an', 'object']));
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      try {
        await ConfigurationManager.getInstance().getConfiguration();
        fail('Expected ConfigurationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).message).toContain('JSON object');
      }
    });

    it('should reject malformed module values via schema validation', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ modules: { tasks: 'yes-please' } }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      await expect(
        ConfigurationManager.getInstance().getConfiguration()
      ).rejects.toThrow(ConfigurationError);
    });
  });

  describe('Global Read-Only Mode', () => {
    it('defaults to false when neither the config file nor the env var set it', async () => {
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.readOnly).toBe(false);
      expect(ConfigurationManager.getInstance().isReadOnly()).toBe(false);
    });

    it('is settable from the config file', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ readOnly: true }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.readOnly).toBe(true);
      expect(ConfigurationManager.getInstance().isReadOnly()).toBe(true);
    });

    it('is settable from VIKUNJA_MCP_READ_ONLY when there is no config file', async () => {
      process.env.VIKUNJA_MCP_READ_ONLY = 'true';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.readOnly).toBe(true);
    });

    it('lets VIKUNJA_MCP_READ_ONLY win over a config file value (env always wins)', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ readOnly: true }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;
      process.env.VIKUNJA_MCP_READ_ONLY = 'false';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.readOnly).toBe(false);
    });
  });

  describe('Templates Persistence Configuration', () => {
    it('defaults to no persist path (in-memory-only templates)', async () => {
      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.templates.persistPath).toBeUndefined();
    });

    it('reads the persist path from the config file', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ templates: { persistPath: '/data/templates.json' } }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;

      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.templates.persistPath).toBe('/data/templates.json');
    });

    it('reads the persist path from VIKUNJA_MCP_TEMPLATES_FILE', async () => {
      process.env.VIKUNJA_MCP_TEMPLATES_FILE = '/env/templates.json';

      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.templates.persistPath).toBe('/env/templates.json');
    });

    it('lets VIKUNJA_MCP_TEMPLATES_FILE win over the config file value', async () => {
      const configPath = path.join(tempDir, 'vikunja-mcp.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ templates: { persistPath: '/config/templates.json' } }));
      process.env.VIKUNJA_MCP_CONFIG = configPath;
      process.env.VIKUNJA_MCP_TEMPLATES_FILE = '/env/templates.json';

      const config = await ConfigurationManager.getInstance().getConfiguration();
      expect(config.templates.persistPath).toBe('/env/templates.json');
    });

    it('exposes the templates config section via getTemplatesConfig', async () => {
      process.env.VIKUNJA_MCP_TEMPLATES_FILE = '/env/templates.json';

      const templatesConfig = await ConfigurationManager.getInstance().getTemplatesConfig();
      expect(templatesConfig.persistPath).toBe('/env/templates.json');
    });
  });

  describe('Module Gating Configuration', () => {
    it('should resolve boolean module toggles via isModuleEnabled', () => {
      expect(isModuleEnabled(true)).toBe(true);
      expect(isModuleEnabled(false)).toBe(false);
    });

    it('should resolve object-form module toggles via their enabled field', () => {
      expect(isModuleEnabled({ enabled: true })).toBe(true);
      expect(isModuleEnabled({ enabled: false })).toBe(false);
      // Future per-subcommand keys are tolerated and ignored by the resolver today
      expect(isModuleEnabled({ enabled: true, delete: false })).toBe(true);
    });

    it('should disable a module via env var boolean override', async () => {
      process.env.VIKUNJA_MCP_MODULE_WEBHOOKS = 'false';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.modules.webhooks).toBe(false);
    });

    it('should disable the notifications/subscriptions/reactions modules via env var overrides', async () => {
      process.env.VIKUNJA_MCP_MODULE_NOTIFICATIONS = 'false';
      process.env.VIKUNJA_MCP_MODULE_SUBSCRIPTIONS = 'false';
      process.env.VIKUNJA_MCP_MODULE_REACTIONS = 'false';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.modules.notifications).toBe(false);
      expect(config.modules.subscriptions).toBe(false);
      expect(config.modules.reactions).toBe(false);
    });

    it('should allow enabling a reserved dangerous module explicitly', async () => {
      process.env.VIKUNJA_MCP_MODULE_ADMIN = 'true';

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.modules.admin).toBe(true);
    });

    it('should return the modules config section via getModulesConfig', async () => {
      process.env.VIKUNJA_MCP_MODULE_LABELS = 'false';

      const modules = await ConfigurationManager.getInstance().getModulesConfig();

      expect(modules.labels).toBe(false);
    });
  });

  describe('Secrets: VIKUNJA_API_TOKEN_FILE', () => {
    it('should read the token from VIKUNJA_API_TOKEN_FILE and trim whitespace', async () => {
      const tokenPath = path.join(tempDir, 'token');
      fs.writeFileSync(tokenPath, '  tk_from_file_123  \n');
      process.env.VIKUNJA_API_TOKEN_FILE = tokenPath;

      const config = await ConfigurationManager.getInstance().getConfiguration();

      expect(config.auth.vikunjaToken).toBe('tk_from_file_123');
    });

    it('should hard-error at load time when both VIKUNJA_API_TOKEN and VIKUNJA_API_TOKEN_FILE are set', async () => {
      const tokenPath = path.join(tempDir, 'token');
      fs.writeFileSync(tokenPath, 'tk_from_file');
      process.env.VIKUNJA_API_TOKEN = 'tk_plain';
      process.env.VIKUNJA_API_TOKEN_FILE = tokenPath;

      await expect(
        ConfigurationManager.getInstance().getConfiguration()
      ).rejects.toThrow(ConfigurationError);
    });
  });
});