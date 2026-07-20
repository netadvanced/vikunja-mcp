/**
 * Production-Ready Retry with Opossum Circuit Breaker
 * Replaces 374-line custom implementation with battle-tested patterns
 */

import CircuitBreaker from 'opossum';
import { logger } from './logger';
import { isAuthenticationError } from './auth-error-handler';

/**
 * Simple circuit breaker registry for tracking and managing circuit breakers
 *
 * NOT re-keyed by identity in `oidc-http` mode (docs/OIDC-RESOURCE-SERVER.md
 * §3d, decision D3, isolation-table row #6) — deliberately, not an
 * oversight. Breakers are keyed per-endpoint-path and protect the *one
 * shared upstream Vikunja instance*, not a per-user resource; per-`sub`
 * rate-limit buckets (`src/middleware/simplified-rate-limit.ts`) already
 * give per-user fairness independently of breaker state. One user's
 * pathological requests can still trip a breaker for everyone — an
 * accepted, honestly-documented cross-user coupling (§4), not a leak of
 * per-user data (breakers hold no credentials or user-identifiable state).
 * Revisit condition (D3): if multi-Vikunja-instance support ever lands
 * (different users' requests routing to *different* upstream Vikunja
 * instances), per-instance or per-sub breaker isolation becomes necessary.
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
    volumeThreshold: opts.volumeThreshold
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
  return breaker.fire();
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