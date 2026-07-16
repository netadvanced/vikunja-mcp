import { Verbosity, FieldCategory, SizeEstimator, VERBOSITY_ENV_VAR } from '../../src/transforms/base';

describe('Base Transformation System', () => {
  describe('Verbosity Enum', () => {
    it('should have all expected verbosity levels', () => {
      expect(Verbosity.MINIMAL).toBe('minimal');
      expect(Verbosity.STANDARD).toBe('standard');
      expect(Verbosity.DETAILED).toBe('detailed');
      expect(Verbosity.COMPLETE).toBe('complete');
    });
  });

  describe('FieldCategory Enum', () => {
    it('should have all expected field categories', () => {
      expect(FieldCategory.CORE).toBe('core');
      expect(FieldCategory.CONTEXT).toBe('context');
      expect(FieldCategory.SCHEDULING).toBe('scheduling');
      expect(FieldCategory.METADATA).toBe('metadata');
    });
  });

  describe('SizeEstimator', () => {
    it('should return 0 for null and undefined values', () => {
      expect(SizeEstimator.estimateSize(null)).toBe(0);
      expect(SizeEstimator.estimateSize(undefined)).toBe(0);
    });

    it('should estimate string size correctly', () => {
      expect(SizeEstimator.estimateSize('hello')).toBe(10);
      expect(SizeEstimator.estimateSize('')).toBe(0);
    });

    it('should estimate number size correctly', () => {
      expect(SizeEstimator.estimateSize(42)).toBe(8);
      expect(SizeEstimator.estimateSize(0)).toBe(8);
    });

    it('should estimate boolean size correctly', () => {
      expect(SizeEstimator.estimateSize(true)).toBe(4);
      expect(SizeEstimator.estimateSize(false)).toBe(4);
    });

    it('should calculate reduction percentage correctly', () => {
      expect(SizeEstimator.calculateReduction(100, 50)).toBe(50);
      expect(SizeEstimator.calculateReduction(200, 100)).toBe(50);
      expect(SizeEstimator.calculateReduction(100, 0)).toBe(100);
      expect(SizeEstimator.calculateReduction(100, 100)).toBe(0);
    });

    it('should handle zero original size', () => {
      expect(SizeEstimator.calculateReduction(0, 0)).toBe(0);
      expect(SizeEstimator.calculateReduction(0, 50)).toBe(0);
    });
  });

  describe('getDefaultVerbosity', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      // Save original environment
      originalEnv = { ...process.env };
      // Clear any existing verbosity env var
      delete process.env[VERBOSITY_ENV_VAR];
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    it('should default to standard when the env var is not set', () => {
      jest.resetModules();
      const { getDefaultVerbosity: freshGetDefaultVerbosity } = require('../../src/transforms/base');

      expect(freshGetDefaultVerbosity()).toBe(Verbosity.STANDARD);
    });

    it('should use a valid env var value as the default', () => {
      const cases: Array<[string, Verbosity]> = [
        ['minimal', Verbosity.MINIMAL],
        ['standard', Verbosity.STANDARD],
        ['detailed', Verbosity.DETAILED],
        ['complete', Verbosity.COMPLETE],
      ];

      for (const [envValue, expected] of cases) {
        process.env[VERBOSITY_ENV_VAR] = envValue;
        jest.resetModules();
        const { getDefaultVerbosity: freshGetDefaultVerbosity } = require('../../src/transforms/base');

        expect(freshGetDefaultVerbosity()).toBe(expected);
      }
    });

    it('should match env var values case-insensitively', () => {
      process.env[VERBOSITY_ENV_VAR] = 'DeTaILeD';
      jest.resetModules();
      const { getDefaultVerbosity: freshGetDefaultVerbosity } = require('../../src/transforms/base');

      expect(freshGetDefaultVerbosity()).toBe(Verbosity.DETAILED);
    });

    it('should fall back to standard for an invalid/garbage env var value', () => {
      process.env[VERBOSITY_ENV_VAR] = 'not-a-real-verbosity-level';
      jest.resetModules();
      const { getDefaultVerbosity: freshGetDefaultVerbosity } = require('../../src/transforms/base');

      expect(freshGetDefaultVerbosity()).toBe(Verbosity.STANDARD);
    });

    it('should fall back to standard for an empty string env var value', () => {
      process.env[VERBOSITY_ENV_VAR] = '';
      jest.resetModules();
      const { getDefaultVerbosity: freshGetDefaultVerbosity } = require('../../src/transforms/base');

      expect(freshGetDefaultVerbosity()).toBe(Verbosity.STANDARD);
    });
  });
});