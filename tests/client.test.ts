/**
 * Tests for the session-only ClientContext and its convenience functions.
 *
 * The legacy typed-client surface (getClient / client caching / dynamic
 * node-vikunja import) was removed when the upstream client library was
 * retired. ClientContext now only tracks the active session factory and hands
 * its {@link AuthManager} to the direct-REST transport. These tests cover the
 * remaining surface: singleton access, thread-safe factory management, the
 * AuthManager accessor, the global convenience functions, and
 * createVikunjaClientFactory.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AuthManager } from '../src/auth/AuthManager';
import {
  ClientContext,
  getAuthManagerFromContext,
  setGlobalClientFactory,
  clearGlobalClientFactory,
  createVikunjaClientFactory,
  VikunjaClientFactory,
} from '../src/client';

describe('Async-Only Client Context Operations', () => {
  let authManager: AuthManager;
  let factory: VikunjaClientFactory;

  beforeEach(() => {
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
    factory = new VikunjaClientFactory(authManager);

    // Reset singleton instance
    (ClientContext as unknown as { instance: ClientContext | null }).instance = null;
  });

  afterEach(() => {
    (ClientContext as unknown as { instance: ClientContext | null }).instance = null;
  });

  describe('getInstanceAsync', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await ClientContext.getInstanceAsync();
      const instance2 = await ClientContext.getInstanceAsync();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(ClientContext);
    });

    it('should be thread-safe under concurrent access', async () => {
      const promises = Array.from({ length: 100 }, () => ClientContext.getInstanceAsync());
      const instances = await Promise.all(promises);

      const firstInstance = instances[0];
      expect(instances.every(instance => instance === firstInstance)).toBe(true);
    });

    it('should create only one instance even with rapid concurrent calls', async () => {
      (ClientContext as unknown as { instance: ClientContext | null }).instance = null;

      const promises = Array.from({ length: 50 }, () => ClientContext.getInstanceAsync());
      const instances = await Promise.all(promises);

      const firstInstance = instances[0];
      expect(instances.every(instance => instance === firstInstance)).toBe(true);

      const uniqueInstances = new Set(instances);
      expect(uniqueInstances.size).toBe(1);
    });
  });

  describe('Thread-safe factory management', () => {
    let clientContext: ClientContext;

    beforeEach(async () => {
      clientContext = await ClientContext.getInstanceAsync();
    });

    it('should get the AuthManager from the active factory', async () => {
      await clientContext.setClientFactory(factory);
      const resolved = await clientContext.getAuthManager();

      expect(resolved).toBe(authManager);
    });

    it('should throw when getting the AuthManager without a factory', async () => {
      await expect(clientContext.getAuthManager()).rejects.toThrow('Authentication required');
    });

    it('should throw after the factory is cleared', async () => {
      await clientContext.setClientFactory(factory);
      await clientContext.clearClientFactory();

      await expect(clientContext.getAuthManager()).rejects.toThrow('Authentication required');
    });

    it('should get the AuthManager via the getAuthManagerFromContext convenience function', async () => {
      await clientContext.setClientFactory(factory);
      const resolved = await getAuthManagerFromContext();

      expect(resolved).toBe(authManager);
    });

    it('should check factory availability asynchronously', async () => {
      expect(await clientContext.hasFactory()).toBe(false);

      await clientContext.setClientFactory(factory);
      expect(await clientContext.hasFactory()).toBe(true);

      await clientContext.clearClientFactory();
      expect(await clientContext.hasFactory()).toBe(false);
    });

    it('should handle concurrent factory operations safely', async () => {
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < 10; i++) {
        promises.push(clientContext.setClientFactory(factory));
      }
      for (let i = 0; i < 10; i++) {
        promises.push(clientContext.hasFactory());
      }
      for (let i = 0; i < 10; i++) {
        promises.push(clientContext.getAuthManager());
      }

      await expect(Promise.all(promises)).resolves.toBeDefined();
      expect(await clientContext.hasFactory()).toBe(true);
      expect(await clientContext.getAuthManager()).toBe(authManager);
    });

    it('should handle mixed concurrent operations without race conditions', async () => {
      const operations = Array.from({ length: 50 }, async (_, i) => {
        switch (i % 4) {
          case 0:
            await clientContext.setClientFactory(factory);
            return 'set';
          case 1:
            return await clientContext.hasFactory();
          case 2:
            await clientContext.clearClientFactory();
            return 'cleared';
          case 3:
            return await clientContext.hasFactory();
          default:
            return 'unknown';
        }
      });

      const operationResults = await Promise.all(operations);
      expect(operationResults).toHaveLength(50);
      const finalState = await clientContext.hasFactory();
      expect(typeof finalState).toBe('boolean');
    });
  });

  describe('Global async convenience functions', () => {
    it('should set the global factory and expose its AuthManager', async () => {
      await setGlobalClientFactory(factory);
      const resolved = await getAuthManagerFromContext();

      expect(resolved).toBe(authManager);
    });

    it('should clear the global factory asynchronously', async () => {
      await setGlobalClientFactory(factory);
      await clearGlobalClientFactory();

      await expect(getAuthManagerFromContext()).rejects.toThrow('Authentication required');
    });

    it('should maintain singleton behavior across global operations', async () => {
      await setGlobalClientFactory(factory);

      const first = await getAuthManagerFromContext();
      const second = await getAuthManagerFromContext();

      expect(first).toBe(second);
      expect(first).toBe(authManager);
    });

    it('should handle concurrent global operations safely', async () => {
      const promises = Array.from({ length: 20 }, async (_, i) => {
        if (i % 3 === 0) {
          await setGlobalClientFactory(factory);
        } else if (i % 3 === 1) {
          return await clientContextSafeGetAuthManager();
        } else {
          await clearGlobalClientFactory();
        }
        return 'completed';
      });

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    // The global factory may be cleared by a racing operation, so tolerate the
    // auth-required rejection instead of failing the whole batch.
    async function clientContextSafeGetAuthManager(): Promise<unknown> {
      try {
        return await getAuthManagerFromContext();
      } catch {
        return 'no-factory';
      }
    }
  });

  describe('createVikunjaClientFactory', () => {
    it('resolves a VikunjaClientFactory bound to the given AuthManager', async () => {
      const created = await createVikunjaClientFactory(authManager);

      expect(created).toBeInstanceOf(VikunjaClientFactory);
      expect(created.getAuthManager()).toBe(authManager);
    });

    it('creates a distinct factory instance per call', async () => {
      const a = await createVikunjaClientFactory(authManager);
      const b = await createVikunjaClientFactory(authManager);

      expect(a).not.toBe(b);
      expect(a.getAuthManager()).toBe(b.getAuthManager());
    });
  });

  describe('Race condition prevention', () => {
    it('should prevent race conditions during factory assignment', async () => {
      const context = await ClientContext.getInstanceAsync();

      await Promise.all([
        context.setClientFactory(factory),
        context.setClientFactory(factory),
        context.setClientFactory(factory),
      ]);

      expect(await context.hasFactory()).toBe(true);
      expect(await context.getAuthManager()).toBe(authManager);
    });

    it('should handle rapid clear/set operations safely', async () => {
      const context = await ClientContext.getInstanceAsync();

      const operations = Array.from({ length: 20 }, async (_, i) => {
        if (i % 2 === 0) {
          await context.setClientFactory(factory);
        } else {
          await context.clearClientFactory();
        }
      });

      await Promise.all(operations);

      const finalState = await context.hasFactory();
      expect(typeof finalState).toBe('boolean');
    });

    it('should maintain shared state between references to the singleton', async () => {
      const context1 = await ClientContext.getInstanceAsync();
      const context2 = await ClientContext.getInstanceAsync();

      expect(context1).toBe(context2);

      await context1.setClientFactory(factory);

      expect(await context1.hasFactory()).toBe(true);
      expect(await context2.hasFactory()).toBe(true);
    });
  });
});
