import fs from 'node:fs';
import path from 'node:path';
import { parseTranscriptText } from '../../scripts/battle/lib/transcript-parser';
import { computeFriction } from '../../scripts/battle/lib/friction';
import type { ParsedTranscript, Scenario } from '../../scripts/battle/types';

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

const baseScenario: Scenario = {
  id: 'fixture-scenario',
  title: 'Fixture scenario',
  promptTemplate: 'do the thing',
  optimalCallCount: 2,
  verify: [{ type: 'project-exists', titleContains: 'x' }],
};

describe('computeFriction', () => {
  it('counts only calls to the configured MCP server as tool calls, flags the rest as wrong-tool attempts', () => {
    const transcript = parseTranscriptText(loadFixture('with-tool-calls.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');

    // call_1, call_2, call_3 are mcp__vikunja-battle__*; call_4 (Bash) is not.
    expect(friction.toolCallCount).toBe(3);
    expect(friction.wrongToolAttemptCount).toBe(1);
  });

  it('counts a validation-shaped tool_result error as an invalid-arg error', () => {
    const transcript = parseTranscriptText(loadFixture('with-tool-calls.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    expect(friction.invalidArgErrorCount).toBe(1);
  });

  it('does not count distinct-argument calls to the same tool as retries', () => {
    const transcript = parseTranscriptText(loadFixture('with-tool-calls.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    // call_2 and call_3 are both vikunja_tasks/create but with different
    // input (projectId "42" string vs. 42 number + a title) -- not a retry.
    expect(friction.retryCount).toBe(0);
  });

  it('counts byte-identical repeated tool calls as retries', () => {
    const lines: unknown[] = [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'mcp__vikunja-battle__vikunja_tasks', input: { subcommand: 'create', title: 't' } }] },
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'HTTP 500', is_error: true }] } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'mcp__vikunja-battle__vikunja_tasks', input: { subcommand: 'create', title: 't' } }] },
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'ok', is_error: false }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'done' },
    ];
    const transcript = parseTranscriptText(lines.map((l) => JSON.stringify(l)).join('\n'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    expect(friction.retryCount).toBe(1);
  });

  it('computes the call-count ratio against the scenario optimal and notes when it is exceeded', () => {
    const transcript = parseTranscriptText(loadFixture('with-tool-calls.jsonl'));
    const scenario: Scenario = { ...baseScenario, optimalCallCount: 1 };
    const friction = computeFriction(scenario, transcript, 'vikunja-battle');
    expect(friction.callCountRatio).toBeCloseTo(3 / 1);
    expect(friction.frictionNotes.some((n) => n.includes('composite-tool candidate'))).toBe(true);
  });

  it('does not flag a call-count note when the agent stays at or under the optimum', () => {
    const transcript = parseTranscriptText(loadFixture('simple-no-tools.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    expect(friction.toolCallCount).toBe(0);
    expect(friction.frictionNotes.some((n) => n.includes('composite-tool candidate'))).toBe(false);
  });

  it('surfaces transcript parser warnings as a friction note', () => {
    const transcript = parseTranscriptText(loadFixture('malformed-and-no-result.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    expect(friction.frictionNotes.some((n) => n.startsWith('transcript parser warnings:'))).toBe(true);
  });

  it('counts ToolSearch calls separately -- not as wrong-tool attempts, not as vikunja tool calls', () => {
    const transcript = parseTranscriptText(loadFixture('tool-search-and-mcp-calls.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');

    expect(friction.toolSearchCallCount).toBe(1);
    expect(friction.toolCallCount).toBe(1); // only the vikunja_projects create call
    expect(friction.wrongToolAttemptCount).toBe(0);
  });

  it('sums all four usage buckets into totalTokens', () => {
    const transcript: ParsedTranscript = {
      toolCalls: [],
      assistantTexts: [],
      numTurns: 1,
      durationMs: 100,
      totalCostUsd: 0.02,
      usage: { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 },
      finalResultText: 'ok',
      resultIsError: false,
      mcpServers: [],
      lineCount: 1,
      parseWarnings: [],
    };
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    expect(friction.totalTokens).toBe(10);
  });

  it('classifies Vikunja filter-parser "Invalid filter syntax" errors as invalid-arg errors (real transcript, campaign 20260718-211659-05yr35)', () => {
    // Regression fixture for a measurement gap found in the
    // filter-high-priority-search scenario: 3 of 4 genuinely-failed calls
    // used real error text from the Vikunja filter parser
    // ("Invalid filter syntax: Expected condition after logical
    // operator..."), which none of the pre-existing VALIDATION_ERROR_PATTERNS
    // matched. The 4th failure (vikunja_filters build's own Zod
    // invalid_enum_value rejection) was already classified correctly before
    // this fix -- included here so the fixture documents the full real
    // sequence, not just the gap.
    const transcript = parseTranscriptText(loadFixture('filter-syntax-real-errors.jsonl'));
    const friction = computeFriction(baseScenario, transcript, 'vikunja-battle');
    expect(friction.invalidArgErrorCount).toBe(4);
  });

  it('without a server name filter, still only counts mcp__-prefixed calls (any server) as in-scope', () => {
    const transcript = parseTranscriptText(loadFixture('with-tool-calls.jsonl'));
    const friction = computeFriction(baseScenario, transcript);
    // call_1..call_3 are mcp__vikunja-battle__*; call_4 (Bash) never counts
    // as an MCP tool call regardless of the serverName filter.
    expect(friction.toolCallCount).toBe(3);
    expect(friction.wrongToolAttemptCount).toBe(1);
  });
});
