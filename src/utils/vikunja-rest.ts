/**
 * Direct REST helper for Vikunja API endpoints not covered by node-vikunja.
 *
 * node-vikunja (the typed client this MCP server wraps) does not expose the
 * Kanban view endpoints — listing the buckets of a view, or placing a task
 * into a bucket. Those operations therefore call the Vikunja REST API
 * directly, reusing the credentials of the active authenticated session.
 *
 * Unlike the node-vikunja call paths (which get retry protection via
 * `withRetry` at each call site), this helper previously had none at all —
 * a single dropped connection or transient 502 failed the whole operation.
 * Every request made through `vikunjaRestRequest`/`vikunjaRestMultipartRequest`
 * now goes through a retry loop plus a NAMED opossum circuit breaker, one
 * breaker per endpoint group (derived from the request path, e.g.
 * `/webhooks/events` -> `vikunja-rest-webhooks-events`). Breakers are process
 * -wide and keyed by name via the shared registry in `./retry`, so sharing a
 * name across unrelated endpoints would let one endpoint's failures trip the
 * breaker for another's — the automatic per-path derivation exists
 * specifically to avoid that. See `createCircuitBreaker` in `./retry` for
 * why the action passed to the breaker must be a stable function reference
 * (not a call-site closure): that was the shape of the anonymous-breaker bug
 * fixed in the wave0 baseline, where a shared breaker kept re-firing the
 * first closure ever registered under a name instead of the current call's.
 */

import type { AuthManager } from '../auth/AuthManager';
import { MCPError, ErrorCode } from '../types';
import { createCircuitBreaker, withRetry, isRetryableError, type RetryOptions } from './retry';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Resolves the API base URL for a session, normalizing whether or not
 * `apiUrl` already includes the `/api/v{n}` prefix (depends on how
 * `VIKUNJA_URL` was configured).
 */
function resolveBaseUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '');
  return /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
}

/**
 * Derives a stable, endpoint-group-scoped circuit breaker name from a
 * request path, e.g. `/projects/4/webhooks` -> `vikunja-rest-projects-webhooks`,
 * `/webhooks/events` -> `vikunja-rest-webhooks-events`, `/tasks/7` ->
 * `vikunja-rest-tasks`. Numeric path segments (ids) are dropped so that
 * calls against different resource instances of the same endpoint group
 * still share one breaker; only the first two non-numeric segments are used
 * so deeply nested paths still collapse to a reasonably-scoped group rather
 * than a breaker-per-exact-path (which would defeat the point of tracking a
 * rolling failure window).
 */
export function deriveRestBreakerName(path: string): string {
  const segments = path.split('/').filter((seg) => seg.length > 0 && !/^\d+$/.test(seg));
  const group = segments.slice(0, 2).join('-') || 'root';
  return `vikunja-rest-${group}`;
}

/**
 * Default retry/backoff tuning for JSON REST calls. Deliberately modest —
 * this is a fallback safety net for transient failures, not a substitute
 * for a caller thinking about idempotency. Overridable per call via
 * `VikunjaRestRequestOptions.retry`.
 */
const DEFAULT_JSON_RETRY: RetryOptions = {
  maxRetries: 2,
  initialDelay: 250,
  maxDelay: 2000,
  backoffFactor: 2,
};

/**
 * Multipart uploads default to NO automatic retry: Vikunja's attachment
 * endpoint is additive (each successful PUT adds another attachment), so
 * blindly resending after an ambiguous failure (e.g. the server received
 * the file but the response was lost) risks silently duplicating the
 * attachment. Callers that know their upload is safe to retry (e.g. a
 * network error observed before any bytes were sent) can opt in via
 * `options.retry.maxRetries`. The circuit breaker still applies, so a
 * persistently failing endpoint fails fast rather than hanging every call.
 */
const DEFAULT_MULTIPART_RETRY: RetryOptions = {
  maxRetries: 0,
};

/**
 * Node/undici system error codes that indicate a connection-level failure
 * worth retrying (as opposed to e.g. a validation or programming error).
 * `fetch()` failures typically surface as `TypeError: fetch failed` with the
 * real cause nested in `.cause` — checked below alongside `.code` — rather
 * than as a directly-coded Error, so the code must look in both places.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Determines whether a caught network-layer error (i.e. `fetch()` itself
 * rejected, before any HTTP response was received) looks transient and
 * therefore worth retrying. Checked BEFORE the error is wrapped into an
 * MCPError, because wrapping discards the original `.code`/`.cause.code` —
 * a plain `new MCPError(..., formattedMessage)` has no such property, so a
 * retry predicate consulted only the wrapped error would silently never
 * retry any real network failure. The result is threaded through via
 * `MCPErrorDetails.transient` so `defaultRestShouldRetry` can use it later.
 */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string' && TRANSIENT_NETWORK_CODES.has(causeCode)) {
      return true;
    }
  }
  return isRetryableError(error);
}

/**
 * Default retry predicate for the REST helper: retries HTTP 5xx/429
 * responses and network-level failures that look transient, but never 4xx
 * client errors — retrying a 401/403/404 wastes the latency budget without
 * changing the outcome (see docs/VIKUNJA_API_ISSUES.md #8: `/webhooks/events`
 * is known to return 401 with an otherwise-valid token on some server
 * configurations, so callers like `getValidEvents` depend on failing fast
 * into their fallback rather than retrying a doomed request).
 */
export function defaultRestShouldRetry(error: unknown): boolean {
  if (error instanceof MCPError) {
    const statusCode = error.details?.statusCode;
    if (statusCode !== undefined) {
      return statusCode >= 500 || statusCode === 429;
    }
    if (error.details?.transient !== undefined) {
      return error.details.transient;
    }
  }
  return isRetryableError(error);
}

export interface VikunjaRestRequestOptions {
  /**
   * Overrides the automatically-derived circuit breaker name for this call.
   * Only specify this to deliberately share (or split) failure accounting
   * across paths — an explicit name still MUST identify a real, unique
   * endpoint group, never be reused across unrelated operations.
   */
  breakerName?: string;
  /** Overrides merged over this helper's default retry/backoff settings. */
  retry?: RetryOptions;
}

/**
 * The actual network call, with no retry/breaker logic of its own. This is
 * intentionally a plain top-level function (not a closure factory) so it
 * can be safely registered once per breaker name and re-fired with fresh
 * arguments on every call — see the module doc comment above.
 */
async function vikunjaRestRequestRaw(
  authManager: AuthManager,
  method: HttpMethod,
  path: string,
  body: unknown,
): Promise<unknown> {
  const session = authManager.getSession();
  const url = `${resolveBaseUrl(session.apiUrl)}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.apiToken}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Vikunja REST request failed (${method} ${path}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { transient: isTransientNetworkError(error) },
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // Body could not be read — fall back to the status line only.
    }
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Vikunja REST request failed (${method} ${path}): HTTP ${response.status} ${
        response.statusText
      }${detail ? ` — ${detail}` : ''}`,
      { statusCode: response.status },
    );
  }

  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // A 2xx response with a non-JSON body (rare) is treated as an empty result.
    return null;
  }
}

/**
 * Performs an authenticated request against the Vikunja REST API, protected
 * by a named circuit breaker and a bounded retry loop (see the module doc
 * comment for why retry/breaker names work the way they do here).
 *
 * @param authManager - Active auth manager holding the session credentials
 * @param method - HTTP method
 * @param path - API path relative to the configured apiUrl, must start with '/'
 *               (e.g. '/projects/4/views')
 * @param body - Optional value serialized as a JSON request body
 * @param options - Optional breaker-name override and retry tuning
 * @returns The parsed JSON response, or null when the response has no body
 * @throws MCPError when the network call fails or the response is not OK
 *         (after retries are exhausted); the thrown error's
 *         `details.statusCode` reflects the HTTP status of the last attempt,
 *         preserved through retries so callers that treat specific status
 *         codes as fallback signals (e.g. webhooks.ts's `getValidEvents`)
 *         keep working unchanged.
 */
export async function vikunjaRestRequest<T = unknown>(
  authManager: AuthManager,
  method: HttpMethod,
  path: string,
  body?: unknown,
  options?: VikunjaRestRequestOptions,
): Promise<T> {
  const breakerName = options?.breakerName ?? deriveRestBreakerName(path);
  const retryOptions: RetryOptions = {
    ...DEFAULT_JSON_RETRY,
    shouldRetry: defaultRestShouldRetry,
    ...options?.retry,
  };
  const breaker = createCircuitBreaker(vikunjaRestRequestRaw, breakerName, retryOptions);
  const result = await withRetry(
    () => breaker.fire(authManager, method, path, body),
    retryOptions,
  );
  return result as T;
}

/**
 * The multipart equivalent of `vikunjaRestRequestRaw`: same URL
 * normalization, auth, and error contract, but sends a `FormData` body and
 * deliberately omits the `Content-Type` header so `fetch` can set the
 * correct `multipart/form-data; boundary=...` value itself — setting it
 * manually breaks the boundary and the server rejects the upload.
 */
async function vikunjaRestMultipartRequestRaw(
  authManager: AuthManager,
  method: 'POST' | 'PUT',
  path: string,
  form: FormData,
): Promise<unknown> {
  const session = authManager.getSession();
  const url = `${resolveBaseUrl(session.apiUrl)}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.apiToken}`,
      },
      body: form,
    });
  } catch (error) {
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Vikunja REST request failed (${method} ${path}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { transient: isTransientNetworkError(error) },
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // Body could not be read — fall back to the status line only.
    }
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Vikunja REST request failed (${method} ${path}): HTTP ${response.status} ${
        response.statusText
      }${detail ? ` — ${detail}` : ''}`,
      { statusCode: response.status },
    );
  }

  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // A 2xx response with a non-JSON body (rare) is treated as an empty result.
    return null;
  }
}

/**
 * Performs an authenticated multipart/form-data request against the Vikunja
 * REST API (file uploads). Shares URL normalization, auth, error contract,
 * and named circuit-breaker protection with `vikunjaRestRequest`, but does
 * NOT retry by default — see `DEFAULT_MULTIPART_RETRY` for why.
 *
 * @param authManager - Active auth manager holding the session credentials
 * @param method - HTTP method (Vikunja's attachment endpoint uses PUT)
 * @param path - API path relative to the configured apiUrl, must start with '/'
 * @param form - The multipart body to send
 * @param options - Optional breaker-name override and retry tuning
 * @returns The parsed JSON response, or null when the response has no body
 * @throws MCPError when the network call fails or the response is not OK
 */
export async function vikunjaRestMultipartRequest<T = unknown>(
  authManager: AuthManager,
  method: 'POST' | 'PUT',
  path: string,
  form: FormData,
  options?: VikunjaRestRequestOptions,
): Promise<T> {
  const breakerName = options?.breakerName ?? deriveRestBreakerName(path);
  const retryOptions: RetryOptions = {
    ...DEFAULT_MULTIPART_RETRY,
    shouldRetry: defaultRestShouldRetry,
    ...options?.retry,
  };
  const breaker = createCircuitBreaker(
    vikunjaRestMultipartRequestRaw,
    breakerName,
    retryOptions,
  );
  const result = await withRetry(
    () => breaker.fire(authManager, method, path, form),
    retryOptions,
  );
  return result as T;
}

/**
 * Minimal shape of a Vikunja project view as returned by `/projects/{id}/views`.
 */
export interface VikunjaView {
  id: number;
  title: string;
  project_id: number;
  view_kind: string;
  /**
   * The id of this view's "done" bucket. Tasks moved into this bucket are
   * marked done, and tasks marked done are moved here. `models.Bucket` has
   * no `is_done_bucket` field of its own — done-ness is a property of the
   * view, not the bucket — so callers resolve it by comparing a bucket's id
   * against this field.
   */
  done_bucket_id?: number;
}

/**
 * Resolves the Kanban view of a project.
 *
 * Vikunja projects have several views (list, gantt, table, kanban). Bucket
 * operations only make sense against the Kanban view, so callers that do not
 * already know the view id can use this to find it. Returns the full view
 * (not just its id) so callers that need `done_bucket_id` — e.g. to resolve
 * which bucket is the "done" bucket — don't have to fetch it again.
 *
 * @param authManager - Active auth manager
 * @param projectId - Project whose Kanban view should be resolved
 * @returns The project's Kanban view
 * @throws MCPError when the project has no Kanban view
 */
export async function resolveKanbanView(
  authManager: AuthManager,
  projectId: number,
): Promise<VikunjaView> {
  const views = await vikunjaRestRequest<VikunjaView[]>(
    authManager,
    'GET',
    `/projects/${projectId}/views`,
  );
  const kanban = Array.isArray(views)
    ? views.find((view) => view.view_kind === 'kanban')
    : undefined;
  if (!kanban) {
    throw new MCPError(
      ErrorCode.NOT_FOUND,
      `Project ${projectId} has no Kanban view, so it has no buckets`,
    );
  }
  return kanban;
}

/**
 * Resolves the Kanban view id for a project.
 *
 * @param authManager - Active auth manager
 * @param projectId - Project whose Kanban view should be resolved
 * @returns The numeric id of the project's Kanban view
 * @throws MCPError when the project has no Kanban view
 */
export async function resolveKanbanViewId(
  authManager: AuthManager,
  projectId: number,
): Promise<number> {
  const view = await resolveKanbanView(authManager, projectId);
  return view.id;
}
