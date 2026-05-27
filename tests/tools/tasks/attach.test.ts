import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { handleAttach } from '../../../src/tools/tasks/attach';
import type { AuthManager } from '../../../src/auth/AuthManager';

type FetchMock = jest.Mock<typeof fetch>;

describe('handleAttach', () => {
  const makeAuth = (
    apiUrl = 'http://vikunja.example/api/v1',
    apiToken = 'tk_test',
  ): AuthManager =>
    ({
      getSession: jest.fn(() => ({
        apiUrl,
        apiToken,
        authType: 'api-token',
      })),
    }) as unknown as AuthManager;

  const okResponse = (data: unknown = { errors: null, success: [] }): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn<() => Promise<unknown>>().mockResolvedValue(data),
      text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(data)),
    }) as unknown as Response;

  let fetchMock: FetchMock;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn() as FetchMock;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects missing id', async () => {
    await expect(handleAttach({ fileContent: 'aGk=' }, makeAuth())).rejects.toThrow(
      'attach requires a positive numeric task id',
    );
  });

  it('rejects zero or negative id', async () => {
    await expect(
      handleAttach({ id: 0, fileContent: 'aGk=' }, makeAuth()),
    ).rejects.toThrow('attach requires a positive numeric task id');
    await expect(
      handleAttach({ id: -1, fileContent: 'aGk=' }, makeAuth()),
    ).rejects.toThrow('attach requires a positive numeric task id');
  });

  it('rejects missing filePath and fileContent', async () => {
    await expect(handleAttach({ id: 1 }, makeAuth())).rejects.toThrow(
      'attach requires filePath or fileContent',
    );
    // Empty string is falsy → same branch.
    await expect(
      handleAttach({ id: 1, fileContent: '' }, makeAuth()),
    ).rejects.toThrow('attach requires filePath or fileContent');
  });

  it('rejects fileContent that decodes to empty bytes', async () => {
    // '====' is structurally valid base64 padding but decodes to 0 bytes.
    await expect(
      handleAttach({ id: 1, fileContent: '====' }, makeAuth()),
    ).rejects.toThrow('attach: decoded fileContent is empty');
  });

  it('reads filePath and uploads with basename when filename omitted', async () => {
    const tmp = join(tmpdir(), `attach-test-${Date.now()}-${process.pid}.txt`);
    writeFileSync(tmp, 'hello attach\n');
    try {
      fetchMock.mockResolvedValue(okResponse({ success: [{ id: 1 }], errors: null }));
      const res = await handleAttach({ id: 42, filePath: tmp }, makeAuth());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://vikunja.example/api/v1/tasks/42/attachments');
      expect(init.method).toBe('PUT');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer tk_test',
      );
      expect(init.body).toBeInstanceOf(FormData);
      expect(res.content[0].text).toContain(`Attached \`${basename(tmp)}\` (13 bytes)`);
      expect(res.content[0].text).toContain('"source": "filePath"');
    } finally {
      unlinkSync(tmp);
    }
  });

  it('throws explanatory error when filePath does not exist', async () => {
    await expect(
      handleAttach(
        { id: 1, filePath: '/no/such/dir/xyz-attach-test.bin' },
        makeAuth(),
      ),
    ).rejects.toThrow(/^attach: cannot read filePath \/no\/such\/dir\/xyz-attach-test\.bin:/);
  });

  it('decodes base64 fileContent with default filename', async () => {
    fetchMock.mockResolvedValue(okResponse());
    // base64('hi\n') === 'aGkK' (3 bytes).
    const res = await handleAttach({ id: 7, fileContent: 'aGkK' }, makeAuth());
    expect(res.content[0].text).toContain('Attached `attachment.bin` (3 bytes)');
    expect(res.content[0].text).toContain('"source": "fileContent"');
  });

  it('uses explicit filename when provided', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const res = await handleAttach(
      { id: 7, fileContent: 'aGkK', filename: 'note.md' },
      makeAuth(),
    );
    expect(res.content[0].text).toContain('Attached `note.md` (3 bytes)');
  });

  it('filePath takes precedence over fileContent', async () => {
    const tmp = join(tmpdir(), `attach-priority-${Date.now()}-${process.pid}.txt`);
    writeFileSync(tmp, 'from-path'); // 9 bytes
    try {
      fetchMock.mockResolvedValue(okResponse());
      const res = await handleAttach(
        {
          id: 3,
          filePath: tmp,
          fileContent: 'd3JvbmcK', // 'wrong\n', 6 bytes — should be ignored
          filename: 'override.txt',
        },
        makeAuth(),
      );
      expect(res.content[0].text).toContain('"source": "filePath"');
      expect(res.content[0].text).toContain('Attached `override.txt` (9 bytes)');
    } finally {
      unlinkSync(tmp);
    }
  });

  it('strips directory components from filename', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const res = await handleAttach(
      { id: 9, fileContent: 'aGkK', filename: '/etc/passwd' },
      makeAuth(),
    );
    expect(res.content[0].text).toContain('Attached `passwd` (3 bytes)');
  });

  it('strips trailing slashes from apiUrl', async () => {
    fetchMock.mockResolvedValue(okResponse());
    await handleAttach(
      { id: 5, fileContent: 'aGkK' },
      makeAuth('http://vikunja.example/api/v1///'),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://vikunja.example/api/v1/tasks/5/attachments',
    );
  });

  it('propagates HTTP status and body on non-OK response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: jest.fn<() => Promise<string>>().mockResolvedValue('task not found'),
      json: jest.fn<() => Promise<unknown>>(),
    } as unknown as Response);
    await expect(
      handleAttach({ id: 99999, fileContent: 'aGkK' }, makeAuth()),
    ).rejects.toThrow('attach failed: HTTP 404 Not Found: task not found');
  });

  it('wraps network errors with explanatory message', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      handleAttach({ id: 1, fileContent: 'aGkK' }, makeAuth()),
    ).rejects.toThrow(/^attach: network error PUTting .*: ECONNREFUSED$/);
  });
});
