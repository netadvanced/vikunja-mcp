/**
 * Production-Ready Retry with Opossum Circuit Breaker
 * Replaces 374-line custom implementation with battle-tested patterns
 */

import CircuitBreaker from 'opossum';
import { logger } from './logger';
import { isAuthenticationError } from './auth-error-handler';
import { extractHttpStatus } from './http-error-detail';

/**
 * Simple circuit breaker registry for tracking and managing circuit breakers
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  register(name: string, breaker: CircuitBreaker): void {
    this.breakers.set(name, breaker);
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  async resetAll(): Promise<void> {
    const promises = Array.from(this.breakers.values()).map(breaker => {
      return new Promise<void>((resolve) => {
        if (breaker.opened) {
          breaker.close();
        }
        resolve();
      });
    });
    await Promise.all(promises);
  }

  /**
   * Shuts down and forgets every registered breaker, including its
   * accumulated failure/success stats. `resetAll` only closes breakers that
   * are currently open — it leaves their rolling stats intact, so a breaker
   * that tripped once would still be closer to tripping again. Test suites
   * that exercise `vikunjaRestRequest` (which registers a real, named
   * breaker per endpoint group) need full isolation between test cases;
   * this is that reset.
   */
  clear(): void {
    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }
    this.breakers.clear();
  }

  getAllStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};
    for (const [name, breaker] of this.breakers.entries()) {
      stats[name] = breaker.stats;
    }
    return stats;
  }

  getAllStatsSync(): Record<string, unknown> {
    return this.getAllStats();
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Resolves after `ms` milliseconds, via a `setTimeout` that is `.unref()`d
 * (mirrors the pattern opossum itself uses for its own internal timers — see
 * `node_modules/opossum/lib/circuit.js`/`status.js`). `withRetry`'s
 * exponential backoff (below) is the only place this module schedules a
 * real (non-breaker-owned) timer; without `.unref()` a pending backoff delay
 * (up to `maxDelay`, 30s by default) counts as an active handle keeping the
 * process — or a `jest --runInBand` run — alive even though nothing is
 * actually waiting on it to fire. `.unref()` only affects whether the timer
 * alone can keep the event loop alive; it still fires normally and this
 * function still resolves at the same time either way.
 */
function sleepUnref(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Guards environments where `setTimeout` doesn't return an unref-able
    // handle (e.g. a DOM/browser global returning a plain number) — not
    // expected here (`testEnvironment: 'node'`), but matches opossum's own
    // defensive check rather than assuming Node's timer shape.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
}

/**
 * Interface for errors that have code properties (like Node.js system errors)
 */
interface ErrorWithCode extends Error {
  code?: string;
  status?: number;
}

/**
 * opossum's own code for a fast-failed call while the breaker is open
 * (`buildError('Breaker is open', 'EOPENBREAKER')` in `opossum/lib/circuit.js`).
 */
const OPEN_BREAKER_CODE = 'EOPENBREAKER';

/**
 * opossum `errorFilter` predicate (issue #163): decides which rejections
 * from the wrapped operation must NOT count toward tripping the circuit
 * breaker open.
 *
 * Root cause of #163: an intermittent bulk-create HTTP 400 ("Invalid model
 * provided", Vikunja error code 2004) tripped the `vikunja-rest-*` breaker
 * OPEN, after which every later create in the same session failed instantly
 * with "Breaker is open" — one client-side validation error poisoned the
 * whole session (a failing run logged ~19 such rejections; a clean run
 * logged 0).
 *
 * A CLIENT-SIDE 4xx (bad request body, forbidden, not found, conflict,
 * unprocessable entity, ...) reflects a problem with THIS call's data or
 * permissions, not the health of the Vikunja service — so it must never
 * count as a breaker "failure". Per opossum's `handleError` (`lib/circuit.js`),
 * an `errorFilter` match does not swallow the error: the caller still sees
 * the real rejection, it is just recorded as a 'success' for the breaker's
 * rolling stats instead of a 'failure'.
 *
 * 401 is deliberately EXCLUDED from this filter — i.e. it still counts
 * toward opening the breaker, unchanged from before this fix. Auth errors
 * already have dedicated handling one layer up (`isAuthenticationError` /
 * `RETRY_CONFIG.AUTH_ERRORS`), and a storm of 401s across otherwise-unrelated
 * calls (e.g. a revoked/expired session) is arguably still a "stop hammering
 * the service" signal worth tripping the breaker for. #163's evidence is
 * specifically about a data-validation 400, not auth — widening the
 * exclusion to 401 as well was deliberately left out of scope here.
 *
 * Errors with no discoverable HTTP status (network failures, timeouts,
 * `ECONNRESET`/`ETIMEDOUT`, opossum's own `ETIMEDOUT`/`ESHUTDOWN`/
 * `ESEMLOCKED`) are NOT filtered — they keep counting toward opening the
 * breaker, which is exactly the "service looks unhealthy" signal the
 * breaker exists to catch.
 */
export function isClientErrorExcludedFromBreaker(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (status === null) return false;
  if (status === 401) return false;
  return status >= 400 && status < 500;
}

/**
 * Rewords opossum's open-circuit rejection ("Breaker is open", code
 * `EOPENBREAKER`) so an agent understands it as a TRANSIENT, self-recovering
 * server-load condition rather than a hard/permanent failure.
 *
 * A live battle transcript showed an agent responding to the raw "Breaker is
 * open" message by calling `vikunja_auth disconnect` — self-sabotaging its
 * own session over a condition that resolves itself once `resetTimeout`
 * elapses and has nothing to do with authentication. The reworded message
 * explicitly tells the caller to back off and retry, and explicitly NOT to
 * re-authenticate or disconnect.
 *
 * Non-`EOPENBREAKER` errors (including opossum's other internal errors like
 * `ESHUTDOWN`/`ETIMEDOUT`/`ESEMLOCKED`, and ordinary operation failures) pass
 * through unchanged.
 */
export function rewordBreakerOpenError(error: unknown): unknown {
  if (!(error instanceof Error) || (error as ErrorWithCode).code !== OPEN_BREAKER_CODE) {
    return error;
  }

  // NOTE: deliberately avoids the substrings 'timeout', 'connection',
  // 'network', and 'rate limit' — `isRetryableError` (below) treats any of
  // those as grounds to retry, and an open breaker must NOT be retried
  // immediately (it will still be open; retrying just burns the backoff
  // delay for nothing). The original opossum message ("Breaker is open")
  // was already non-retryable for the same reason; this rewording preserves
  // that property.
  const reworded = new Error(
    'Vikunja API calls are temporarily paused after repeated recent failures ' +
      '(circuit breaker open). This is a TRANSIENT, self-recovering server-load ' +
      'condition, not an authentication or session problem — wait a bit, then ' +
      'retry the same request again. Do NOT re-authenticate, reconnect, or ' +
      'disconnect in response to this error.',
  );
  (reworded as ErrorWithCode).code = OPEN_BREAKER_CODE;
  return reworded;
}

/**
 * Simple retry configuration using opossum's built-in capabilities
 */
export interface RetryOptions {
  maxRetries?: number;
  timeout?: number;
  resetTimeout?: number;
  errorThresholdPercentage?: number;
  volumeThreshold?: number;
  shouldRetry?: (error: Error | ErrorWithCode) => boolean;
  initialDelay?: number;
  backoffFactor?: number;
  maxDelay?: number;
}

// Production-ready defaults
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry'>> = {
  maxRetries: 3,
  timeout: 30000,
  resetTimeout: 30000,
  errorThresholdPercentage: 50,
  volumeThreshold: 5,
  initialDelay: 1000,
  backoffFactor: 2,
  maxDelay: 30000
};

/**
 * Simple circuit breaker factory using opossum directly.
 *
 * `operation` MUST be a stable function reference — not a closure captured
 * per call-site invocation — because the registry caches the breaker (and
 * therefore the action it was constructed with) by `name` and returns the
 * cached instance on every subsequent call with that name, silently
 * discarding whatever `operation` was passed that time. Passing a fresh
 * closure each call under a shared/reused name was the exact bug fixed in
 * the wave0 baseline (a later call's arguments got lost, and the FIRST
 * closure ever registered under that name kept firing instead). Callers
 * that need per-call arguments must give `operation` a signature that takes
 * those arguments as parameters and pass them to `breaker.fire(...)` —
 * never bake them into the closure.
 */
export function createCircuitBreaker<TArgs extends unknown[], TR>(
  operation: (...args: TArgs) => Promise<TR>,
  name: string,
  options: RetryOptions = {}
): CircuitBreaker<TArgs, TR> {
  // Check if a circuit breaker with this name already exists
  const existingBreaker = circuitBreakerRegistry.get(name);
  if (existingBreaker) {
    return existingBreaker as unknown as CircuitBreaker<TArgs, TR>;
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const breaker = new CircuitBreaker<TArgs, TR>(operation, {
    name,
    timeout: opts.timeout,
    resetTimeout: opts.resetTimeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    volumeThreshold: opts.volumeThreshold,
    // #163: client-side 4xx responses (bad data, not found, conflict, ...)
    // must not count toward tripping this breaker — see
    // `isClientErrorExcludedFromBreaker` for the full rationale. The
    // rejection itself is unaffected; only the breaker's failure/success
    // bookkeeping changes.
    errorFilter: isClientErrorExcludedFromBreaker
  });

  // Register with the global registry
  circuitBreakerRegistry.register(name, breaker as unknown as CircuitBreaker);

  // Essential logging only
  breaker.on('open', () => logger.warn(`Circuit breaker ${name} opened`));
  breaker.on('close', () => logger.info(`Circuit breaker ${name} closed`));

  return breaker;
}

/**
 * Execute operation with automatic retry and circuit breaking
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelay || 1000;
  // `?? 3`, not `|| 3`: 0 is a meaningful, valid value ("don't retry at
  // all") and must not be coerced to the default of 3 the way `||` would.
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Execute the operation directly. Note: we intentionally do NOT wrap
      // this in a name-cached circuit breaker here. The breaker registry
      // caches breakers by name and opossum binds the action closure at
      // construction time, so a shared 'anonymous' breaker would silently
      // re-fire whichever operation first created it instead of this one.
      // Callers that want circuit-breaker semantics should use
      // withNamedRetry/withTaskRetry/withBulkRetry with a real, unique name.
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      const shouldRetry = opts.shouldRetry
        ? opts.shouldRetry(error as Error)
        : isRetryableError(error as Error);

      // If this is the last attempt or error is not retryable, throw
      if (attempt === maxRetries || !shouldRetry) {
        throw error;
      }

      // Log retry attempt
      logger.debug(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);

      // Wait before retrying with exponential backoff
      await sleepUnref(delay);
      delay = Math.min(delay * (opts.backoffFactor || 2), opts.maxDelay || 30000);
    }
  }

  throw lastError;
}

/**
 * Execute operation with named circuit breaker for stats
 */
export async function withNamedRetry<T>(
  operation: () => Promise<T>,
  name: string,
  options: RetryOptions = {}
): Promise<T> {
  const breaker = createCircuitBreaker(operation, name, options);
  try {
    return await breaker.fire();
  } catch (error) {
    throw rewordBreakerOpenError(error);
  }
}

/**
 * Alias for withNamedRetry for backward compatibility
 */
export const withCircuitBreaker = withNamedRetry;

/**
 * Get circuit breaker health stats
 */
export function getHealthStats(breaker: CircuitBreaker): CircuitBreaker.Stats {
  return breaker.stats;
}

/**
 * Check if error is retryable (basic implementation)
 */
export function isRetryableError(error: unknown): error is ErrorWithCode {
  if (error instanceof Error) {
    // Authentication errors are retryable
    if (isAuthenticationError(error)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return message.includes('timeout') ||
           message.includes('connection') ||
           message.includes('network') ||
           message.includes('rate limit') ||
           (error as ErrorWithCode).code === 'ECONNRESET' ||
           (error as ErrorWithCode).code === 'ETIMEDOUT';
  }
  return false;
}

/**
 * Check if error is transient for circuit breaker purposes
 */
export function isTransientError(error: unknown): error is ErrorWithCode {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('timeout') ||
           message.includes('timed out') ||
           message.includes('connection') ||
           message.includes('network') ||
           message.includes('rate limit') ||
           message.includes('socket') ||
           message.includes('hang up') ||
           message.includes('econnreset') ||
           message.includes('etimedout') ||
           message.includes('reset by peer') ||
           message.includes('closed unexpectedly') ||
           (error as ErrorWithCode).code === 'ECONNRESET' ||
           (error as ErrorWithCode).code === 'ETIMEDOUT';
  }
  return false;
}

/**
 * Predefined retry configurations for different operation types
 */
export const RETRY_CONFIG = {
  AUTH_ERRORS: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2,
    enableCircuitBreaker: true,
    circuitBreakerName: 'vikunja-auth-connect'
  },
  NETWORK_ERRORS: {
    maxRetries: 5,
    initialDelay: 500,
    maxDelay: 30000,
    backoffFactor: 1.5,
    enableCircuitBreaker: true,
    circuitBreakerName: 'vikunja-api-operations'
  },
  TASK_OPERATIONS: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 15000,
    backoffFactor: 2,
    enableCircuitBreaker: true,
    circuitBreakerName: 'vikunja-task-create'
  },
  BULK_OPERATIONS: {
    maxRetries: 2,
    initialDelay: 2000,
    maxDelay: 20000,
    backoffFactor: 1.5,
    enableCircuitBreaker: true,
    circuitBreakerName: 'vikunja-bulk-operations'
  }
} as const;

/**
 * Circuit breaker name constants for consistent naming across the application
 */
export const CIRCUIT_BREAKER_NAMES = {
  AUTH_CONNECT: 'vikunja-auth-connect',
  AUTH_REFRESH: 'vikunja-auth-refresh',
  AUTH_STATUS: 'vikunja-auth-status',
  API_OPERATIONS: 'vikunja-api-operations',
  CLIENT_OPERATIONS: 'vikunja-client-operations',
  FILTER_OPERATIONS: 'vikunja-filter-operations',
  TASK_CREATE: 'vikunja-task-create',
  TASK_UPDATE: 'vikunja-task-update',
  TASK_DELETE: 'vikunja-task-delete',
  TASK_GET: 'vikunja-task-get',
  TASK_LIST: 'vikunja-task-list',
  TASK_RELATIONS: 'vikunja-task-relations',
  TASK_ASSIGNEES: 'vikunja-task-assignees',
  TASK_LABELS: 'vikunja-task-labels',
  PROJECT_CRUD: 'vikunja-project-crud',
  PROJECT_HIERARCHY: 'vikunja-project-hierarchy',
  PROJECT_SHARING: 'vikunja-project-sharing',
  BULK_OPERATIONS: 'vikunja-bulk-operations',
  BULK_IMPORT: 'vikunja-bulk-import',
  BULK_EXPORT: 'vikunja-bulk-export'
} as const;

/**
 * Execute task operations with task-specific circuit breaker
 */
export async function withTaskRetry<T>(
  operation: () => Promise<T>,
  operationType: 'create' | 'update' | 'delete' | 'get',
  options: RetryOptions = {}
): Promise<T> {
  const name = `vikunja-task-${operationType}`;
  return withNamedRetry(operation, name, options);
}

/**
 * Execute bulk operations with bulk-specific circuit breaker
 */
export async function withBulkRetry<T>(
  operation: () => Promise<T>,
  operationType: 'import' | 'export',
  options: RetryOptions = {}
): Promise<T> {
  const name = `vikunja-bulk-${operationType}`;
  return withNamedRetry(operation, name, options);
}