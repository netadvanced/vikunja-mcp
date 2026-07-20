/**
 * Encrypted JSON credential vault (docs/OIDC-RESOURCE-SERVER.md §3c, D1/D4).
 *
 * Maps a validated OIDC identity `(issuer, sub)` to an encrypted Vikunja
 * `tk_` API token. This is the piece that closes the "critical gap" §1.2 of
 * the spec describes: a Keycloak access token authenticates a *person*, it
 * is not itself a Vikunja credential — `oidc-http` mode needs a per-user
 * lookup from the validated identity to a Vikunja token, and this module is
 * that lookup, persisted to disk.
 *
 * Design, matching the locked decisions:
 *  - **D1** — a single encrypted JSON file, not a database. Modeled directly
 *    on `src/storage/templateFileStore.ts`'s proven shape: load-into-memory,
 *    write-temp-then-rename on every mutation. Reads tolerate a missing file
 *    (fresh deployment) and log-and-empty on a malformed one, exactly like
 *    the templates loader.
 *  - **D4** — AES-256-GCM via Node's built-in `crypto`. One operator-supplied
 *    32-byte master key (`VIKUNJA_MCP_VAULT_KEY[_FILE]`, resolved through the
 *    existing `_FILE` secrets convention, `src/config/secrets.ts`), a random
 *    12-byte IV per record, and an authenticated GCM tag verified on every
 *    decrypt. A wrong key or a tampered record fails the tag check loudly
 *    (`decryptToken` throws) rather than silently returning garbage.
 *
 * Concurrency: every mutation (`provision`/`deprovision`) is serialized
 * through a single `async-mutex` `Mutex` (matching the codebase's existing
 * thread-safety convention — see `src/client.ts`, `src/storage/
 * SimpleFilterStorage.ts`), so two concurrent provisions/deprovisions can
 * never interleave their read-modify-write cycle and tear the file.
 *
 * `getCredential` — the method the `VikunjaCredentialSource` interface
 * requires (`src/auth/CredentialSource.ts`) — is deliberately synchronous
 * (Node's `crypto` decrypt calls are sync), so it never throws: a missing
 * record or a decrypt failure (wrong key / corrupted record) both resolve to
 * `null`, which is exactly the interface's "no credential linked yet"
 * signal — a decrypt failure must never crash the OIDC auth middleware.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Mutex } from 'async-mutex';
import { logger } from '../utils/logger';
import { maskCredential } from '../utils/security';
import { ConfigurationError } from '../config/types';
import { readSecretEnv } from '../config/secrets';
import { identityKey, type Identity } from '../context/requestContext';
import type { VikunjaCredential } from '../auth/CredentialSource';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const CURRENT_KEY_VERSION = 1;

/** One vault record's on-disk shape (docs/OIDC-RESOURCE-SERVER.md §3c file-shape table). */
export interface VaultRecord {
  readonly vikunjaUrl: string;
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly keyVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
}

/** Status shape returned by `vikunja_auth status` in oidc-http mode. */
export interface VaultStatus {
  readonly provisioned: boolean;
  readonly vikunjaUrl?: string;
  /** Masked (`maskCredential`) token prefix — never the full token. */
  readonly maskedToken?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastUsedAt?: string | null;
  // Index signature so this shape can be passed directly as `ResponseData`
  // to `createStandardResponse` (`src/utils/response-factory.ts`) without a
  // separate re-shaping step.
  readonly [key: string]: unknown;
}

function isVaultRecord(value: unknown): value is VaultRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.vikunjaUrl === 'string' &&
    typeof record.ciphertext === 'string' &&
    typeof record.iv === 'string' &&
    typeof record.authTag === 'string' &&
    typeof record.keyVersion === 'number' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    (record.lastUsedAt === null || typeof record.lastUsedAt === 'string')
  );
}

/**
 * Resolve the master encryption key from `VIKUNJA_MCP_VAULT_KEY[_FILE]`
 * (the existing `_FILE` secrets convention, `src/config/secrets.ts`).
 * Throws a clear `ConfigurationError` when unset or not a 32-byte base64
 * value — `oidc-http` mode must fail loud at startup rather than run with no
 * usable vault.
 */
export function resolveVaultMasterKey(): Buffer {
  const raw = readSecretEnv('VIKUNJA_MCP_VAULT_KEY');
  if (!raw || raw.trim().length === 0) {
    throw new ConfigurationError(
      'VIKUNJA_MCP_VAULT_KEY',
      'oidc-http mode requires a credential vault master key. Set ' +
        'VIKUNJA_MCP_VAULT_KEY (or VIKUNJA_MCP_VAULT_KEY_FILE) to a base64-encoded ' +
        '32-byte value — e.g. generate one with `openssl rand -base64 32`.',
    );
  }
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new ConfigurationError(
      'VIKUNJA_MCP_VAULT_KEY',
      `must decode (as base64) to exactly ${KEY_LENGTH} bytes, got ${key.length}. ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }
  return key;
}

/**
 * Resolve the effective vault file path: `VIKUNJA_MCP_VAULT_PATH` env var
 * wins over the `vault.path` config value (matching
 * `resolveTemplatesPersistPath`'s existing env-over-config-file precedence),
 * returning `undefined` when neither is set.
 */
export function resolveVaultPath(configuredPath: string | undefined): string | undefined {
  const envPath = process.env.VIKUNJA_MCP_VAULT_PATH;
  if (envPath !== undefined && envPath.trim().length > 0) {
    return envPath;
  }
  if (configuredPath !== undefined && configuredPath.trim().length > 0) {
    return configuredPath;
  }
  return undefined;
}

/**
 * Encrypts `plaintext` (a Vikunja `tk_` token) with AES-256-GCM: a fresh
 * random 12-byte IV per call (D4), returning base64-encoded ciphertext/iv/
 * authTag ready to store on a `VaultRecord`.
 */
export function encryptToken(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts a `VaultRecord`'s ciphertext back to the plaintext `tk_` token.
 * Throws (GCM authentication-tag verification failure, or malformed
 * base64/ciphertext) when the key is wrong or the record has been tampered
 * with — this function itself never silently returns garbage; callers that
 * must not throw (`VaultFileStore.getCredential`) catch and translate this
 * into `null` themselves.
 */
export function decryptToken(
  record: Pick<VaultRecord, 'ciphertext' | 'iv' | 'authTag'>,
  key: Buffer,
): string {
  const iv = Buffer.from(record.iv, 'base64');
  const authTag = Buffer.from(record.authTag, 'base64');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf-8');
}

/**
 * Load the vault file into an in-memory `Map` keyed by `identityKey()`
 * (`"<issuer>|<sub>"`). Never throws: a missing file (fresh deployment / no
 * volume yet) or a malformed one (not JSON, not an object, individual
 * malformed entries) all fall back to an empty (or partially-empty) vault
 * with a warning logged — matching `loadTemplatesFile`'s defensive posture.
 */
export function loadVaultFile(filePath: string): Map<string, VaultRecord> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to read credential vault file, starting with an empty vault', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn('Credential vault file is not valid JSON, starting with an empty vault', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.warn('Credential vault file did not contain a JSON object, starting with an empty vault', {
      filePath,
    });
    return new Map();
  }

  const map = new Map<string, VaultRecord>();
  const entries = Object.entries(parsed as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (isVaultRecord(value)) {
      map.set(key, value);
    }
  }
  if (map.size !== entries.length) {
    logger.warn('Credential vault file contained malformed entries, dropping them', {
      filePath,
      totalEntries: entries.length,
      validEntries: map.size,
    });
  }
  return map;
}

/**
 * Write the full record map to `filePath` atomically: serialize to a temp
 * file in the same directory, then `renameSync` it over the target path.
 * Rename is atomic on the same filesystem (POSIX and Windows both
 * guarantee this — mirrors `writeTemplatesFileAtomic`), so a reader never
 * observes a partially-written vault file and a crash mid-write leaves the
 * previous good file intact. Creates the parent directory if missing, and
 * best-effort restricts the file to `0600` (owner read/write only) — never
 * fatal if the platform doesn't support it (e.g. some Windows filesystems).
 */
export function writeVaultFileAtomic(filePath: string, records: Map<string, VaultRecord>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const obj: Record<string, VaultRecord> = {};
  for (const [key, record] of records) {
    obj[key] = record;
  }
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort only — never fatal (e.g. unsupported on some filesystems).
  }
}

/**
 * The encrypted JSON credential vault. One instance is constructed at
 * `oidc-http` startup (`src/transport/oidcHttpAuth.ts`'s `setupOidcHttpAuth`)
 * and shared, via {@link setActiveVaultStore}/{@link getActiveVaultStore},
 * between the `VikunjaCredentialSource` the JWT-auth middleware reads from
 * on every request and the `vikunja_auth provision`/`status`/`deprovision`
 * subcommands (`src/tools/auth.ts`) that mutate it — the SAME in-memory
 * cache must back both, or a fresh `provision` would be invisible to the
 * next request until the file is reloaded from disk.
 */
export class VaultFileStore {
  private readonly mutex = new Mutex();
  private cache: Map<string, VaultRecord> | undefined;

  constructor(
    private readonly filePath: string,
    private readonly masterKey: Buffer,
  ) {}

  private load(): Map<string, VaultRecord> {
    if (!this.cache) {
      this.cache = loadVaultFile(this.filePath);
    }
    return this.cache;
  }

  /**
   * Resolves the calling identity's Vikunja credential. Never throws — a
   * missing record and an undecryptable one (wrong master key / tampered
   * data) both resolve to `null`, matching `VikunjaCredentialSource`'s
   * contract (`src/auth/CredentialSource.ts`) exactly.
   */
  getCredential(identity: Identity): VikunjaCredential | null {
    const record = this.load().get(identityKey(identity));
    if (!record) {
      return null;
    }
    try {
      const apiToken = decryptToken(record, this.masterKey);
      return { apiUrl: record.vikunjaUrl, apiToken, authType: 'api-token' };
    } catch (error) {
      logger.error('Vault record failed to decrypt (wrong master key or corrupted record)', {
        identity: maskCredential(identityKey(identity)),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** `vikunja_auth status` in oidc-http mode — never reveals the raw token. */
  getStatus(identity: Identity): VaultStatus {
    const record = this.load().get(identityKey(identity));
    if (!record) {
      return { provisioned: false };
    }
    let maskedToken: string | undefined;
    try {
      maskedToken = maskCredential(decryptToken(record, this.masterKey));
    } catch {
      maskedToken = undefined;
    }
    return {
      provisioned: true,
      vikunjaUrl: record.vikunjaUrl,
      ...(maskedToken !== undefined ? { maskedToken } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt,
    };
  }

  /**
   * Encrypts and upserts `apiToken` for `identity`, preserving `createdAt`
   * across a re-provision (token swap) while bumping `updatedAt`. Callers
   * MUST validate the token (round-trip against Vikunja) before calling
   * this — the vault itself has no way to check a token is real.
   */
  async provision(identity: Identity, vikunjaUrl: string, apiToken: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      const map = this.load();
      const key = identityKey(identity);
      const existing = map.get(key);
      const now = new Date().toISOString();
      const { ciphertext, iv, authTag } = encryptToken(apiToken, this.masterKey);
      const record: VaultRecord = {
        vikunjaUrl,
        ciphertext,
        iv,
        authTag,
        keyVersion: CURRENT_KEY_VERSION,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: existing?.lastUsedAt ?? null,
      };
      map.set(key, record);
      writeVaultFileAtomic(this.filePath, map);
    } finally {
      release();
    }
  }

  /** Deletes `identity`'s record, if any. Idempotent — returns whether a record actually existed. */
  async deprovision(identity: Identity): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      const map = this.load();
      const key = identityKey(identity);
      const existed = map.delete(key);
      if (existed) {
        writeVaultFileAtomic(this.filePath, map);
      }
      return existed;
    } finally {
      release();
    }
  }
}

// ---------------------------------------------------------------------------
// Active-vault seam
//
// Mirrors src/transport/oidcMiddlewareSeam.ts's module-scope registration
// pattern: `setupOidcHttpAuth` constructs exactly one `VaultFileStore` at
// startup and registers it here; `vikunja_auth`'s provision/status/
// deprovision subcommands (src/tools/auth.ts) read it back through
// `getActiveVaultStore()`. This is what keeps the middleware's read path and
// the tool's write path sharing the SAME in-memory cache (see the class doc
// comment above).
// ---------------------------------------------------------------------------

let activeVaultStore: VaultFileStore | undefined;

/** Registers the process's vault store. `undefined` clears it (used by tests). */
export function setActiveVaultStore(store: VaultFileStore | undefined): void {
  activeVaultStore = store;
}

/** The registered vault store, or `undefined` if `oidc-http` mode hasn't set one up (or isn't active). */
export function getActiveVaultStore(): VaultFileStore | undefined {
  return activeVaultStore;
}
