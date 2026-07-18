import { assertLocalUrl, runPrefixFor, generateRunId } from '../../scripts/battle/lib/config';

describe('assertLocalUrl (safety gate)', () => {
  it.each(['http://localhost:33456/api/v1', 'http://127.0.0.1:33456/api/v1', 'http://[::1]:33456/api/v1'])(
    'accepts %s',
    (url) => {
      expect(() => assertLocalUrl(url)).not.toThrow();
    },
  );

  it.each([
    'https://try.vikunja.io/api/v1',
    'http://vikunja.example.com/api/v1',
    'http://192.168.1.50:3456/api/v1',
  ])('refuses %s (a real/non-local host)', (url) => {
    expect(() => assertLocalUrl(url)).toThrow(/localhost/i);
  });

  it('refuses a malformed URL', () => {
    expect(() => assertLocalUrl('not-a-url')).toThrow();
  });
});

describe('generateRunId / runPrefixFor', () => {
  it('produces a filesystem- and title-safe run id', () => {
    const runId = generateRunId();
    expect(runId).toMatch(/^[0-9a-z-]+$/);
  });

  it('produces a distinct run id on each call', () => {
    expect(generateRunId()).not.toBe(generateRunId());
  });

  it('wraps the run id in the battle- root prefix, dash-terminated', () => {
    const prefix = runPrefixFor('20260101-000000-abcdef');
    expect(prefix).toBe('battle-20260101-000000-abcdef-');
    expect(prefix.startsWith('battle-')).toBe(true);
  });
});
