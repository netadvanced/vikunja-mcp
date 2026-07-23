import {
  withRetry,
  isTransientError,
  RETRY_CONFIG,
  createCircuitBreaker,
  circuitBreakerRegistry,
  withNamedRetry,
  isClientErrorExcludedFromBreaker,
  rewordBreakerOpenError,
} from '../../src/utils/retry';
import { isAuthenticationError } from '../../src/utils/auth-error-handler';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/auth-error-handler', () => ({
  isAuthenticationError: jest.fn()
}));

describe('retry utility', () => {
  const mockIsAuthenticationError = isAuthenticationError as jest.MockedFunction<typeof isAuthenticationError>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsAuthenticationError.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('withRetry', () => {
    it('should return result on successful operation', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await withRetry(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on authentication error', async () => {
      const authError = new Error('Authentication failed');
      mockIsAuthenticationError.mockReturnValue(true);
      
      const operation = jest.fn()
        .mockRejectedValueOnce(authError)
        .mockRejectedValueOnce(authError)
        .mockResolvedValueOnce('success');
      
      const promise = withRetry(operation);
      
      // First retry after 1000ms
      await jest.advanceTimersByTimeAsync(1000);
      // Second retry after 2000ms (1000 * 2^1)
      await jest.advanceTimersByTimeAsync(2000);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(logger.debug).toHaveBeenCalledTimes(2);
    });

    it('should retry on transient network error', async () => {
      const networkError = new Error('ECONNRESET: connection reset');
      
      const operation = jest.fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');
      
      const promise = withRetry(operation);
      
      await jest.advanceTimersByTimeAsync(1000);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      const authError = new Error('Authentication failed');
      mockIsAuthenticationError.mockReturnValue(true);
      
      const operation = jest.fn().mockRejectedValue(authError);
      
      const promise = withRetry(operation, { maxRetries: 2 });
      
      // Handle the rejection to avoid unhandled promise rejection
      promise.catch(() => {});
      
      // First retry
      await jest.advanceTimersByTimeAsync(1000);
      // Second retry
      await jest.advanceTimersByTimeAsync(2000);
      
      await expect(promise).rejects.toThrow('Authentication failed');
      expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should not retry on non-retryable error', async () => {
      const validationError = new Error('Invalid input');
      
      const operation = jest.fn().mockRejectedValue(validationError);
      
      await expect(withRetry(operation)).rejects.toThrow('Invalid input');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use custom retry options', async () => {
      const error = new Error('Custom error');
      const customShouldRetry = jest.fn().mockReturnValue(true);
      
      const operation = jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');
      
      const promise = withRetry(operation, {
        maxRetries: 1,
        initialDelay: 500,
        maxDelay: 5000,
        backoffFactor: 3,
        shouldRetry: customShouldRetry
      });
      
      await jest.advanceTimersByTimeAsync(500);
      
      const result = await promise;
      
      expect(result).toBe('success');
      expect(customShouldRetry).toHaveBeenCalledWith(error);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should respect max delay', async () => {
      const error = new Error('Error');
      mockIsAuthenticationError.mockReturnValue(true);
      
      const operation = jest.fn().mockRejectedValue(error);
      
      const promise = withRetry(operation, {
        maxRetries: 5,
        initialDelay: 1000,
        maxDelay: 3000,
        backoffFactor: 2
      });
      
      // Handle the rejection to avoid unhandled promise rejection
      promise.catch(() => {});
      
      // Delays should be: 1000, 2000, 3000 (capped), 3000 (capped), 3000 (capped)
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(3000);
      await jest.advanceTimersByTimeAsync(3000);
      await jest.advanceTimersByTimeAsync(3000);
      
      await expect(promise).rejects.toThrow('Error');
      expect(operation).toHaveBeenCalledTimes(6); // initial + 5 retries
    });

    it('should not retry at all when maxRetries is 0', async () => {
      // Regression test: `opts.maxRetries || 3` would silently coerce an
      // explicit "don't retry" (0) back up to the default of 3, since 0 is
      // falsy. It must be treated as a real, meaningful value via `?? 3`.
      const error = new Error('Error');
      mockIsAuthenticationError.mockReturnValue(true); // would normally be retried

      const operation = jest.fn().mockRejectedValue(error);

      await expect(withRetry(operation, { maxRetries: 0 })).rejects.toThrow('Error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects', async () => {
      const stringError = 'String error';
      
      const operation = jest.fn()
        .mockRejectedValueOnce(stringError)
        .mockResolvedValueOnce('success');
      
      // String errors are not retryable by default
      await expect(withRetry(operation)).rejects.toBe('String error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should calculate exponential backoff correctly', async () => {
      const error = new Error('Error');
      mockIsAuthenticationError.mockReturnValue(true);
      
      const operation = jest.fn().mockRejectedValue(error);
      const debugCalls: any[] = [];
      
      (logger.debug as jest.Mock).mockImplementation((msg, data) => {
        debugCalls.push({ msg, data });
      });
      
      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelay: 100,
        backoffFactor: 2
      });
      
      // Handle the rejection to avoid unhandled promise rejection
      promise.catch(() => {});
      
      // First retry: 100ms
      await jest.advanceTimersByTimeAsync(100);
      expect(debugCalls[0].msg).toContain('after 100ms');
      
      // Second retry: 200ms (100 * 2^1)
      await jest.advanceTimersByTimeAsync(200);
      expect(debugCalls[1].msg).toContain('after 200ms');
      
      // Third retry: 400ms (100 * 2^2)
      await jest.advanceTimersByTimeAsync(400);
      expect(debugCalls[2].msg).toContain('after 400ms');
      
      await expect(promise).rejects.toThrow('Error');
    });
  });

  describe('isTransientError', () => {
    it('should identify timeout errors', () => {
      expect(isTransientError(new Error('Request timeout'))).toBe(true);
      expect(isTransientError(new Error('Operation timed out'))).toBe(true);
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    });

    it('should identify connection reset errors', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('Connection reset by peer'))).toBe(true);
    });

    it('should identify socket errors', () => {
      expect(isTransientError(new Error('socket hang up'))).toBe(true);
      expect(isTransientError(new Error('Socket closed unexpectedly'))).toBe(true);
    });

    it('should identify network errors', () => {
      expect(isTransientError(new Error('Network error'))).toBe(true);
      expect(isTransientError(new Error('Unable to connect to network'))).toBe(true);
    });

    it('should not identify non-transient errors', () => {
      expect(isTransientError(new Error('Invalid input'))).toBe(false);
      expect(isTransientError(new Error('Authentication failed'))).toBe(false);
      expect(isTransientError(new Error('Not found'))).toBe(false);
    });

    it('should handle non-Error objects', () => {
      expect(isTransientError('string error')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
      expect(isTransientError({})).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isTransientError(new Error('TIMEOUT'))).toBe(true);
      expect(isTransientError(new Error('Network Error'))).toBe(true);
      expect(isTransientError(new Error('SOCKET HANG UP'))).toBe(true);
    });
  });

  describe('RETRY_CONFIG', () => {
    it('should have AUTH_ERRORS configuration', () => {
      expect(RETRY_CONFIG.AUTH_ERRORS).toEqual({
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        enableCircuitBreaker: true,
        circuitBreakerName: 'vikunja-auth-connect'
      });
    });

    it('should have NETWORK_ERRORS configuration', () => {
      expect(RETRY_CONFIG.NETWORK_ERRORS).toEqual({
        maxRetries: 5,
        initialDelay: 500,
        maxDelay: 30000,
        backoffFactor: 1.5,
        enableCircuitBreaker: true,
        circuitBreakerName: 'vikunja-api-operations'
      });
    });
  });

  describe('createCircuitBreaker / circuitBreakerRegistry', () => {
    afterEach(() => {
      circuitBreakerRegistry.clear();
    });

    it('re-fires with fresh arguments on every call, unlike a closure-captured operation', async () => {
      // This is the safety property the whole module doc comment is about:
      // `action` is a STABLE function that reads its inputs from `fire(...)`
      // args, so reusing the same breaker name across many logical calls
      // never replays a stale closure's captured arguments.
      const action = jest.fn(async (x: number) => x * 2);
      const name = `test-breaker-${Math.random()}`;

      const breaker = createCircuitBreaker(action, name);
      await expect(breaker.fire(1)).resolves.toBe(2);
      await expect(breaker.fire(21)).resolves.toBe(42);

      expect(action).toHaveBeenNthCalledWith(1, 1);
      expect(action).toHaveBeenNthCalledWith(2, 21);
    });

    it('returns the cached breaker for a name that already has one, ignoring the new operation reference', () => {
      const name = `test-breaker-cache-${Math.random()}`;
      const first = createCircuitBreaker(async () => 'first', name);
      const second = createCircuitBreaker(async () => 'second', name);

      expect(second).toBe(first);
    });

    it('registers the breaker under the given name and clear() forgets it', async () => {
      const name = `test-breaker-registry-${Math.random()}`;
      expect(circuitBreakerRegistry.get(name)).toBeUndefined();

      const breaker = createCircuitBreaker(async () => 'ok', name);
      expect(circuitBreakerRegistry.get(name)).toBe(breaker);

      circuitBreakerRegistry.clear();
      expect(circuitBreakerRegistry.get(name)).toBeUndefined();

      // A fresh call with the same name after clear() creates a NEW breaker
      // instance rather than returning the shut-down one.
      const rebuilt = createCircuitBreaker(async () => 'ok', name);
      expect(rebuilt).not.toBe(breaker);
    });

    // #163: a client-side 4xx (bad bulk-create payload etc.) must not trip
    // the breaker; only 5xx / network / timeout should. This exercises the
    // breaker's `errorFilter` wiring end-to-end (not just the standalone
    // predicate below).
    it('does not open the breaker for a 4xx error, but does for a 5xx error', async () => {
      const name = `test-breaker-4xx-${Math.random()}`;
      const opts = {
        errorThresholdPercentage: 1,
        volumeThreshold: 1,
        resetTimeout: 60_000,
      };

      const makeStatusError = (status: number): Error & { status: number } =>
        Object.assign(new Error(`HTTP ${status}`), { status });

      // Three consecutive 400s never open the breaker.
      const four00Action = jest.fn(async () => {
        throw makeStatusError(400);
      });
      const four00Breaker = createCircuitBreaker(four00Action, name, opts);
      await expect(four00Breaker.fire()).rejects.toThrow('HTTP 400');
      await expect(four00Breaker.fire()).rejects.toThrow('HTTP 400');
      await expect(four00Breaker.fire()).rejects.toThrow('HTTP 400');
      // Every fire() actually invoked the action (i.e. the breaker never
      // fast-failed with its own open-circuit error).
      expect(four00Action).toHaveBeenCalledTimes(3);
      expect(four00Breaker.opened).toBe(false);

      // A 5xx against a DIFFERENT (unpolluted) breaker still opens it after
      // a single failure, same sensitivity as before this fix.
      const five00Name = `test-breaker-5xx-${Math.random()}`;
      const five00Action = jest.fn(async () => {
        throw makeStatusError(500);
      });
      const five00Breaker = createCircuitBreaker(five00Action, five00Name, opts);
      await expect(five00Breaker.fire()).rejects.toThrow('HTTP 500');
      expect(five00Breaker.opened).toBe(true);
    });
  });

  describe('isClientErrorExcludedFromBreaker (#163)', () => {
    const withStatus = (status: number): Error & { status: number } =>
      Object.assign(new Error(`status ${status}`), { status });

    it.each([400, 403, 404, 409, 422, 429, 499])(
      'excludes 4xx status %i from breaker failure accounting',
      (status) => {
        expect(isClientErrorExcludedFromBreaker(withStatus(status))).toBe(true);
      },
    );

    it('does NOT exclude 401 — auth errors are handled elsewhere and still count', () => {
      expect(isClientErrorExcludedFromBreaker(withStatus(401))).toBe(false);
    });

    it.each([500, 502, 503])(
      'does NOT exclude 5xx status %i — these are service-health signals',
      (status) => {
        expect(isClientErrorExcludedFromBreaker(withStatus(status))).toBe(false);
      },
    );

    it('does NOT exclude errors with no discoverable HTTP status (network/timeout)', () => {
      expect(isClientErrorExcludedFromBreaker(new Error('ECONNRESET'))).toBe(false);
      expect(isClientErrorExcludedFromBreaker(new Error('timeout'))).toBe(false);
    });

    it('does NOT exclude non-Error values', () => {
      expect(isClientErrorExcludedFromBreaker('nope')).toBe(false);
      expect(isClientErrorExcludedFromBreaker(null)).toBe(false);
    });

    it('reads status from `.statusCode` and `.response.status` too', () => {
      expect(
        isClientErrorExcludedFromBreaker(Object.assign(new Error('x'), { statusCode: 422 })),
      ).toBe(true);
      expect(
        isClientErrorExcludedFromBreaker(
          Object.assign(new Error('x'), { response: { status: 409 } }),
        ),
      ).toBe(true);
    });
  });

  describe('rewordBreakerOpenError (#163)', () => {
    it('rewords an opossum EOPENBREAKER error into transient-condition guidance', () => {
      const original = Object.assign(new Error('Breaker is open'), {
        code: 'EOPENBREAKER',
      });

      const reworded = rewordBreakerOpenError(original) as Error & { code?: string };

      expect(reworded).toBeInstanceOf(Error);
      expect(reworded).not.toBe(original);
      expect(reworded.code).toBe('EOPENBREAKER');
      expect(reworded.message).toMatch(/transient/i);
      expect(reworded.message).toMatch(/do not re-authenticate/i);
      expect(reworded.message).toMatch(/disconnect/i);
      // Must remain non-retryable by `isRetryableError`'s keyword scan, or an
      // open breaker would get hammered again immediately by withRetry.
      expect(reworded.message.toLowerCase()).not.toContain('timeout');
      expect(reworded.message.toLowerCase()).not.toContain('connection');
      expect(reworded.message.toLowerCase()).not.toContain('network');
      expect(reworded.message.toLowerCase()).not.toContain('rate limit');
    });

    it('passes through non-EOPENBREAKER errors unchanged', () => {
      const other = new Error('some other failure');
      expect(rewordBreakerOpenError(other)).toBe(other);

      const shutdown = Object.assign(new Error('The circuit has been shutdown.'), {
        code: 'ESHUTDOWN',
      });
      expect(rewordBreakerOpenError(shutdown)).toBe(shutdown);
    });

    it('passes through non-Error values unchanged', () => {
      expect(rewordBreakerOpenError('plain string')).toBe('plain string');
      expect(rewordBreakerOpenError(null)).toBe(null);
    });
  });

  describe('withNamedRetry breaker-open rewording (#163)', () => {
    afterEach(() => {
      circuitBreakerRegistry.clear();
    });

    it('rewords the breaker-open rejection surfaced through withNamedRetry', async () => {
      const name = `test-breaker-reword-${Math.random()}`;
      const failing = jest.fn(async () => {
        const err = Object.assign(new Error('HTTP 500'), { status: 500 });
        throw err;
      });

      const opts = { errorThresholdPercentage: 1, volumeThreshold: 1, resetTimeout: 60_000 };

      await expect(withNamedRetry(failing, name, opts)).rejects.toThrow('HTTP 500');
      // Breaker is now open; the raw opossum rejection would say "Breaker is
      // open" — withNamedRetry must surface the reworded, transient-condition
      // message instead.
      await expect(withNamedRetry(failing, name, opts)).rejects.toThrow(/transient/i);
    });
  });
});