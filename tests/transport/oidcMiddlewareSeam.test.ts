/**
 * Tests for the OIDC middleware seam (src/transport/oidcMiddlewareSeam.ts).
 *
 * This module is a pure registration seam for item H1b (the JWT-validation
 * middleware, a parallel wave-H1 work item) — H1a only needs to prove the
 * seam correctly reports "nothing registered yet" by default, and correctly
 * returns whatever is registered.
 */

import { getOidcAuthMiddleware, setOidcAuthMiddleware } from '../../src/transport/oidcMiddlewareSeam';

describe('oidcMiddlewareSeam', () => {
  afterEach(() => {
    setOidcAuthMiddleware(undefined);
  });

  it('returns undefined when no middleware has been registered', () => {
    expect(getOidcAuthMiddleware()).toBeUndefined();
  });

  it('returns the registered middleware', () => {
    const middleware = jest.fn().mockResolvedValue(true);
    setOidcAuthMiddleware(middleware);

    expect(getOidcAuthMiddleware()).toBe(middleware);
  });

  it('clears the registration when set back to undefined', () => {
    setOidcAuthMiddleware(jest.fn().mockResolvedValue(true));
    setOidcAuthMiddleware(undefined);

    expect(getOidcAuthMiddleware()).toBeUndefined();
  });
});
