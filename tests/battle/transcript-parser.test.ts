import fs from 'node:fs';
import path from 'node:path';
import { parseTranscriptText } from '../../scripts/battle/lib/transcript-parser';

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

describe('parseTranscriptText', () => {
  it('parses a transcript with no tool calls', () => {
    const parsed = parseTranscriptText(loadFixture('simple-no-tools.jsonl'));

    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.assistantTexts).toEqual(['pong']);
    expect(parsed.numTurns).toBe(1);
    expect(parsed.durationMs).toBe(1200);
    expect(parsed.totalCostUsd).toBe(0.01);
    expect(parsed.finalResultText).toBe('pong');
    expect(parsed.resultIsError).toBe(false);
    expect(parsed.mcpServers).toEqual([]);
    expect(parsed.usage).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 0,
    });
    expect(parsed.parseWarnings).toEqual([]);
  });

  it('pairs tool_use calls with their tool_result, in order, across mixed tool names', () => {
    const parsed = parseTranscriptText(loadFixture('with-tool-calls.jsonl'));

    expect(parsed.toolCalls).toHaveLength(4);

    expect(parsed.toolCalls[0]).toMatchObject({
      id: 'call_1',
      name: 'mcp__vikunja-battle__vikunja_projects',
      input: { subcommand: 'create', title: 'battle-test-Foo' },
      resultText: 'Created project "battle-test-Foo" (ID: 42)',
      isError: false,
    });

    expect(parsed.toolCalls[1]).toMatchObject({
      id: 'call_2',
      name: 'mcp__vikunja-battle__vikunja_tasks',
      isError: true,
      resultText: 'VALIDATION_ERROR: projectId must be a number',
    });

    expect(parsed.toolCalls[2]).toMatchObject({
      id: 'call_3',
      name: 'mcp__vikunja-battle__vikunja_tasks',
      isError: false,
    });

    expect(parsed.toolCalls[3]).toMatchObject({ id: 'call_4', name: 'Bash', isError: false });

    expect(parsed.mcpServers).toEqual([{ name: 'vikunja-battle', status: 'connected' }]);
    expect(parsed.numTurns).toBe(4);
    expect(parsed.durationMs).toBe(5000);
    expect(parsed.totalCostUsd).toBe(0.05);
    expect(parsed.finalResultText).toBe('Done, created the project and task.');
    expect(parsed.assistantTexts).toEqual(['Done, created the project and task.']);
    expect(parsed.parseWarnings).toEqual([]);
  });

  it('records a warning per malformed JSON line and per orphaned tool_result, and flags a missing result line', () => {
    const parsed = parseTranscriptText(loadFixture('malformed-and-no-result.jsonl'));

    expect(parsed.toolCalls).toEqual([]);
    expect(parsed.assistantTexts).toEqual(['partial']);
    expect(parsed.parseWarnings).toEqual([
      expect.stringContaining('not valid JSON'),
      expect.stringContaining('tool_result for unknown tool_use_id "unknown_call"'),
      expect.stringContaining('no terminal "result" line'),
    ]);
  });

  it('ignores blank lines', () => {
    const parsed = parseTranscriptText('\n\n' + loadFixture('simple-no-tools.jsonl') + '\n\n');
    expect(parsed.parseWarnings).toEqual([]);
    expect(parsed.finalResultText).toBe('pong');
  });

  it('handles tool_result content given as a content-block array rather than a plain string', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'mcp__x__y', input: {} }] },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: 'block-a' }, { type: 'text', text: 'block-b' }], is_error: false }],
        },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }),
    ];
    const parsed = parseTranscriptText(lines.join('\n'));
    expect(parsed.toolCalls[0]?.resultText).toBe('block-ablock-b');
  });
});
