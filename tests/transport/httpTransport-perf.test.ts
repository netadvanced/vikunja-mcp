/**
 * Profiling test for item H2b(1): "HTTP server caching" — the stateless
 * `oidc-http` transport builds a fresh `McpServer` + re-runs `registerTools`
 * on EVERY request (see `src/index.ts`'s `startHttpTransport` call and
 * `src/transport/httpTransport.ts`'s module header — this is required by the
 * SDK's stateless-transport constraint, not an oversight).
 *
 * Per the work item: profile first, then decide whether any caching is
 * warranted. This test measures the wall-clock cost of exactly the
 * per-request construction path (`new McpServer()` + `registerTools(...)`,
 * the same two calls `startHttpTransport`'s injected factory performs) over
 * many iterations and asserts it stays comfortably under a generous ceiling.
 *
 * It is intentionally NOT a micro-benchmark harness with statistical rigor
 * (no warmup-then-measure separation beyond a fixed warmup count, no
 * percentile reporting) — it exists to catch a *regression* (someone adding
 * an accidentally expensive step to registration) and to produce the
 * before/after numbers this item's PR description cites, not to be a
 * general-purpose benchmark suite.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../../src/tools';
import { AuthManager } from '../../src/auth/AuthManager';
import { createVikunjaClientFactory } from '../../src/client';

describe('per-request McpServer construction cost (H2b caching profiling)', () => {
  it('constructs a fresh, fully-registered McpServer well under a 50ms budget on average', async () => {
    const authManager = new AuthManager();
    authManager.connect('http://127.0.0.1:1/api/v1', 'tk_perf-placeholder-token-000000');
    // A real client factory, matching production (`src/index.ts` builds this
    // ONCE at startup, not per request — only `registerTools` re-runs per
    // request in stateless mode). Using a real factory here (rather than
    // `undefined`) means every client-dependent tool actually registers, so
    // this measures the full realistic per-request registration cost, not an
    // under-count.
    const clientFactory = await createVikunjaClientFactory(authManager);
    const WARMUP = 20;
    const ITERATIONS = 200;

    for (let i = 0; i < WARMUP; i++) {
      const server = new McpServer({ name: 'perf-warmup', version: '0.0.0' });
      registerTools(server, authManager, clientFactory);
    }

    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = process.hrtime.bigint();
      const server = new McpServer({ name: 'perf-measured', version: '0.0.0' });
      registerTools(server, authManager, clientFactory);
      const end = process.hrtime.bigint();
      samples.push(Number(end - start) / 1_000_000); // ms
    }

    samples.sort((a, b) => a - b);
    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const max = samples[samples.length - 1];

    // Evidence for the PR description — deliberately printed, not just
    // asserted, so a CI log / local run carries the actual numbers.
    // eslint-disable-next-line no-console
    console.log(
      `[H2b perf] per-request McpServer+registerTools construction over ${ITERATIONS} ` +
        `iterations (after ${WARMUP} warmup): mean=${mean.toFixed(3)}ms p50=${p50.toFixed(3)}ms ` +
        `p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms`,
    );

    // Generous ceiling: this is a regression guard, not a tight performance
    // budget. If this ever fails, something made registration pathologically
    // slower — worth investigating before assuming "just raise the number".
    expect(mean).toBeLessThan(50);
    expect(p95).toBeLessThan(100);
  });
});
