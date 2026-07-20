/**
 * Vault-backed `VikunjaCredentialSource` — the H2b interim replacement for
 * `OidcStubCredentialSource` (`src/auth/CredentialSource.ts`), wired in only
 * when an operator has configured `VIKUNJA_MCP_VAULT_PATH` +
 * `VIKUNJA_MCP_VAULT_KEY`[`_FILE`]. Unconfigured deployments fall back to the
 * stub exactly as before this module existed — see
 * `resolveVaultCredentialSourceConfig()`'s callers.
 *
 * TODO(H2a): this whole module is an interim stand-in — see the ownership
 * note at the top of `src/storage/vaultFileStore.ts`. When H2a's own vault
 * work lands, reconcile (most likely: delete this file and re-point
 * `src/transport/oidcHttpAuth.ts` / `src/tools/auth.ts` at H2a's
 * implementation of the same `VikunjaCredentialSource` interface plus
 * provision/status/deprovision).
 */

import { AuthManager } from '../AuthManager';
import type { Identity } from '../../context/requestContext';
import { identityKey } from '../../context/requestContext';
import type { VikunjaCredential, VikunjaCredentialSource } from '../CredentialSource';
import { readSecretEnv } from '../../config/secrets';
import { logger } from '../../utils/logger';
import { maskCredential } from '../../utils/security';
import {
  decryptToken,
  encryptToken,
  loadVaultFile,
  parseMasterKey,
  writeVaultFileAtomic,
  type VaultFile,
  type VaultRecordOnDisk,
} from '../../storage/vaultFileStore';

/** Result of {@link VaultCredentialSource.status}. */
export interface VaultStatus {
  linked: boolean;
  maskedToken?: string;
  provisionedAt?: string;
  updatedAt?: string;
  lastUsedAt?: string | null;
}

/**
 * File-backed, AES-256-GCM-encrypted implementation of
 * `VikunjaCredentialSource`, plus the provision/status/deprovision
 * operations `vikunja_auth` needs (docs/OIDC-RESOURCE-SERVER.md §3c, D7).
 *
 * Every operation is synchronous (`fs.*Sync` throughout, matching
 * `templateFileStore.ts`) and re-reads the file fresh on every call rather
 * than caching in memory — Node's single-threaded event loop means a sync
 * read-modify-write cannot be interleaved by another request, so this stays
 * correct without a mutex, at the cost of one file read/write per
 * operation. Acceptable for the expected request volume of a self-service
 * provisioning flow; revisit if profiling ever shows otherwise.
 */
export class VaultCredentialSource implements VikunjaCredentialSource {
  constructor(
    private readonly filePath: string,
    private readonly masterKey: Buffer,
    private readonly vikunjaUrl: string,
  ) {}

  getCredential(identity: Identity): VikunjaCredential | null {
    const records = loadVaultFile(this.filePath);
    const record = records[identityKey(identity)];
    if (!record) {
      return null;
    }
    try {
      const apiToken = decryptToken(record, this.masterKey);
      return {
        apiUrl: record.vikunjaUrl,
        apiToken,
        authType: AuthManager.detectAuthType(apiToken),
      };
    } catch (error) {
      // Wrong master key or a tampered/corrupted record — fail closed
      // (treat as unprovisioned) rather than throwing out of the auth path.
      // Never log the ciphertext or any derived token material.
      logger.warn('OIDC vault record failed to decrypt (wrong master key or corrupted record)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Encrypts and upserts `apiToken` for `identity`. Callers (see
   * `src/tools/auth.ts`'s `provision` subcommand) MUST verify the token
   * actually works against Vikunja *before* calling this — this method
   * itself does no verification, it only persists.
   */
  provision(identity: Identity, apiToken: string, vikunjaUrl: string): void {
    const key = identityKey(identity);
    const records = loadVaultFile(this.filePath);
    const now = new Date().toISOString();
    const existing = records[key];
    const { ciphertext, iv, authTag } = encryptToken(apiToken, this.masterKey);
    const record: VaultRecordOnDisk = {
      vikunjaUrl,
      ciphertext,
      iv,
      authTag,
      keyVersion: 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: existing?.lastUsedAt ?? null,
    };
    records[key] = record;
    writeVaultFileAtomic(this.filePath, records);
  }

  /** Reports the calling identity's own link status. Never reveals another identity's state. */
  status(identity: Identity): VaultStatus {
    const records = loadVaultFile(this.filePath);
    const record = records[identityKey(identity)];
    if (!record) {
      return { linked: false };
    }
    let maskedToken: string | undefined;
    try {
      maskedToken = maskCredential(decryptToken(record, this.masterKey));
    } catch {
      maskedToken = undefined;
    }
    return {
      linked: true,
      ...(maskedToken !== undefined ? { maskedToken } : {}),
      provisionedAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt,
    };
  }

  /** Deletes the calling identity's vault record. Idempotent — returns whether a record existed. */
  deprovision(identity: Identity): boolean {
    const key = identityKey(identity);
    const records = loadVaultFile(this.filePath);
    if (!(key in records)) {
      return false;
    }
    // Rebuild the map omitting `key` rather than `delete records[key]` — avoids
    // a dynamic-delete on a computed property key (banned by this repo's lint
    // config: @typescript-eslint/no-dynamic-delete), and is no less clear for
    // a map this small.
    const remaining: VaultFile = {};
    for (const [k, v] of Object.entries(records)) {
      if (k !== key) {
        remaining[k] = v;
      }
    }
    writeVaultFileAtomic(this.filePath, remaining);
    return true;
  }

  /** The shared Vikunja URL this vault instance was constructed with (for provisioning). */
  getVikunjaUrl(): string {
    return this.vikunjaUrl;
  }
}

export interface VaultCredentialSourceConfig {
  filePath: string;
  masterKey: Buffer;
  vikunjaUrl: string;
}

/**
 * Resolves the vault's configuration from environment variables.
 * `VIKUNJA_MCP_VAULT_PATH` (the JSON file's path) and
 * `VIKUNJA_MCP_VAULT_KEY`/`VIKUNJA_MCP_VAULT_KEY_FILE` (the 32-byte master
 * key, per the existing `_FILE` secrets convention — reused directly via
 * `readSecretEnv`, no changes to `src/config/secrets.ts` needed since that
 * helper already accepts any variable name) must both be set, or the vault
 * is considered "not configured" and callers fall back to the H1 stub.
 */
export function resolveVaultCredentialSourceConfig(): VaultCredentialSourceConfig | undefined {
  const filePath = process.env.VIKUNJA_MCP_VAULT_PATH;
  const rawKey = readSecretEnv('VIKUNJA_MCP_VAULT_KEY');
  if (!filePath || !rawKey) {
    return undefined;
  }
  const masterKey = parseMasterKey(rawKey);
  const vikunjaUrl = process.env.VIKUNJA_URL ?? '';
  return { filePath, masterKey, vikunjaUrl };
}

let cachedSource: VaultCredentialSource | undefined;
let resolved = false;

/**
 * Returns the process-wide `VaultCredentialSource` singleton, lazily built
 * on first call from environment configuration, or `undefined` when the
 * vault isn't configured. Both `src/transport/oidcHttpAuth.ts` (request-time
 * credential lookup) and `src/tools/auth.ts` (provision/status/deprovision)
 * import this same accessor so they always operate on one instance backed
 * by one file.
 */
export function getVaultCredentialSource(): VaultCredentialSource | undefined {
  if (!resolved) {
    const config = resolveVaultCredentialSourceConfig();
    cachedSource = config
      ? new VaultCredentialSource(config.filePath, config.masterKey, config.vikunjaUrl)
      : undefined;
    resolved = true;
  }
  return cachedSource;
}

/** Test-only: clears the memoized singleton so tests can reconfigure the vault via env vars. */
export function resetVaultCredentialSourceForTests(): void {
  cachedSource = undefined;
  resolved = false;
}
