/**
 * Encrypted-JSON-file credential vault — the on-disk half of the OIDC
 * `(issuer, sub) -> Vikunja tk_ token` credential vault
 * (docs/OIDC-RESOURCE-SERVER.md §3c, decisions D1/D4).
 *
 * INTERIM IMPLEMENTATION NOTE (item H2b, 2026-07-21): this module implements
 * the vault exactly as §3c/D1/D4 specify it (AES-256-GCM, per-record IV,
 * atomic write-temp-then-rename, `"<issuer>|<sub>"` keying). It was written
 * by the H2b (e2e-hardening) worker because H2a (the wave item that formally
 * owns this file, per the TODO left in `src/auth/CredentialSource.ts`) had
 * not yet landed any code when H2b needed a real, file-backed vault to test
 * against (the threat-model suite's vault-at-rest check needs an actual file
 * on disk to grep). If H2a's own implementation differs, integration should
 * reconcile the two rather than keep both — this is a stopgap, not a claim
 * of ownership.
 *
 * Mirrors the atomic-write pattern already proven in
 * `src/storage/templateFileStore.ts` (write to a temp file in the same
 * directory, then `fs.renameSync` over the target — atomic on POSIX and
 * Windows, so a reader never observes a partially-written file and a crash
 * mid-write leaves the previous good file intact).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/** One vault record as stored on disk, per §3c's file-shape table. */
export interface VaultRecordOnDisk {
  vikunjaUrl: string;
  /** Base64 AES-256-GCM ciphertext of the Vikunja `tk_` token. */
  ciphertext: string;
  /** Base64, 12-byte random nonce, unique per write. */
  iv: string;
  /** Base64 GCM authentication tag. */
  authTag: string;
  /** Supports future key rotation; always `1` until rotation is implemented. */
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

/** The full vault file: an object keyed by `"<issuer>|<sub>"`. */
export type VaultFile = Record<string, VaultRecordOnDisk>;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function isVaultRecord(value: unknown): value is VaultRecordOnDisk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.vikunjaUrl === 'string' &&
    typeof r.ciphertext === 'string' &&
    typeof r.iv === 'string' &&
    typeof r.authTag === 'string' &&
    typeof r.keyVersion === 'number' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    (r.lastUsedAt === null || typeof r.lastUsedAt === 'string')
  );
}

/**
 * Load the vault file from disk. Never throws: a missing file (fresh
 * deployment) or malformed JSON both fall back to an empty vault, logging a
 * warning for the latter so an operator can tell "no one has provisioned
 * yet" from "the file got corrupted" — matching `templateFileStore.ts`'s
 * defensive posture, except a malformed vault is a bigger deal (every user
 * would silently need to re-provision), so callers surfacing `/readyz`
 * should treat a load failure as not-ready (see `docs/OIDC-RESOURCE-SERVER.md`
 * §3a).
 */
export function loadVaultFile(filePath: string): VaultFile {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to read OIDC credential vault file, treating as empty', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn('OIDC credential vault file is not valid JSON, treating as empty', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.warn('OIDC credential vault file did not contain a JSON object, treating as empty', {
      filePath,
    });
    return {};
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  const valid: VaultFile = {};
  let dropped = 0;
  for (const [key, value] of entries) {
    if (isVaultRecord(value)) {
      valid[key] = value;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    logger.warn('OIDC credential vault file contained malformed entries, dropping them', {
      filePath,
      totalEntries: entries.length,
      droppedEntries: dropped,
    });
  }
  return valid;
}

/**
 * Write the full vault record map to `filePath` atomically. Creates the
 * parent directory if missing (so a fresh Docker volume mount works without
 * a separate provisioning step) and best-effort restricts permissions to
 * `0600` (owner read/write only) on the final file.
 */
export function writeVaultFileAtomic(filePath: string, records: VaultFile): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort — some filesystems (e.g. certain bind mounts) reject chmod;
    // the temp file was already created with 0600 so this is defense in depth.
  }
}

/** Parses the operator-supplied master key into exactly 32 raw bytes. */
export function parseMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === KEY_LENGTH) {
      return decoded;
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(
    'VIKUNJA_MCP_VAULT_KEY must decode to exactly 32 bytes: either 64 hex characters, ' +
      'or standard base64 (e.g. `openssl rand -hex 32` or `openssl rand -base64 32`).',
  );
}

/** Encrypts `plaintext` with AES-256-GCM under `masterKey`, using a fresh random IV. */
export function encryptToken(
  plaintext: string,
  masterKey: Buffer,
): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts a vault record under `masterKey`. Throws (GCM tag verification
 * failure) rather than returning garbage on a wrong key or tampered
 * ciphertext — per D4, "a wrong key or tampered record fails GCM tag
 * verification loudly rather than silently returning garbage."
 */
export function decryptToken(record: VaultRecordOnDisk, masterKey: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf-8');
}
