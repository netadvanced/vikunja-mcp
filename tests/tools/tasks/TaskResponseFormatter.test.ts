/**
 * TaskResponseFormatter Tests
 * Verifies that response verbosity defaults to VIKUNJA_RESPONSE_VERBOSITY
 * (falling back to 'standard'), and that an explicit per-call verbosity
 * argument always takes precedence over the environment default.
 */

import { VERBOSITY_ENV_VAR } from '../../../src/transforms/base';
import type { TaskResponseData } from '../../../src/types/responses';

describe('TaskResponseFormatter', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env[VERBOSITY_ENV_VAR];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const taskData: TaskResponseData = {
    task: { id: 1, title: 'Test task' } as TaskResponseData['task'],
  };

  describe('createTaskResponse', () => {
    it('defaults to standard verbosity when no env var is set', () => {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskResponse('get-task', 'Task retrieved', taskData);

      expect(result.transformation.context.verbosity).toBe('standard');
    });

    it('uses a valid VIKUNJA_RESPONSE_VERBOSITY env var as the default', () => {
      process.env[VERBOSITY_ENV_VAR] = 'detailed';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskResponse('get-task', 'Task retrieved', taskData);

      expect(result.transformation.context.verbosity).toBe('detailed');
    });

    it('falls back to standard when the env var is invalid/garbage', () => {
      process.env[VERBOSITY_ENV_VAR] = 'nonsense-value';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskResponse('get-task', 'Task retrieved', taskData);

      expect(result.transformation.context.verbosity).toBe('standard');
    });

    it('lets an explicit per-call verbosity override the env default', () => {
      process.env[VERBOSITY_ENV_VAR] = 'detailed';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskResponse(
        'get-task',
        'Task retrieved',
        taskData,
        { timestamp: new Date().toISOString() },
        'minimal'
      );

      expect(result.transformation.context.verbosity).toBe('minimal');
    });

    it('honors an explicit per-call verbosity even when no env var is set', () => {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskResponse(
        'list-tasks',
        'Tasks retrieved',
        { tasks: [] },
        { timestamp: new Date().toISOString() },
        'complete'
      );

      expect(result.transformation.context.verbosity).toBe('complete');
    });

    it('applies the env default in the fallback (non-task) response path', () => {
      process.env[VERBOSITY_ENV_VAR] = 'minimal';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskResponse('custom-op', 'Done', { customField: 'value' });

      expect(result.transformation.context.verbosity).toBe('minimal');
    });
  });

  describe('createTaskErrorResponse', () => {
    it('defaults to standard verbosity when no env var is set', () => {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskErrorResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskErrorResponse('get-task', new Error('boom'));

      expect(result.transformation.context.verbosity).toBe('standard');
    });

    it('uses a valid VIKUNJA_RESPONSE_VERBOSITY env var as the default', () => {
      process.env[VERBOSITY_ENV_VAR] = 'complete';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskErrorResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskErrorResponse('get-task', new Error('boom'));

      expect(result.transformation.context.verbosity).toBe('complete');
    });

    it('falls back to standard when the env var is invalid/garbage', () => {
      process.env[VERBOSITY_ENV_VAR] = 'garbage';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTaskErrorResponse } = require('../../../src/tools/tasks/crud/TaskResponseFormatter');

      const result = createTaskErrorResponse('get-task', new Error('boom'));

      expect(result.transformation.context.verbosity).toBe('standard');
    });
  });
});
