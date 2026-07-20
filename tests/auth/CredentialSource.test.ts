/**
 * Tests for the identity -> Vikunja-credential seam
 * (docs/OIDC-RESOURCE-SERVER.md §3c/§3d — H1 scope: interface + stdio
 * implementation + oidc-mode stub; H2 plugs in the real vault).
 */

import { ErrorCode } from '../../src/types/errors';
import type { Identity } from '../../src/context/requestContext';
import {
  StdioCredentialSource,
  OidcStubCredentialSource,
  createOidcAuthRequiredError,
  type VikunjaCredential,
} from '../../src/auth/CredentialSource';

const identityA: Identity = { issuer: 'https://idp.example', sub: 'user-a' };
const identityB: Identity = { issuer: 'https://idp.example', sub: 'user-b' };

describe('StdioCredentialSource', () => {
  it('returns the one configured credential regardless of identity', () => {
    const credential: VikunjaCredential = {
      apiUrl: 'https://vikunja.example/api/v1',
      apiToken: 'tk_static',
    };
    const source = new StdioCredentialSource(credential);

    expect(source.getCredential(identityA)).toBe(credential);
    expect(source.getCredential(identityB)).toBe(credential);
  });

  it('returns null when constructed with no credential (unauthenticated stdio process)', () => {
    const source = new StdioCredentialSource(null);
    expect(source.getCredential(identityA)).toBeNull();
  });
});

describe('OidcStubCredentialSource', () => {
  it('always returns null — H1 has no vault yet, every identity is unprovisioned', () => {
    const source = new OidcStubCredentialSource();
    expect(source.getCredential(identityA)).toBeNull();
    expect(source.getCredential(identityB)).toBeNull();
  });
});

describe('createOidcAuthRequiredError', () => {
  it('produces a structured AUTH_REQUIRED error pointing at vikunja_auth provision', () => {
    const error = createOidcAuthRequiredError(identityA);
    expect(error.code).toBe(ErrorCode.AUTH_REQUIRED);
    expect(error.message).toContain('vikunja_auth provision');
    expect(error.message).toContain("haven't linked a Vikunja API token yet");
  });

  it('masks the sub — never echoes it in full, only the maskCredential prefix', () => {
    const error = createOidcAuthRequiredError({
      issuer: 'https://idp.example',
      sub: 'super-secret-subject-id',
    });
    expect(error.message).not.toContain('super-secret-subject-id');
    expect(error.message).toContain('supe...');
  });

  it('never reveals whether a different identity is provisioned', () => {
    const errorA = createOidcAuthRequiredError(identityA);
    const errorB = createOidcAuthRequiredError(identityB);

    expect(errorA.message).not.toContain('user-b');
    expect(errorB.message).not.toContain('user-a');
  });

  it('falls back to a redacted placeholder for an empty sub (defence in depth — the JWT middleware is expected to reject empty subs before this is ever reached)', () => {
    const error = createOidcAuthRequiredError({ issuer: 'https://idp.example', sub: '' });
    expect(error.message).toContain('[REDACTED]');
  });
});
