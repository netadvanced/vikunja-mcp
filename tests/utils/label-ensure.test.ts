/**
 * Tests for the shared get-or-create-by-title label helper.
 *
 * Extracted from the `ensure` subcommand of `vikunja_labels` (src/tools/labels.ts)
 * so `vikunja_task_labels apply-label` can resolve label titles to ids via the
 * exact same match/create semantics. See netadvanced/vikunja-mcp#28 friction #4
 * and the `feat/label-attach-by-name` follow-up (weak agents did not adopt the
 * standalone `ensure` subcommand — folding get-or-create into apply-label
 * directly via `labelTitles`).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../src/auth/AuthManager';
import { ensureLabelByTitle } from '../../src/utils/label-ensure';
import { MCPError } from '../../src/types';
import { circuitBreakerRegistry } from '../../src/utils/retry';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  text?: string;
}): Response {
  const { ok = true, status = 200, statusText = 'OK' } = opts;
  const text = opts.text !== undefined ? opts.text : JSON.stringify(opts.body ?? {});
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('ensureLabelByTitle', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.example.com', 'tk_test-token');
  });

  it('reuses an existing label on an exact (case-insensitive) title match', async () => {
    const existingLabel = { id: 7, title: 'Bug', hex_color: '#ff0000' };
    mockFetch.mockResolvedValueOnce(mockResponse({ body: [existingLabel] }));

    const result = await ensureLabelByTitle(authManager, 'bug');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://vikunja.example.com/api/v1/labels?s=bug',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({
      id: 7,
      title: 'Bug',
      created: false,
      label: existingLabel,
    });
  });

  it('creates a new label when no exact match is found', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));
    const createdLabel = { id: 42, title: 'Urgent' };
    mockFetch.mockResolvedValueOnce(mockResponse({ body: createdLabel }));

    const result = await ensureLabelByTitle(authManager, 'Urgent');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://vikunja.example.com/api/v1/labels',
      expect.objectContaining({ method: 'PUT' }),
    );
    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Urgent' });
    expect(result).toEqual({
      id: 42,
      title: 'Urgent',
      created: true,
      label: createdLabel,
    });
  });

  it('passes description/hexColor through on create', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));
    const createdLabel = { id: 43, title: 'Priority', description: 'High priority', hex_color: '#00ff00' };
    mockFetch.mockResolvedValueOnce(mockResponse({ body: createdLabel }));

    await ensureLabelByTitle(authManager, 'Priority', {
      description: 'High priority',
      hexColor: '#00ff00',
    });

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Priority',
      description: 'High priority',
      hex_color: '#00ff00',
    });
  });

  it('does not match a substring search result that is not an exact title', async () => {
    const candidates = [
      { id: 1, title: 'Bugfix' },
      { id: 2, title: 'Bug' },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse({ body: candidates }));

    const result = await ensureLabelByTitle(authManager, 'Bug');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(2);
    expect(result.created).toBe(false);
  });

  it('treats a null/undefined search response as no match and creates the label', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ body: null }));
    const createdLabel = { id: 44, title: 'Fresh' };
    mockFetch.mockResolvedValueOnce(mockResponse({ body: createdLabel }));

    const result = await ensureLabelByTitle(authManager, 'Fresh');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(true);
    expect(result.id).toBe(44);
  });

  it('throws when a matched existing label has no numeric id', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ body: [{ title: 'Bug' }] }));

    await expect(ensureLabelByTitle(authManager, 'Bug')).rejects.toThrow(MCPError);
  });

  it('throws when the newly created label has no numeric id', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ body: [] }));
    mockFetch.mockResolvedValueOnce(mockResponse({ body: { title: 'Fresh' } }));

    await expect(ensureLabelByTitle(authManager, 'Fresh')).rejects.toThrow(MCPError);
  });
});
