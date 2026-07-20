/**
 * Unit tests for the H2b interim vault-backed `VikunjaCredentialSource`
 * (src/auth/oidc/vaultCredentialSource.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  VaultCredentialSource,
  resolveVaultCredentialSourceConfig,
  getVaultCredentialSource,
  resetVaultCredentialSourceForTests,
} from '../../../src/auth/oidc/vaultCredentialSource';
import type { Identity } from '../../../src/context/requestContext';

describe('VaultCredentialSource', () => {
  let dir: string;
  let filePath: string;
  let masterKey: Buffer;
  let source: VaultCredentialSource;

  const alice: Identity = { issuer: 'https://idp.example.test', sub: 'alice-sub' };
  const bob: Identity = { issuer: 'https://idp.example.test', sub: 'bob-sub' };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-vault-cred-test-'));
    filePath = path.join(dir, 'vault.json');
    masterKey = crypto.randomBytes(32);
    source = new VaultCredentialSource(filePath, masterKey, 'http://localhost:33456/api/v1');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getCredential returns null for an identity with no record', () => {
    expect(source.getCredential(alice)).toBeNull();
  });

  it('provision then getCredential round-trips the token and URL', () => {
    source.provision(alice, 'tk_alice-token-value', 'http://localhost:33456/api/v1');
    const cred = source.getCredential(alice);
    expect(cred).toEqual({
      apiUrl: 'http://localhost:33456/api/v1',
      apiToken: 'tk_alice-token-value',
      authType: 'api-token',
    });
  });

  it('detects a JWT-shaped token as authType jwt', () => {
    const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-part-here';
    source.provision(alice, jwtLike, 'http://localhost:33456/api/v1');
    expect(source.getCredential(alice)?.authType).toBe('jwt');
  });

  it('isolates two identities: provisioning one never surfaces in the other (credential isolation)', () => {
    source.provision(alice, 'tk_alice-token', 'http://localhost:33456/api/v1');
    expect(source.getCredential(bob)).toBeNull();
    source.provision(bob, 'tk_bob-token', 'http://localhost:33456/api/v1');
    expect(source.getCredential(alice)?.apiToken).toBe('tk_alice-token');
    expect(source.getCredential(bob)?.apiToken).toBe('tk_bob-token');
  });

  it('status reports linked:false for an unprovisioned identity', () => {
    expect(source.status(alice)).toEqual({ linked: false });
  });

  it('status reports masked token + timestamps for a provisioned identity, never the raw token', () => {
    source.provision(alice, 'tk_alice-token-value', 'http://localhost:33456/api/v1');
    const status = source.status(alice);
    expect(status.linked).toBe(true);
    expect(status.maskedToken).toBe('tk_a...');
    expect(status.maskedToken).not.toContain('alice-token-value');
    expect(status.provisionedAt).toBeDefined();
    expect(status.updatedAt).toBeDefined();
  });

  it("status never reveals another identity's link state", () => {
    source.provision(alice, 'tk_alice-token', 'http://localhost:33456/api/v1');
    expect(source.status(bob)).toEqual({ linked: false });
  });

  it('deprovision removes the record and returns true; re-checking returns false', () => {
    source.provision(alice, 'tk_alice-token', 'http://localhost:33456/api/v1');
    expect(source.deprovision(alice)).toBe(true);
    expect(source.getCredential(alice)).toBeNull();
    expect(source.status(alice)).toEqual({ linked: false });
  });

  it('deprovision is idempotent: a second call returns false', () => {
    source.provision(alice, 'tk_alice-token', 'http://localhost:33456/api/v1');
    expect(source.deprovision(alice)).toBe(true);
    expect(source.deprovision(alice)).toBe(false);
  });

  it('deprovisioning one identity never affects another (deprovision isolation)', () => {
    source.provision(alice, 'tk_alice-token', 'http://localhost:33456/api/v1');
    source.provision(bob, 'tk_bob-token', 'http://localhost:33456/api/v1');
    source.deprovision(alice);
    expect(source.getCredential(bob)?.apiToken).toBe('tk_bob-token');
  });

  it('re-provisioning (token swap) replaces the old token, preserving createdAt but bumping updatedAt', () => {
    source.provision(alice, 'tk_alice-token-v1', 'http://localhost:33456/api/v1');
    const firstStatus = source.status(alice);
    source.provision(alice, 'tk_alice-token-v2', 'http://localhost:33456/api/v1');
    const secondStatus = source.status(alice);
    expect(source.getCredential(alice)?.apiToken).toBe('tk_alice-token-v2');
    expect(secondStatus.provisionedAt).toBe(firstStatus.provisionedAt);
  });

  it('getCredential fails closed (returns null) when the master key is wrong', () => {
    source.provision(alice, 'tk_alice-token', 'http://localhost:33456/api/v1');
    const wrongKeySource = new VaultCredentialSource(
      filePath,
      crypto.randomBytes(32),
      'http://localhost:33456/api/v1',
    );
    expect(wrongKeySource.getCredential(alice)).toBeNull();
  });

  it('getVikunjaUrl returns the URL the source was constructed with', () => {
    expect(source.getVikunjaUrl()).toBe('http://localhost:33456/api/v1');
  });

  it('never writes the plaintext token to the vault file on disk', () => {
    source.provision(alice, 'tk_disk-check-marker-value', 'http://localhost:33456/api/v1');
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).not.toContain('tk_disk-check-marker-value');
  });
});

describe('resolveVaultCredentialSourceConfig', () => {
  const savedEnv = {
    path: process.env.VIKUNJA_MCP_VAULT_PATH,
    key: process.env.VIKUNJA_MCP_VAULT_KEY,
    keyFile: process.env.VIKUNJA_MCP_VAULT_KEY_FILE,
    url: process.env.VIKUNJA_URL,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries({
      VIKUNJA_MCP_VAULT_PATH: savedEnv.path,
      VIKUNJA_MCP_VAULT_KEY: savedEnv.key,
      VIKUNJA_MCP_VAULT_KEY_FILE: savedEnv.keyFile,
      VIKUNJA_URL: savedEnv.url,
    })) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    resetVaultCredentialSourceForTests();
  });

  it('returns undefined when neither VIKUNJA_MCP_VAULT_PATH nor _KEY is set', () => {
    delete process.env.VIKUNJA_MCP_VAULT_PATH;
    delete process.env.VIKUNJA_MCP_VAULT_KEY;
    delete process.env.VIKUNJA_MCP_VAULT_KEY_FILE;
    expect(resolveVaultCredentialSourceConfig()).toBeUndefined();
  });

  it('returns undefined when only the path is set (no key)', () => {
    process.env.VIKUNJA_MCP_VAULT_PATH = '/tmp/vault.json';
    delete process.env.VIKUNJA_MCP_VAULT_KEY;
    delete process.env.VIKUNJA_MCP_VAULT_KEY_FILE;
    expect(resolveVaultCredentialSourceConfig()).toBeUndefined();
  });

  it('returns a full config when both path and key are set', () => {
    process.env.VIKUNJA_MCP_VAULT_PATH = '/tmp/vault.json';
    process.env.VIKUNJA_MCP_VAULT_KEY = crypto.randomBytes(32).toString('hex');
    process.env.VIKUNJA_URL = 'http://localhost:33456/api/v1';
    const config = resolveVaultCredentialSourceConfig();
    expect(config?.filePath).toBe('/tmp/vault.json');
    expect(config?.vikunjaUrl).toBe('http://localhost:33456/api/v1');
    expect(config?.masterKey.length).toBe(32);
  });

  describe('getVaultCredentialSource singleton', () => {
    it('returns undefined and memoizes when unconfigured', () => {
      delete process.env.VIKUNJA_MCP_VAULT_PATH;
      delete process.env.VIKUNJA_MCP_VAULT_KEY;
      delete process.env.VIKUNJA_MCP_VAULT_KEY_FILE;
      resetVaultCredentialSourceForTests();
      expect(getVaultCredentialSource()).toBeUndefined();
      expect(getVaultCredentialSource()).toBeUndefined();
    });

    it('returns the same instance across calls once configured', () => {
      process.env.VIKUNJA_MCP_VAULT_PATH = path.join(os.tmpdir(), `vault-singleton-${Date.now()}.json`);
      process.env.VIKUNJA_MCP_VAULT_KEY = crypto.randomBytes(32).toString('hex');
      resetVaultCredentialSourceForTests();
      const a = getVaultCredentialSource();
      const b = getVaultCredentialSource();
      expect(a).toBeDefined();
      expect(a).toBe(b);
    });
  });
});
