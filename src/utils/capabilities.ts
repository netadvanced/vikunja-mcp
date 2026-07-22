/**
 * Session capability/version detection — backward-compatible groundwork for
 * a future v2 API migration.
 *
 * Today every call site goes through v1 (`vikunjaRestRequest`, which always
 * targets `/api/v1`). Nothing here changes that: this module only builds a
 * read-only `VikunjaCapabilities` snapshot — the raw `GET /info` payload
 * plus a one-time `GET /api/v2/openapi.json` probe — and caches it on the
 * session so a future v2 fast-path has something to consult without an
 * extra round trip. No tool currently branches on `hasV2Api`.
 *
 * The v2 probe is intentionally isolated from `vikunjaRestRequest`: that
 * helper always resolves paths against the v1 base URL
 * (`resolveBaseUrl`/`/api/v1`), builds circuit-breaker names assuming a v1
 * endpoint group, and retries — none of which is wanted for a single
 * best-effort, non-authenticated probe of a sibling `/api/v2` path. The
 * probe must also never throw or block `connect`/`info`/`status`: any
 * non-200 response or network error (including our own timeout abort) is
 * treated identically as "assume v1-only".
 */

import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaCapabilities } from '../types/vikunja';
import { logger } from './logger';

/** Bounds how long the one-time v2 probe can delay connect/info/status. */
const V2_PROBE_TIMEOUT_MS = 3000;

/**
 * Derives the `/api/v2/openapi.json` URL for a session's configured
 * `apiUrl`, regardless of whether that URL already carries an `/api/v{n}`
 * suffix (mirrors the normalization `resolveBaseUrl` does for v1 in
 * `vikunja-rest.ts`, but targets v2).
 */
export function resolveV2ProbeUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '');
  const withoutVersion = trimmed.replace(/\/api\/v\d+$/, '');
  return `${withoutVersion}/api/v2/openapi.json`;
}

/**
 * One-time, best-effort probe for v2 API support. Resolves `true` only on a
 * 2xx response; resolves `false` — never rejects — on any non-2xx status,
 * network error, or timeout. Callers are expected to cache the result
 * (see {@link getOrDetectCapabilities}) rather than probing on every call.
 */
export async function probeV2Api(apiUrl: string): Promise<boolean> {
  const url = resolveV2ProbeUrl(apiUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), V2_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return response.ok;
  } catch (error) {
    logger.debug(
      'v2 API probe failed for %s: %s',
      url,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Assembles a {@link VikunjaCapabilities} snapshot from an already-fetched
 * `GET /info` payload and a known v2-probe result. Pure/synchronous so it
 * can be reused both for the initial detection and for later refreshes that
 * reuse a cached probe result (see {@link getOrDetectCapabilities}).
 */
export function buildCapabilities(
  info: Record<string, unknown> | undefined,
  hasV2Api: boolean,
): VikunjaCapabilities {
  const version = info?.version;
  return {
    ...(typeof version === 'string' ? { serverVersion: version } : {}),
    features: info ?? {},
    hasV2Api,
  };
}

/**
 * Runs the v2 probe and builds a fresh {@link VikunjaCapabilities} snapshot.
 * Never throws — a failed probe just yields `hasV2Api: false`.
 */
export async function detectCapabilities(
  apiUrl: string,
  info: Record<string, unknown> | undefined,
): Promise<VikunjaCapabilities> {
  const hasV2Api = await probeV2Api(apiUrl);
  return buildCapabilities(info, hasV2Api);
}

/**
 * Returns this session's cached capabilities, refreshing the info-derived
 * fields (`serverVersion`/`features`) from a freshly-fetched `/info`
 * payload when the caller has one, while reusing the cached `hasV2Api`
 * probe result rather than re-probing. Probes (and caches) from scratch
 * only when no capabilities have been cached for this session yet — per the
 * "one-time probe" requirement, `GET /api/v2/openapi.json` is fetched at
 * most once per session.
 */
export async function getOrDetectCapabilities(
  authManager: AuthManager,
  info: Record<string, unknown> | undefined,
): Promise<VikunjaCapabilities> {
  const existing = authManager.getCapabilities();
  if (existing) {
    const refreshed = buildCapabilities(info, existing.hasV2Api);
    authManager.setCapabilities(refreshed);
    return refreshed;
  }

  const { apiUrl } = authManager.getSession();
  const detected = await detectCapabilities(apiUrl, info);
  authManager.setCapabilities(detected);
  return detected;
}
