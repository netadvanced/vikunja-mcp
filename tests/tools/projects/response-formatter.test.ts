/**
 * Project Response Formatter Tests
 * Verifies that response verbosity defaults to VIKUNJA_RESPONSE_VERBOSITY
 * (falling back to 'standard'), and that an explicit per-call verbosity
 * argument (e.g. from the `vikunja_projects_crud` tool schema) always
 * takes precedence over the environment default.
 */

import { VERBOSITY_ENV_VAR } from '../../../src/transforms/base';

describe('Project Response Formatter', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env[VERBOSITY_ENV_VAR];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createProjectResponse', () => {
    it('defaults to standard verbosity when no env var is set', () => {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectResponse('get_project', 'Project retrieved', { id: 1 });

      expect(result.transformation.context.verbosity).toBe('standard');
    });

    it('uses a valid VIKUNJA_RESPONSE_VERBOSITY env var as the default', () => {
      process.env[VERBOSITY_ENV_VAR] = 'detailed';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectResponse('get_project', 'Project retrieved', { id: 1 });

      expect(result.transformation.context.verbosity).toBe('detailed');
    });

    it('falls back to standard when the env var is invalid/garbage', () => {
      process.env[VERBOSITY_ENV_VAR] = 'super-verbose';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectResponse('get_project', 'Project retrieved', { id: 1 });

      expect(result.transformation.context.verbosity).toBe('standard');
    });

    it('lets an explicit per-call verbosity override the env default', () => {
      process.env[VERBOSITY_ENV_VAR] = 'detailed';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectResponse(
        'get_project',
        'Project retrieved',
        { id: 1 },
        {},
        'minimal'
      );

      expect(result.transformation.context.verbosity).toBe('minimal');
    });

    it('honors an explicit per-call verbosity even when no env var is set', () => {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectResponse(
        'list_projects',
        'Projects retrieved',
        [{ id: 1 }],
        {},
        'complete'
      );

      expect(result.transformation.context.verbosity).toBe('complete');
    });
  });

  describe('createProjectSuccessResponse (verbosity plumbing from tool options)', () => {
    it('passes the env default through when options.verbosity is not provided', () => {
      process.env[VERBOSITY_ENV_VAR] = 'minimal';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectSuccessResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectSuccessResponse('list_projects', [{ id: 1 }]);

      expect(result.transformation.context.verbosity).toBe('minimal');
    });

    it('passes an explicit options.verbosity through, overriding the env default', () => {
      process.env[VERBOSITY_ENV_VAR] = 'minimal';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createProjectSuccessResponse } = require('../../../src/tools/projects/response-formatter');

      const result = createProjectSuccessResponse('list_projects', [{ id: 1 }], {
        verbosity: 'detailed',
      });

      expect(result.transformation.context.verbosity).toBe('detailed');
    });
  });
});
