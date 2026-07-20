/**
 * Docker-secrets-style environment variable resolution
 *
 * Sensitive values (API tokens, etc.) must never be written to the
 * (non-sensitive, Docker-config-mountable) JSON config file. Instead, every
 * sensitive environment variable gets a `*_FILE` variant that points at a
 * file whose contents are read at startup — the same convention used by the
 * official postgres/mysql Docker images (`POSTGRES_PASSWORD_FILE`, etc.).
 *
 * Setting both the plain variable and its `_FILE` variant simultaneously is
 * a hard startup error: silently preferring one over the other would hide a
 * misconfiguration, so we fail loudly instead.
 */

import * as fs from 'fs';
import { ConfigurationError } from './types';

/**
 * Environment variables in this codebase that carry sensitive material and
 * therefore support the `_FILE` secrets convention. Audited against all
 * `process.env.*` reads under `src/` — see docs/CONFIGURATION.md.
 */
export const SENSITIVE_ENV_VARS = ['VIKUNJA_API_TOKEN', 'VIKUNJA_MCP_VAULT_KEY'] as const;

export type SensitiveEnvVar = (typeof SENSITIVE_ENV_VARS)[number];

/**
 * Resolve a sensitive environment variable, honoring the `<name>_FILE`
 * Docker-secrets convention.
 *
 * - Only `<name>` set: returns its value verbatim.
 * - Only `<name>_FILE` set: reads the referenced file and returns its
 *   contents with surrounding whitespace trimmed.
 * - Both set: throws a `ConfigurationError` — this is a hard startup error,
 *   never a silent precedence choice.
 * - Neither set: returns `undefined`.
 */
export function readSecretEnv(varName: string): string | undefined {
  const fileVarName = `${varName}_FILE`;
  const plainValue = process.env[varName];
  const filePath = process.env[fileVarName];

  if (plainValue !== undefined && filePath !== undefined) {
    throw new ConfigurationError(
      varName,
      `Both ${varName} and ${fileVarName} are set. Set only one — remove ` +
        `${varName} to read the secret from a file, or remove ${fileVarName} ` +
        `to use the plain environment variable.`
    );
  }

  if (filePath !== undefined) {
    try {
      return fs.readFileSync(filePath, 'utf-8').trim();
    } catch (error) {
      throw new ConfigurationError(
        varName,
        `Failed to read secret file for ${fileVarName} (${filePath}): ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return plainValue;
}
