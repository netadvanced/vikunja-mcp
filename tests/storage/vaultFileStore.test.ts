/**
 * Unit tests for the OIDC credential vault's file-backed encryption
 * primitives (item H2b — see the ownership note at the top of
 * src/storage/vaultFileStore.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  loadVaultFile,
  writeVaultFileAtomic,
  parseMasterKey,
  encryptToken,
  decryptToken,
  type VaultRecordOnDisk,
} from '../../src/storage/vaultFileStore';

describe('parseMasterKey', () => {
  it('accepts a 64-char hex string', () => {
    const hex = crypto.randomBytes(32).toString('hex');
    const key = parseMasterKey(hex);
    expect(key.length).toBe(32);
    expect(key.toString('hex')).toBe(hex);
  });

  it('accepts a standard base64 32-byte string', () => {
    const raw = crypto.randomBytes(32);
    const key = parseMasterKey(raw.toString('base64'));
    expect(key.equals(raw)).toBe(true);
  });

  it('trims surrounding whitespace before parsing', () => {
    const hex = crypto.randomBytes(32).toString('hex');
    const key = parseMasterKey(`  ${hex}\n`);
    expect(key.toString('hex')).toBe(hex);
  });

  it('rejects a value that decodes to the wrong length', () => {
    expect(() => parseMasterKey('too-short')).toThrow(/32 bytes/);
  });

  it('rejects an empty string', () => {
    expect(() => parseMasterKey('')).toThrow(/32 bytes/);
  });
});

describe('encryptToken / decryptToken', () => {
  const key = crypto.randomBytes(32);

  it('round-trips a token', () => {
    const { ciphertext, iv, authTag } = encryptToken('tk_super-secret-token-value', key);
    const record: VaultRecordOnDisk = {
      vikunjaUrl: 'http://localhost:33456/api/v1',
      ciphertext,
      iv,
      authTag,
      keyVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    expect(decryptToken(record, key)).toBe('tk_super-secret-token-value');
  });

  it('produces a different IV and ciphertext on every call (no nonce reuse)', () => {
    const a = encryptToken('tk_same-token', key);
    const b = encryptToken('tk_same-token', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('never stores the plaintext token as a substring of the ciphertext', () => {
    const token = 'tk_plaintext-marker-0123456789';
    const { ciphertext } = encryptToken(token, key);
    expect(ciphertext).not.toContain(token);
    expect(Buffer.from(ciphertext, 'base64').toString('latin1')).not.toContain(token);
  });

  it('throws (GCM tag failure) when decrypting with the wrong key', () => {
    const { ciphertext, iv, authTag } = encryptToken('tk_value', key);
    const wrongKey = crypto.randomBytes(32);
    const record: VaultRecordOnDisk = {
      vikunjaUrl: 'http://localhost:33456/api/v1',
      ciphertext,
      iv,
      authTag,
      keyVersion: 1,
      createdAt: '',
      updatedAt: '',
      lastUsedAt: null,
    };
    expect(() => decryptToken(record, wrongKey)).toThrow();
  });

  it('throws when the ciphertext has been tampered with', () => {
    const { ciphertext, iv, authTag } = encryptToken('tk_value', key);
    const tamperedBytes = Buffer.from(ciphertext, 'base64');
    tamperedBytes[0] = tamperedBytes[0] ^ 0xff;
    const record: VaultRecordOnDisk = {
      vikunjaUrl: 'http://localhost:33456/api/v1',
      ciphertext: tamperedBytes.toString('base64'),
      iv,
      authTag,
      keyVersion: 1,
      createdAt: '',
      updatedAt: '',
      lastUsedAt: null,
    };
    expect(() => decryptToken(record, key)).toThrow();
  });
});

describe('loadVaultFile / writeVaultFileAtomic', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-vault-test-'));
    filePath = path.join(dir, 'vault.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty object when the file does not exist', () => {
    expect(loadVaultFile(filePath)).toEqual({});
  });

  it('round-trips a written vault file', () => {
    const key = crypto.randomBytes(32);
    const enc = encryptToken('tk_abc', key);
    const records = {
      'https://idp.example.test|user-1': {
        vikunjaUrl: 'http://localhost:33456/api/v1',
        ...enc,
        keyVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
      },
    };
    writeVaultFileAtomic(filePath, records);
    expect(loadVaultFile(filePath)).toEqual(records);
  });

  it('creates the parent directory if missing', () => {
    const nestedPath = path.join(dir, 'nested', 'deep', 'vault.json');
    writeVaultFileAtomic(nestedPath, {});
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('restricts the written file to owner-only permissions', () => {
    writeVaultFileAtomic(filePath, {});
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('leaves no temp file behind after a successful write', () => {
    writeVaultFileAtomic(filePath, {});
    const entries = fs.readdirSync(dir);
    expect(entries).toEqual(['vault.json']);
  });

  it('never persists the plaintext token anywhere in the file bytes', () => {
    const key = crypto.randomBytes(32);
    const token = 'tk_this-must-never-appear-on-disk';
    const enc = encryptToken(token, key);
    writeVaultFileAtomic(filePath, {
      'iss|sub': {
        vikunjaUrl: 'http://localhost:33456/api/v1',
        ...enc,
        keyVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
      },
    });
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).not.toContain(token);
  });

  it('treats a malformed JSON file as empty and logs a warning (does not throw)', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, 'not json {{{', 'utf-8');
    expect(loadVaultFile(filePath)).toEqual({});
  });

  it('treats a JSON array (wrong top-level shape) as empty', () => {
    fs.writeFileSync(filePath, '[]', 'utf-8');
    expect(loadVaultFile(filePath)).toEqual({});
  });

  it('drops malformed individual entries but keeps valid ones', () => {
    const key = crypto.randomBytes(32);
    const enc = encryptToken('tk_valid', key);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        'iss|good-user': {
          vikunjaUrl: 'http://localhost:33456/api/v1',
          ...enc,
          keyVersion: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
        'iss|bad-user': { garbage: true },
      }),
      'utf-8',
    );
    const loaded = loadVaultFile(filePath);
    expect(Object.keys(loaded)).toEqual(['iss|good-user']);
  });
});
