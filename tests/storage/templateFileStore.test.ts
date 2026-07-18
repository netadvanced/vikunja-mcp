/**
 * Unit tests for the templates file-backed persistence primitives
 * (N3-templates-persistence). See src/tools/templates-persistence.test.ts
 * for the higher-level integration coverage (real storage, real tool
 * handler, simulated restarts).
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as path from 'path';
import * as os from 'os';
// Plain `require`, not `import * as fs`: with esModuleInterop, TS's
// `__importStar` helper freezes the resulting namespace object, which
// breaks `jest.spyOn(fs, ...)` ("Cannot redefine property") in the atomic-
// write test below. `require` returns the real, unfrozen CJS exports.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
import {
  resolveTemplatesPersistPath,
  loadTemplatesFile,
  writeTemplatesFileAtomic,
  type PersistedTemplateRecord,
} from '../../src/storage/templateFileStore';

describe('resolveTemplatesPersistPath', () => {
  const originalEnvValue = process.env.VIKUNJA_MCP_TEMPLATES_FILE;

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;
    } else {
      process.env.VIKUNJA_MCP_TEMPLATES_FILE = originalEnvValue;
    }
  });

  it('returns undefined when neither env var nor config path is set', () => {
    delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;
    expect(resolveTemplatesPersistPath(undefined)).toBeUndefined();
  });

  it('returns the configured path when only the config value is set', () => {
    delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;
    expect(resolveTemplatesPersistPath('/data/templates.json')).toBe('/data/templates.json');
  });

  it('returns the env var when only the env var is set', () => {
    process.env.VIKUNJA_MCP_TEMPLATES_FILE = '/env/templates.json';
    expect(resolveTemplatesPersistPath(undefined)).toBe('/env/templates.json');
  });

  it('prefers the env var over the config value when both are set', () => {
    process.env.VIKUNJA_MCP_TEMPLATES_FILE = '/env/templates.json';
    expect(resolveTemplatesPersistPath('/config/templates.json')).toBe('/env/templates.json');
  });

  it('treats a blank env var as unset and falls back to the config value', () => {
    process.env.VIKUNJA_MCP_TEMPLATES_FILE = '   ';
    expect(resolveTemplatesPersistPath('/config/templates.json')).toBe('/config/templates.json');
  });

  it('treats a blank config value as unset', () => {
    delete process.env.VIKUNJA_MCP_TEMPLATES_FILE;
    expect(resolveTemplatesPersistPath('   ')).toBeUndefined();
  });
});

describe('loadTemplatesFile', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'templateFileStore-'));
    filePath = path.join(tmpDir, 'templates.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when the file does not exist', () => {
    expect(fs.existsSync(filePath)).toBe(false);
    expect(loadTemplatesFile(filePath)).toEqual([]);
  });

  it('returns an empty array and logs a warning for invalid JSON', () => {
    fs.writeFileSync(filePath, '{ not valid json', 'utf-8');
    expect(loadTemplatesFile(filePath)).toEqual([]);
  });

  it('returns an empty array and logs a warning when the JSON is not an array', () => {
    fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }), 'utf-8');
    expect(loadTemplatesFile(filePath)).toEqual([]);
  });

  it('drops malformed entries but keeps well-formed ones', () => {
    const entries = [
      { id: 'template_1', name: 'template_1', data: '{}' },
      { id: 'template_2' }, // missing name/data
      'not an object',
      42,
      null,
      { id: 'template_3', name: 'template_3', data: '{"a":1}' },
    ];
    fs.writeFileSync(filePath, JSON.stringify(entries), 'utf-8');

    const result = loadTemplatesFile(filePath);
    expect(result).toEqual([
      { id: 'template_1', name: 'template_1', data: '{}' },
      { id: 'template_3', name: 'template_3', data: '{"a":1}' },
    ]);
  });

  it('a non-ENOENT read error is instead tolerated (returns empty)', () => {
    // Directory read attempts throw EISDIR, not ENOENT — verifies the
    // "any read failure => start empty" contract, not just the missing-file
    // case specifically.
    expect(loadTemplatesFile(tmpDir)).toEqual([]);
  });

  it('tolerates a non-Error value thrown from the file read (defensive error-message fallback)', () => {
    const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'boom';
    });
    try {
      expect(loadTemplatesFile(filePath)).toEqual([]);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('tolerates a non-Error value thrown from JSON.parse (defensive error-message fallback)', () => {
    fs.writeFileSync(filePath, '[]', 'utf-8');
    const parseSpy = jest.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'not an Error instance';
    });
    try {
      expect(loadTemplatesFile(filePath)).toEqual([]);
    } finally {
      parseSpy.mockRestore();
    }
  });
});

describe('writeTemplatesFileAtomic', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'templateFileStore-write-'));
    filePath = path.join(tmpDir, 'nested', 'dir', 'templates.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('creates missing parent directories', () => {
    expect(fs.existsSync(path.dirname(filePath))).toBe(false);
    writeTemplatesFileAtomic(filePath, []);
    expect(fs.existsSync(path.dirname(filePath))).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('round-trips records written to disk', () => {
    const records: PersistedTemplateRecord[] = [
      { id: 'template_1', name: 'template_1', data: JSON.stringify({ name: 'A' }) },
      { id: 'template_2', name: 'template_2', data: JSON.stringify({ name: 'B' }) },
    ];
    writeTemplatesFileAtomic(filePath, records);
    expect(loadTemplatesFile(filePath)).toEqual(records);
  });

  it('writes to a temp file and renames it over the target (atomic write)', () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    const renameSpy = jest.spyOn(fs, 'renameSync');

    writeTemplatesFileAtomic(filePath, [{ id: 't', name: 't', data: '{}' }]);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const writtenPath = writeSpy.mock.calls[0]![0] as string;
    expect(writtenPath).not.toBe(filePath);
    expect(writtenPath.startsWith(path.dirname(filePath))).toBe(true);
    expect(path.basename(writtenPath)).toMatch(/\.tmp$/);

    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith(writtenPath, filePath);

    // The rename must happen after the write completes.
    const writeOrder = writeSpy.mock.invocationCallOrder[0]!;
    const renameOrder = renameSpy.mock.invocationCallOrder[0]!;
    expect(writeOrder).toBeLessThan(renameOrder);
  });

  it('overwrites an existing file completely rather than merging', () => {
    writeTemplatesFileAtomic(filePath, [{ id: 'old', name: 'old', data: '{}' }]);
    writeTemplatesFileAtomic(filePath, [{ id: 'new', name: 'new', data: '{}' }]);
    expect(loadTemplatesFile(filePath)).toEqual([{ id: 'new', name: 'new', data: '{}' }]);
  });
});
