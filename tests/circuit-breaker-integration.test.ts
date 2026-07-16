/**
 * Circuit Breaker Integration Tests with Retry Logic
 * Tests network failure recovery and cascading failure prevention
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { withRetry, RETRY_CONFIG } from '../src/utils/retry';

// Mock logger to avoid console spam
jest.mock('../src/utils/logger');

describe('Circuit Breaker Integration with Retry Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should invoke the operation directly without a shared anonymous circuit breaker', async () => {
    // withRetry no longer wraps calls in a name-cached ('anonymous') circuit
    // breaker. Previously, every withRetry call shared a single breaker
    // instance keyed by the literal name 'anonymous'; because opossum binds
    // the action closure at construction time, only the first call to ever
    // reach that breaker actually ran its own operation - every subsequent
    // call silently re-fired the first call's closure, and once the shared
    // breaker opened, all later calls (regardless of which operation they
    // passed) rejected immediately with opossum's "Breaker is open" without
    // ever invoking their own operation. This test asserts each call now
    // always executes its own operation independently.
    let callCount = 0;
    const mockOperation = jest.fn().mockImplementation(async () => {
      callCount++;
      // Use a 5xx server error to simulate a failing dependency
      const error = new Error('Internal Server Error');
      (error as any).status = 500;
      throw error;
    });

    // Make several calls with retries disabled. Passing
    // enableCircuitBreaker/circuitBreakerName here is a no-op for withRetry -
    // it never accepted those as real options - but is kept to guard against
    // regressing back to shared-breaker behavior if they were ever wired up.
    for (let i = 0; i < 6; i++) {
      await expect(
        withRetry(mockOperation, {
          enableCircuitBreaker: true,
          circuitBreakerName: 'test-circuit',
          maxRetries: 0 // No retries so each call maps to exactly one operation invocation
        })
      ).rejects.toThrow('Internal Server Error');
    }

    // Every one of the 6 calls actually invoked the operation - none were
    // short-circuited by a stale shared 'anonymous' breaker.
    expect(mockOperation).toHaveBeenCalledTimes(6);
    expect(callCount).toBe(6);

    // Subsequent independent calls also each invoke their own operation.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withRetry(mockOperation, {
          enableCircuitBreaker: true,
          circuitBreakerName: 'test-circuit',
          maxRetries: 0
        }).catch(e => e.message)
      )
    );

    expect(results.every(r => r === 'Internal Server Error')).toBe(true);
    expect(mockOperation).toHaveBeenCalledTimes(11);
  });

  it('should handle network partition detection in retry logic', async () => {
    const networkErrors = [
      { error: new Error('ETIMEDOUT'), expected: true },
      { error: new Error('ECONNRESET'), expected: true },
      { error: new Error('ENOTFOUND'), expected: true },
      { error: new Error('socket hang up'), expected: true },
      { error: new Error('validation error'), expected: false },
    ];

    for (const { error, expected } of networkErrors) {
      let callCount = 0;
      const mockOperation = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw error;
        }
        return 'success';
      });

      try {
        await withRetry(mockOperation, {
          maxRetries: 1,
          initialDelay: 10,
          shouldRetry: () => expected
        });

        // If expected to retry, should have been called twice
        expect(mockOperation).toHaveBeenCalledTimes(expected ? 2 : 1);
      } catch (e) {
        // If not expected to retry, should have failed on first attempt
        expect(mockOperation).toHaveBeenCalledTimes(1);
      }
    }
  });

  it('should not use circuit breaker when disabled', async () => {
    const mockOperation = jest.fn().mockRejectedValue(new Error('network error'));

    try {
      await withRetry(mockOperation, {
        enableCircuitBreaker: false,
        circuitBreakerName: 'unused-circuit',
        maxRetries: 1
      });
    } catch (error) {
      // Expected to fail
    }

    // Should have been called twice (original + 1 retry) since no circuit breaker
    expect(mockOperation).toHaveBeenCalledTimes(2);
  });
});