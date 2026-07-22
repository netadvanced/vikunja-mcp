/**
 * Tests for the session capability/version detection groundwork
 * (src/utils/capabilities.ts).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  probeV2Api,
  buildCapabilities,
  detectCapabilities,
  getOrDetectCapabilities,
  resolveV2ProbeUrl,
} from '../../src/utils/capabilities';
import { AuthManager } from '../../src/auth/AuthManager';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockResponse(ok: boolean, status = 200): Response {
  return { ok, status } as unknown as Response;
}

describe('capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('resolveV2ProbeUrl', () => {
    it('replaces a /api/v1 suffix with /api/v2/openapi.json', () => {
      expect(resolveV2ProbeUrl('https://vikunja.example.com/api/v1')).toBe(
        'https://vikunja.example.com/api/v2/openapi.json',
      );
    });

    it('appends /api/v2/openapi.json when no version suffix is present', () => {
      expect(resolveV2ProbeUrl('https://vikunja.example.com')).toBe(
        'https://vikunja.example.com/api/v2/openapi.json',
      );
    });

    it('strips trailing slashes before appending', () => {
      expect(resolveV2ProbeUrl('https://vikunja.example.com/')).toBe(
        'https://vikunja.example.com/api/v2/openapi.json',
      );
    });
  });

  describe('probeV2Api', () => {
    it('returns true when the openapi probe responds 200', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, 200));
      const result = await probeV2Api('https://vikunja.example.com/api/v1');
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.example.com/api/v2/openapi.json',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false on a 404 response', async () => {
      mockFetch.mockResolvedValue(mockResponse(false, 404));
      const result = await probeV2Api('https://vikunja.example.com/api/v1');
      expect(result).toBe(false);
    });

    it('returns false and never throws on a network error', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));
      await expect(probeV2Api('https://vikunja.example.com/api/v1')).resolves.toBe(false);
    });

    it('returns false and never throws when fetch is aborted (timeout)', async () => {
      const abortError = Object.assign(new Error('This operation was aborted'), {
        name: 'AbortError',
      });
      mockFetch.mockRejectedValue(abortError);
      await expect(probeV2Api('https://vikunja.example.com/api/v1')).resolves.toBe(false);
    });

    it('returns false and never throws when fetch rejects with a non-Error value', async () => {
      mockFetch.mockRejectedValue('connection refused');
      await expect(probeV2Api('https://vikunja.example.com/api/v1')).resolves.toBe(false);
    });
  });

  describe('buildCapabilities', () => {
    it('extracts serverVersion from a present version field', () => {
      const caps = buildCapabilities({ version: '2.4.0', concurrent_writes: true }, true);
      expect(caps).toEqual({
        serverVersion: '2.4.0',
        features: { version: '2.4.0', concurrent_writes: true },
        hasV2Api: true,
      });
    });

    it('omits serverVersion when the info payload has no version field', () => {
      const caps = buildCapabilities({ concurrent_writes: true }, false);
      expect(caps.serverVersion).toBeUndefined();
      expect(caps.hasV2Api).toBe(false);
    });

    it('handles an undefined info payload', () => {
      const caps = buildCapabilities(undefined, false);
      expect(caps).toEqual({ features: {}, hasV2Api: false });
    });

    it('ignores a non-string version field', () => {
      const caps = buildCapabilities({ version: 123 }, false);
      expect(caps.serverVersion).toBeUndefined();
    });
  });

  describe('detectCapabilities', () => {
    it('probes v2 support and merges it with the info payload', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, 200));
      const caps = await detectCapabilities('https://vikunja.example.com/api/v1', {
        version: '2.4.0',
      });
      expect(caps).toEqual({
        serverVersion: '2.4.0',
        features: { version: '2.4.0' },
        hasV2Api: true,
      });
    });

    it('never throws even when the probe errors', async () => {
      mockFetch.mockRejectedValue(new Error('boom'));
      await expect(
        detectCapabilities('https://vikunja.example.com/api/v1', { version: '2.4.0' }),
      ).resolves.toEqual({
        serverVersion: '2.4.0',
        features: { version: '2.4.0' },
        hasV2Api: false,
      });
    });
  });

  describe('getOrDetectCapabilities', () => {
    let authManager: AuthManager;

    beforeEach(() => {
      authManager = new AuthManager();
      authManager.connect('https://vikunja.example.com/api/v1', 'tk_test');
    });

    it('probes and caches capabilities when none are cached yet', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, 200));
      const caps = await getOrDetectCapabilities(authManager, { version: '2.4.0' });
      expect(caps.hasV2Api).toBe(true);
      expect(caps.serverVersion).toBe('2.4.0');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(authManager.getCapabilities()).toEqual(caps);
    });

    it('reuses the cached hasV2Api probe result without re-probing', async () => {
      mockFetch.mockResolvedValue(mockResponse(true, 200));
      await getOrDetectCapabilities(authManager, { version: '2.4.0' });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call refreshes info-derived fields but must not re-probe.
      const caps = await getOrDetectCapabilities(authManager, { version: '2.4.1' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(caps).toEqual({
        serverVersion: '2.4.1',
        features: { version: '2.4.1' },
        hasV2Api: true,
      });
    });

    it('never throws when the one-time probe fails and still caches hasV2Api:false', async () => {
      mockFetch.mockRejectedValue(new Error('unreachable'));
      const caps = await getOrDetectCapabilities(authManager, { version: '2.4.0' });
      expect(caps.hasV2Api).toBe(false);
      expect(authManager.getCapabilities()?.hasV2Api).toBe(false);
    });
  });
});
