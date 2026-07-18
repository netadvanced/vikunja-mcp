/**
 * Shared configuration + safety helpers for the battle-testing harness.
 *
 * SAFETY (copied pattern from scripts/mcp-e2e.ts / scripts/test-matrix.ts,
 * see docs/BATTLE-TESTING.md): this harness must NEVER touch a real Vikunja
 * instance. It deliberately does not read the ambient `VIKUNJA_URL` /
 * `VIKUNJA_API_TOKEN` env vars a developer's shell may already export (this
 * repo directory has a production `.envrc`) -- only the harness-specific
 * `BATTLE_VIKUNJA_URL` override is honored, and only after `assertLocalUrl`
 * has confirmed it resolves to localhost/127.0.0.1. Every credential this
 * harness uses is freshly minted against that (now guaranteed-local) stack.
 */

import fs from 'node:fs';
import path from 'node:path';

// This project compiles/runs as CommonJS (no "type": "module" in
// package.json -- see the other scripts/*.ts files and every src/**/*.ts
// import for the same convention), so the native CJS `__dirname` is used
// directly rather than `fileURLToPath(import.meta.url)`: the latter breaks
// under ts-jest's CJS transform (it collides with the CJS module wrapper's
// own injected `__filename`), and this file is imported by unit tests
// (tests/battle/config.test.ts and transitively most of tests/battle/*),
// not just run standalone via tsx.
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DIST_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');
export const BATTLE_RESULTS_DIR = path.join(REPO_ROOT, 'battle-results');
export const SCENARIOS_DIR = path.join(REPO_ROOT, 'scripts', 'battle', 'scenarios');

// Deliberately NOT `process.env.VIKUNJA_URL` -- see file header.
export const VIKUNJA_URL = process.env.BATTLE_VIKUNJA_URL || 'http://localhost:33456/api/v1';

export const TEST_USERNAME = 'e2e-test';
export const TEST_PASSWORD = 'VikunjaMcpE2E-2026!';
export const TOKEN_TITLE = 'vikunja-mcp-battle-harness';

/** Every piece of scenario data this harness creates is tagged with this prefix (see docs/BATTLE-TESTING.md). */
export const NAME_PREFIX_ROOT = 'battle-';

/** Aborts with a thrown error if `url` is not localhost/127.0.0.1/::1 -- never a real Vikunja instance. */
export function assertLocalUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
    throw new Error(
      `Refusing to run: target host "${host}" (from ${url}) is not localhost/127.0.0.1. ` +
        'The battle-testing harness spawns a real, tool-using AI agent and must only ever point ' +
        'it at the disposable local e2e stack (npm run e2e:up), never a real Vikunja instance. ' +
        'If you intended to target the local stack, check for a stray BATTLE_VIKUNJA_URL override.',
    );
  }
}

/** A copy of process.env with any ambient Vikunja credential vars stripped -- see file header. */
export function safeBaseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.VIKUNJA_URL;
  delete env.VIKUNJA_API_TOKEN;
  delete env.VIKUNJA_API_TOKEN_FILE;
  return env;
}

/** Generates a short, filesystem- and Vikunja-title-safe run id, e.g. "20260718-153012-a1b2c3". */
export function generateRunId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

/** The unique per-run title prefix every scenario's created data must use, e.g. "battle-20260718-153012-a1b2c3-". */
export function runPrefixFor(runId: string): string {
  return `${NAME_PREFIX_ROOT}${runId}-`;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
