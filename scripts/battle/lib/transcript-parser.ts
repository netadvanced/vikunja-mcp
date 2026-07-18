/**
 * Parses a `claude -p --output-format stream-json --verbose` JSONL
 * transcript into a structured `ParsedTranscript`.
 *
 * Line shapes handled (empirically confirmed against Claude Code 2.1.214;
 * see docs/BATTLE-TESTING.md for how this was derived and how to re-verify
 * against a newer CLI version):
 *   - `{"type":"assistant","message":{"content":[...]}}` -- content items of
 *     type `"tool_use"` (`{id, name, input}`) and `"text"` (`{text}`).
 *   - `{"type":"user","message":{"content":[...]}}` -- content items of type
 *     `"tool_result"` (`{tool_use_id, content, is_error}`); `content` may be
 *     a plain string or (rarely) a content-block array, in which case its
 *     text parts are concatenated.
 *   - `{"type":"result", ...}` -- exactly one, final line with aggregate
 *     `duration_ms`, `num_turns`, `total_cost_usd`, `usage`, `result`
 *     (the final answer text) and `is_error`.
 *   - `{"type":"system","subtype":"init", tools, mcp_servers}` -- session
 *     setup info; surfaced so a caller can sanity-check that only the
 *     intended MCP server ever connected.
 *
 * Unrecognized line types/shapes are recorded in `parseWarnings` rather than
 * thrown -- a transcript is a live external CLI's output, not a wire format
 * this repo controls, so the parser degrades gracefully on drift instead of
 * crashing analysis of an otherwise-usable run.
 */

import type { McpServerStatus, ParsedTranscript, ToolCallRecord, UsageTotals } from '../types';

interface RawContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface RawLine {
  type?: string;
  subtype?: string;
  message?: { role?: string; content?: RawContentBlock[] };
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: RawUsage;
  result?: string;
  is_error?: boolean;
  tools?: string[];
  mcp_servers?: McpServerStatus[];
}

function toResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => (typeof c === 'object' && c !== null && 'text' in c ? String((c as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}

export function parseTranscriptLines(lines: string[]): ParsedTranscript {
  const toolCallsById = new Map<string, ToolCallRecord>();
  const toolCallOrder: string[] = [];
  const assistantTexts: string[] = [];
  const mcpServers: McpServerStatus[] = [];
  const parseWarnings: string[] = [];

  let numTurns = 0;
  let durationMs = 0;
  let totalCostUsd = 0;
  let finalResultText = '';
  let resultIsError = false;
  let usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  let sawResultLine = false;

  for (const [idx, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: RawLine;
    try {
      parsed = JSON.parse(line) as RawLine;
    } catch (e) {
      parseWarnings.push(`line ${idx + 1}: not valid JSON (${(e as Error).message})`);
      continue;
    }

    switch (parsed.type) {
      case 'assistant': {
        for (const block of parsed.message?.content ?? []) {
          if (block.type === 'tool_use' && block.id && block.name) {
            const record: ToolCallRecord = { id: block.id, name: block.name, input: block.input };
            toolCallsById.set(block.id, record);
            toolCallOrder.push(block.id);
          } else if (block.type === 'text' && typeof block.text === 'string') {
            assistantTexts.push(block.text);
          }
        }
        break;
      }
      case 'user': {
        for (const block of parsed.message?.content ?? []) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const record = toolCallsById.get(block.tool_use_id);
            if (record) {
              record.resultText = toResultText(block.content);
              record.isError = Boolean(block.is_error);
            } else {
              parseWarnings.push(`line ${idx + 1}: tool_result for unknown tool_use_id "${block.tool_use_id}"`);
            }
          }
        }
        break;
      }
      case 'result': {
        sawResultLine = true;
        numTurns = parsed.num_turns ?? 0;
        durationMs = parsed.duration_ms ?? 0;
        totalCostUsd = parsed.total_cost_usd ?? 0;
        finalResultText = parsed.result ?? '';
        resultIsError = Boolean(parsed.is_error);
        usage = {
          inputTokens: parsed.usage?.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? 0,
          cacheCreationInputTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: parsed.usage?.cache_read_input_tokens ?? 0,
        };
        break;
      }
      case 'system': {
        if (parsed.subtype === 'init') {
          mcpServers.push(...(parsed.mcp_servers ?? []));
        }
        break;
      }
      default:
        // system/rate_limit_event/etc. lines we don't need detail from.
        break;
    }
  }

  if (!sawResultLine) {
    parseWarnings.push('no terminal "result" line found -- the run may have been killed/timed out mid-stream');
  }

  return {
    toolCalls: toolCallOrder.map((id) => toolCallsById.get(id)).filter((r): r is ToolCallRecord => r !== undefined),
    assistantTexts,
    numTurns,
    durationMs,
    totalCostUsd,
    usage,
    finalResultText,
    resultIsError,
    mcpServers,
    lineCount: lines.length,
    parseWarnings,
  };
}

export function parseTranscriptText(text: string): ParsedTranscript {
  return parseTranscriptLines(text.split('\n'));
}
