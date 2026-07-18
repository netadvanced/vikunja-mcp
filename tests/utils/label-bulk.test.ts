import { setTaskLabels } from '../../src/utils/label-bulk';
import { getAuthManagerFromContext } from '../../src/client';
import { AuthManager } from '../../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../../src/utils/retry';

jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn(),
}));

describe('setTaskLabels', () => {
  let authManager: AuthManager;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  const restOk = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn(async () => JSON.stringify(body)),
    }) as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(authManager);

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn().mockResolvedValue(restOk({ labels: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the { labels: [{ id }] } body shape that Vikunja requires', async () => {
    // `client` is intentionally unused by the REST implementation (see the
    // doc comment on setTaskLabels) — any value satisfies the signature.
    await setTaskLabels(null as never, 42, [3, 8]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://vikunja.test/api/v1/tasks/42/labels/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ labels: [{ id: 3 }, { id: 8 }] }),
      }),
    );
  });

  it('sends an empty labels array to clear every label', async () => {
    await setTaskLabels(null as never, 7, []);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://vikunja.test/api/v1/tasks/7/labels/bulk',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ labels: [] }),
      }),
    );
  });

  it('propagates errors from the API', async () => {
    // A 4xx status is not retried by the REST helper's default predicate, so
    // this resolves without incurring the (real-time) retry/backoff delay a
    // 5xx status would trigger.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: jest.fn(async () => 'boom'),
    } as unknown as Response);

    await expect(setTaskLabels(null as never, 1, [1])).rejects.toThrow('boom');
  });
});
