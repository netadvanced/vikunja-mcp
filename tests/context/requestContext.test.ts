/**
 * Tests for the per-request identity ALS context
 * (docs/OIDC-RESOURCE-SERVER.md §3d, D6).
 */

import { AuthManager } from '../../src/auth/AuthManager';
import {
  identityKey,
  runWithRequestContext,
  getRequestContext,
  getCurrentIdentity,
  getEffectiveSessionId,
  type Identity,
} from '../../src/context/requestContext';

describe('identityKey', () => {
  it('joins issuer and sub with a pipe, matching the vault record key shape (§3c)', () => {
    expect(identityKey({ issuer: 'https://idp.example/realm', sub: 'user-a' })).toBe(
      'https://idp.example/realm|user-a',
    );
  });

  it('produces distinct keys for distinct subs under the same issuer', () => {
    const a = identityKey({ issuer: 'https://idp.example', sub: 'alice' });
    const b = identityKey({ issuer: 'https://idp.example', sub: 'bob' });
    expect(a).not.toBe(b);
  });

  it('produces distinct keys for the same sub under distinct issuers (D11 pair-keying)', () => {
    const a = identityKey({ issuer: 'https://idp-one.example', sub: 'user-1' });
    const b = identityKey({ issuer: 'https://idp-two.example', sub: 'user-1' });
    expect(a).not.toBe(b);
  });
});

describe('getRequestContext / getCurrentIdentity outside any ALS scope (stdio mode)', () => {
  it('return undefined when no ALS scope has ever been opened', () => {
    // This is the stdio-mode invariant: no request context ever exists, not
    // merely "isn't used". `stdio` mode never calls `runWithRequestContext`.
    expect(getRequestContext()).toBeUndefined();
    expect(getCurrentIdentity()).toBeUndefined();
  });
});

const identityA: Identity = { issuer: 'https://idp.example', sub: 'user-a' };

describe('runWithRequestContext', () => {
  it('makes the bound context visible to getRequestContext/getCurrentIdentity inside the callback', () => {
    const authManager = new AuthManager();
    authManager.connect('https://vikunja.example/api/v1', 'tk_a');

    const observed = runWithRequestContext({ identity: identityA, authManager }, () => {
      return {
        context: getRequestContext(),
        identity: getCurrentIdentity(),
      };
    });

    expect(observed.context?.identity).toEqual(identityA);
    expect(observed.context?.authManager).toBe(authManager);
    expect(observed.identity).toEqual(identityA);
  });

  it('is not visible after the callback returns', () => {
    const authManager = new AuthManager();
    authManager.connect('https://vikunja.example/api/v1', 'tk_a');

    runWithRequestContext({ identity: identityA, authManager }, () => undefined);

    expect(getRequestContext()).toBeUndefined();
    expect(getCurrentIdentity()).toBeUndefined();
  });

  it('is visible across an awaited async boundary inside the same scope', async () => {
    const authManager = new AuthManager();
    authManager.connect('https://vikunja.example/api/v1', 'tk_a');

    const identity = await runWithRequestContext({ identity: identityA, authManager }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getCurrentIdentity();
    });

    expect(identity).toEqual(identityA);
  });

  it('nested scopes: the inner identity wins for the duration of the inner callback, outer resumes after', () => {
    const identityB: Identity = { issuer: 'https://idp.example', sub: 'user-b' };
    const authManagerA = new AuthManager();
    authManagerA.connect('https://vikunja.example/api/v1', 'tk_a');
    const authManagerB = new AuthManager();
    authManagerB.connect('https://vikunja.example/api/v1', 'tk_b');

    const seen: (Identity | undefined)[] = [];

    runWithRequestContext({ identity: identityA, authManager: authManagerA }, () => {
      seen.push(getCurrentIdentity());
      runWithRequestContext({ identity: identityB, authManager: authManagerB }, () => {
        seen.push(getCurrentIdentity());
      });
      seen.push(getCurrentIdentity());
    });

    expect(seen).toEqual([identityA, identityB, identityA]);
  });
});

describe('getEffectiveSessionId', () => {
  it('falls back to the legacy apiUrl+token-prefix derivation outside an ALS scope (stdio mode, unchanged)', () => {
    const authManager = new AuthManager();
    authManager.connect('https://vikunja.example/api/v1', 'tk_abcdefgh12345');

    expect(getEffectiveSessionId(authManager)).toBe('https://vikunja.example/api/v1:tk_abcde');
  });

  it("falls back to 'anonymous' outside an ALS scope when the session has no apiToken", () => {
    const authManager = new AuthManager();
    // saveSession bypasses connect()'s auto-detection so apiToken can be
    // falsy — exercises the ternary's other branch.
    authManager.saveSession({
      apiUrl: 'https://vikunja.example/api/v1',
      apiToken: '',
      authType: 'api-token',
    });

    expect(getEffectiveSessionId(authManager)).toBe('anonymous');
  });

  it('returns the identity key inside an ALS scope, ignoring the legacy derivation entirely', () => {
    const authManager = new AuthManager();
    authManager.connect('https://vikunja.example/api/v1', 'tk_abcdefgh12345');

    const sessionId = runWithRequestContext({ identity: identityA, authManager }, () =>
      getEffectiveSessionId(authManager),
    );

    expect(sessionId).toBe(identityKey(identityA));
    expect(sessionId).not.toBe('https://vikunja.example/api/v1:tk_abcdef');
  });
});
