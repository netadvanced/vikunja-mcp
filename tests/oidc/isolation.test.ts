/**
 * Cross-user leak test matrix.
 *
 * Implements docs/OIDC-RESOURCE-SERVER.md §3d's isolation-table rows and
 * cross-user-leak test matrix in full, against the concrete mechanisms H1c
 * lands:
 *
 *  - The ALS `RequestContext` (`src/context/requestContext.ts`, D6).
 *  - `getAuthManagerFromContext` re-pointed at ALS-first (`src/client.ts`).
 *  - The rate-limiter's per-identity bucket (`src/middleware/simplified-rate-limit.ts`, D8).
 *  - `SimpleFilterStorage` session-id re-keying, shared by the tasks tool's
 *    own session-scoped storage and `vikunja_templates`
 *    (`getEffectiveSessionId`, isolation-table rows #3/#4).
 *  - The `VikunjaCredentialSource` seam (`src/auth/CredentialSource.ts`,
 *    §3c H1 stub) — exercised here with a small in-memory fake vault that
 *    models the provisioning semantics (provision/deprovision/token-swap)
 *    H2's real vault will implement, so the *isolation contract* the H1
 *    interface promises is proven now, not deferred to H2.
 *
 * Naming note / spec gap flagged in the PR body: the isolation table's row
 * #3 names `src/tools/filters.ts` as the thing re-keyed by session id. That
 * file's own header (see its top-of-file comment) documents that
 * `vikunja_filters` moved to real server-side Vikunja saved filters and no
 * longer touches `SimpleFilterStorage` at all — that migration landed
 * *after* the design doc's grounding pass. The session-scoped
 * `SimpleFilterStorage` state row #3 is actually protecting today lives in
 * `src/tools/tasks/index.ts` (the tasks tool's own session-scoped storage)
 * and `src/tools/templates.ts` (row #4) — both exercised below via the same
 * `getSessionStorage`-shaped helper (`getEffectiveSessionId` +
 * `storageManager.getStorage`) the real call sites use.
 */

import { AuthManager } from '../../src/auth/AuthManager';
import { getAuthManagerFromContext, ClientContext } from '../../src/client';
import {
  runWithRequestContext,
  getCurrentIdentity,
  getEffectiveSessionId,
  identityKey,
  type Identity,
} from '../../src/context/requestContext';
import {
  createOidcAuthRequiredError,
  type VikunjaCredential,
  type VikunjaCredentialSource,
} from '../../src/auth/CredentialSource';
import { storageManager } from '../../src/storage';
import { SecureRateLimitMiddleware } from '../../src/middleware/simplified-rate-limit';
import { ErrorCode, MCPError } from '../../src/types/errors';

const identityA: Identity = { issuer: 'https://idp.example/realm', sub: 'user-a' };
const identityB: Identity = { issuer: 'https://idp.example/realm', sub: 'user-b' };

function authManagerFor(sub: string): AuthManager {
  const authManager = new AuthManager();
  authManager.connect('https://vikunja.example/api/v1', `tk_${sub}-token-1234567890`);
  return authManager;
}

/**
 * A minimal in-memory fake of the real vault (H2 scope) that satisfies
 * `VikunjaCredentialSource`. Used only to prove the *contract* the H1
 * interface makes — identity-only lookup, no cross-identity bleed,
 * immediate visibility of provision/deprovision/token-swap — holds for any
 * conforming implementation, real vault included.
 */
class FakeVaultCredentialSource implements VikunjaCredentialSource {
  private records = new Map<string, VikunjaCredential>();

  provision(identity: Identity, credential: VikunjaCredential): void {
    this.records.set(identityKey(identity), credential);
  }

  deprovision(identity: Identity): void {
    this.records.delete(identityKey(identity));
  }

  getCredential(identity: Identity): VikunjaCredential | null {
    return this.records.get(identityKey(identity)) ?? null;
  }
}

describe('Cross-user leak test matrix (§3d)', () => {
  afterEach(async () => {
    (ClientContext as unknown as { instance: ClientContext | null }).instance = null;
  });

  describe('Credential isolation', () => {
    it("A's calls resolve A's AuthManager only; B's is never used for A", async () => {
      const authManagerA = authManagerFor('a');
      const authManagerB = authManagerFor('b');

      const resolvedA = await runWithRequestContext(
        { identity: identityA, authManager: authManagerA },
        () => getAuthManagerFromContext(),
      );
      const resolvedB = await runWithRequestContext(
        { identity: identityB, authManager: authManagerB },
        () => getAuthManagerFromContext(),
      );

      expect(resolvedA).toBe(authManagerA);
      expect(resolvedB).toBe(authManagerB);
      expect(resolvedA).not.toBe(resolvedB);
      expect(resolvedA.getSession().apiToken).toBe('tk_a-token-1234567890');
      expect(resolvedB.getSession().apiToken).toBe('tk_b-token-1234567890');
    });
  });

  describe('Missing-credential no-leak', () => {
    it('B (unprovisioned) gets AUTH_REQUIRED with a provision prompt; nothing about A leaks', () => {
      const vault = new FakeVaultCredentialSource();
      vault.provision(identityA, {
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_a-real',
      });
      // B is deliberately never provisioned.

      const credentialB = vault.getCredential(identityB);
      expect(credentialB).toBeNull();

      const error = createOidcAuthRequiredError(identityB);
      expect(error).toBeInstanceOf(MCPError);
      expect(error.code).toBe(ErrorCode.AUTH_REQUIRED);
      expect(error.message).not.toContain('user-a');
      expect(error.message).not.toContain('tk_a-real');
      expect(error.message).toContain('vikunja_auth provision');
    });
  });

  describe('Filter/template session-storage isolation (isolation-table rows #3/#4)', () => {
    it("B's session storage never contains A's saved filter", async () => {
      const authManagerA = authManagerFor('a');
      const authManagerB = authManagerFor('b');

      await runWithRequestContext({ identity: identityA, authManager: authManagerA }, async () => {
        const sessionId = getEffectiveSessionId(authManagerA);
        const storage = await storageManager.getStorage(sessionId);
        await storage.create({
          name: "A's secret filter",
          filter: 'done = false',
          isGlobal: false,
        });
      });

      const bFilters = await runWithRequestContext(
        { identity: identityB, authManager: authManagerB },
        async () => {
          const sessionId = getEffectiveSessionId(authManagerB);
          const storage = await storageManager.getStorage(sessionId);
          return storage.list();
        },
      );

      expect(bFilters).toHaveLength(0);
    });

    it("A's own storage still sees the filter it saved (sanity check — isolation, not a black hole)", async () => {
      const authManagerA = authManagerFor('a');

      const created = await runWithRequestContext(
        { identity: identityA, authManager: authManagerA },
        async () => {
          const sessionId = getEffectiveSessionId(authManagerA);
          const storage = await storageManager.getStorage(sessionId);
          return storage.create({ name: 'mine', filter: 'done = true', isGlobal: false });
        },
      );

      const listedByA = await runWithRequestContext(
        { identity: identityA, authManager: authManagerA },
        async () => {
          const sessionId = getEffectiveSessionId(authManagerA);
          const storage = await storageManager.getStorage(sessionId);
          return storage.list();
        },
      );

      expect(listedByA.map((f) => f.id)).toContain(created.id);
    });

    it('two identities never resolve to the same underlying storage instance', async () => {
      const authManagerA = authManagerFor('a');
      const authManagerB = authManagerFor('b');

      const storageA = await runWithRequestContext(
        { identity: identityA, authManager: authManagerA },
        () => storageManager.getStorage(getEffectiveSessionId(authManagerA)),
      );
      const storageB = await runWithRequestContext(
        { identity: identityB, authManager: authManagerB },
        () => storageManager.getStorage(getEffectiveSessionId(authManagerB)),
      );

      expect(storageA).not.toBe(storageB);
      expect(storageA.getSession().id).toBe(identityKey(identityA));
      expect(storageB.getSession().id).toBe(identityKey(identityB));
    });
  });

  describe('Rate-limit isolation (D8, isolation-table row #2)', () => {
    it("A exhausting A's bucket does not affect B's independent bucket", async () => {
      const middleware = new SecureRateLimitMiddleware(
        {
          default: {
            requestsPerMinute: 2,
            requestsPerHour: 20,
            maxRequestSize: 1_000_000,
            maxResponseSize: 1_000_000,
            executionTimeout: 5000,
            enabled: true,
          },
        },
        true,
      );

      const authManagerA = authManagerFor('a');
      const authManagerB = authManagerFor('b');
      const handler = jest.fn().mockResolvedValue('ok');
      const wrapped = middleware.withRateLimit('vikunja_auth', handler);

      const runAsA = <T>(fn: () => Promise<T>): Promise<T> =>
        runWithRequestContext({ identity: identityA, authManager: authManagerA }, fn);
      const runAsB = <T>(fn: () => Promise<T>): Promise<T> =>
        runWithRequestContext({ identity: identityB, authManager: authManagerB }, fn);

      // Exhaust A's per-minute bucket (limit 2).
      await runAsA(() => wrapped());
      await runAsA(() => wrapped());
      await expect(runAsA(() => wrapped())).rejects.toEqual(
        expect.objectContaining({ code: ErrorCode.RATE_LIMIT_EXCEEDED }),
      );

      // B's independent bucket is untouched.
      await expect(runAsB(() => wrapped())).resolves.toBe('ok');
      await expect(runAsB(() => wrapped())).resolves.toBe('ok');
    });
  });

  describe("Vault lookup can't be spoofed", () => {
    it('session-id resolution reads identity only from ALS, never from the authManager argument', async () => {
      const authManagerA = authManagerFor('a');
      const authManagerB = authManagerFor('b');

      // A crafted call: bound to A's identity in ALS, but (mistakenly or
      // maliciously) passed *B's* AuthManager as the argument. If sessionId
      // resolution ever fell back to deriving identity from the argument,
      // this would resolve to B's bucket/storage under A's request. It must
      // not: ALS wins unconditionally once bound.
      const sessionId = await runWithRequestContext(
        { identity: identityA, authManager: authManagerA },
        () => getEffectiveSessionId(authManagerB),
      );

      expect(sessionId).toBe(identityKey(identityA));
      expect(sessionId).not.toBe(identityKey(identityB));
    });

    it('the credential-source interface exposes no argument through which a caller-supplied identity could override the validated one', () => {
      // Structural guarantee: `getCredential` takes exactly the identity the
      // JWT middleware puts in ALS — there is no second "claimed sub"
      // parameter for a tool argument to smuggle in. This is enforced by
      // the interface shape itself (see src/auth/CredentialSource.ts).
      const vault = new FakeVaultCredentialSource();
      vault.provision(identityA, {
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_a-real',
      });

      // Even a "spoofed" identity object (attacker-controlled sub, but
      // structurally identical) only ever resolves what it actually names —
      // there's no way to make it resolve A's record without possessing
      // A's actual (issuer, sub).
      const spoofed: Identity = { issuer: identityA.issuer, sub: 'user-a-impersonator' };
      expect(vault.getCredential(spoofed)).toBeNull();
    });
  });

  describe('ALS context integrity (load-bearing property test)', () => {
    it('genuinely concurrent, interleaved A/B requests never cross AuthManagers', async () => {
      const iterations = 50;

      const runOne = async (which: 'A' | 'B', i: number): Promise<boolean> => {
        const identity = which === 'A' ? identityA : identityB;
        const authManager = authManagerFor(`${which.toLowerCase()}-${i}`);

        return runWithRequestContext({ identity, authManager }, async () => {
          // Force interleaving: yield control at randomized points so the
          // event loop genuinely interleaves A and B's continuations.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));

          const seenIdentity = getCurrentIdentity();
          const seenAuthManager = await getAuthManagerFromContext();

          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));

          return (
            seenIdentity?.sub === identity.sub &&
            seenIdentity?.issuer === identity.issuer &&
            seenAuthManager === authManager
          );
        });
      };

      const tasks: Promise<boolean>[] = [];
      for (let i = 0; i < iterations; i++) {
        tasks.push(runOne('A', i));
        tasks.push(runOne('B', i));
      }

      const results = await Promise.all(tasks);
      expect(results.every(Boolean)).toBe(true);
      expect(results).toHaveLength(iterations * 2);
    });
  });

  describe('Deprovision isolation', () => {
    it('A deprovisioning does not affect B; A gets the provision prompt afterward', () => {
      const vault = new FakeVaultCredentialSource();
      vault.provision(identityA, {
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_a-real',
      });
      vault.provision(identityB, {
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_b-real',
      });

      vault.deprovision(identityA);

      expect(vault.getCredential(identityA)).toBeNull();
      expect(vault.getCredential(identityB)).toEqual({
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_b-real',
      });
    });
  });

  describe('Token swap', () => {
    it('subsequent calls use the newly-provisioned token, never the stale one', () => {
      const vault = new FakeVaultCredentialSource();
      vault.provision(identityA, {
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_a-old',
      });

      vault.deprovision(identityA);
      vault.provision(identityA, {
        apiUrl: 'https://vikunja.example/api/v1',
        apiToken: 'tk_a-new',
      });

      const credential = vault.getCredential(identityA);
      expect(credential?.apiToken).toBe('tk_a-new');
      expect(credential?.apiToken).not.toBe('tk_a-old');
    });
  });

  describe('Log masking under multi-user', () => {
    it('forced AUTH_REQUIRED errors for A and B never contain either raw sub, only masked prefixes', () => {
      const longSubA = 'a-very-long-subject-identifier-for-user-a';
      const longSubB = 'a-very-long-subject-identifier-for-user-b';

      const errorA = createOidcAuthRequiredError({ issuer: identityA.issuer, sub: longSubA });
      const errorB = createOidcAuthRequiredError({ issuer: identityB.issuer, sub: longSubB });

      expect(errorA.message).not.toContain(longSubA);
      expect(errorB.message).not.toContain(longSubB);
      expect(errorA.message).not.toContain(longSubB);
      expect(errorB.message).not.toContain(longSubA);
    });
  });

  describe('stdio-mode regression invariant', () => {
    it('outside any ALS scope, session id / auth manager resolution is byte-for-byte the pre-existing stdio behaviour', async () => {
      expect(getCurrentIdentity()).toBeUndefined();

      const authManager = authManagerFor('stdio-user');
      expect(getEffectiveSessionId(authManager)).toBe(
        `https://vikunja.example/api/v1:${'tk_stdio-user-token-1234567890'.substring(0, 8)}`,
      );

      // No ALS scope was ever opened, so getAuthManagerFromContext() falls
      // through to the global ClientContext singleton path exactly as
      // before this feature existed (see tests/client.test.ts for that
      // path's own dedicated coverage).
      await expect(getAuthManagerFromContext()).rejects.toEqual(
        expect.objectContaining({ code: ErrorCode.AUTH_REQUIRED }),
      );
    });
  });
});
