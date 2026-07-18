/**
 * Tests for VikunjaClientFactory - session-holding factory.
 *
 * The legacy typed-client surface (client creation, caching, dynamic import)
 * was retired when node-vikunja was removed; the factory now only owns the
 * session's {@link AuthManager} and exposes it to the direct-REST transport.
 */

import { describe, it, expect } from '@jest/globals';
import { VikunjaClientFactory } from '../../src/client/VikunjaClientFactory';
import { AuthManager } from '../../src/auth/AuthManager';

describe('VikunjaClientFactory', () => {
  const connectedAuthManager = (): AuthManager => {
    const am = new AuthManager();
    am.connect('https://vikunja.test', 'tk_test-token');
    return am;
  };

  describe('constructor', () => {
    it('accepts a single AuthManager argument', () => {
      expect(() => new VikunjaClientFactory(connectedAuthManager())).not.toThrow();
    });
  });

  describe('getAuthManager', () => {
    it('returns the AuthManager passed into the constructor', () => {
      const authManager = connectedAuthManager();
      const factory = new VikunjaClientFactory(authManager);

      expect(factory.getAuthManager()).toBe(authManager);
    });

    it('returns the same AuthManager instance on repeated calls', () => {
      const authManager = connectedAuthManager();
      const factory = new VikunjaClientFactory(authManager);

      expect(factory.getAuthManager()).toBe(factory.getAuthManager());
    });
  });

  describe('hasValidSession', () => {
    it('returns true when the AuthManager has a live session', () => {
      const factory = new VikunjaClientFactory(connectedAuthManager());

      expect(factory.hasValidSession()).toBe(true);
    });

    it('returns false when getSession throws (no session)', () => {
      // A fresh, unconnected AuthManager throws from getSession().
      const factory = new VikunjaClientFactory(new AuthManager());

      expect(factory.hasValidSession()).toBe(false);
    });

    it('does not throw when the session is invalid', () => {
      const factory = new VikunjaClientFactory(new AuthManager());

      expect(() => factory.hasValidSession()).not.toThrow();
    });

    it('reflects a session that is cleared after construction', () => {
      const authManager = connectedAuthManager();
      const factory = new VikunjaClientFactory(authManager);

      expect(factory.hasValidSession()).toBe(true);

      authManager.disconnect();
      expect(factory.hasValidSession()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('is a no-op that never throws', () => {
      const factory = new VikunjaClientFactory(connectedAuthManager());

      expect(() => factory.cleanup()).not.toThrow();
    });

    it('leaves the session and AuthManager intact', () => {
      const authManager = connectedAuthManager();
      const factory = new VikunjaClientFactory(authManager);

      factory.cleanup();

      expect(factory.getAuthManager()).toBe(authManager);
      expect(factory.hasValidSession()).toBe(true);
    });

    it('tolerates repeated calls', () => {
      const factory = new VikunjaClientFactory(connectedAuthManager());

      expect(() => {
        factory.cleanup();
        factory.cleanup();
        factory.cleanup();
      }).not.toThrow();
    });
  });
});
