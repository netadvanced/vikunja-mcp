/**
 * Friction computation ("HOW HARD"): derives discoverability/ergonomics
 * signals from a `ParsedTranscript` relative to a scenario's hand-estimated
 * `optimalCallCount`. This is deliberately heuristic (transcripts are free
 * text from a live agent, not a structured test log) -- every heuristic
 * below is documented at its definition so a future tuning pass knows what
 * it's adjusting.
 */

import type { FrictionReport, ParsedTranscript, Scenario, ToolCallRecord } from '../types';

const MCP_TOOL_PREFIX = 'mcp__';

/**
 * The only built-in tool the runner grants (`--tools ToolSearch`, see
 * scripts/battle/run-scenario.ts) -- required plumbing to load a deferred
 * MCP tool's schema, not a wrong-tool attempt. See `FrictionReport.toolSearchCallCount`.
 */
const TOOL_SEARCH_NAME = 'ToolSearch';

/**
 * Patterns in a tool_result's error text that indicate the agent supplied
 * invalid arguments (a discoverability smoking gun) rather than the
 * operation legitimately failing for other reasons (404s, network errors,
 * etc).
 *
 * `invalid filter syntax` and `expected condition` were added after the
 * 20260718-211659-05yr35 battle campaign (filter-high-priority-search
 * scenario): the harness's own `invalidArgErrorCount` reported 0 for that
 * run even though 3 of its calls failed with Vikunja's filter-parser error
 * text ("Invalid filter syntax: Expected condition after logical
 * operator...") -- a genuine argument-shape mistake (snake_case
 * `due_date` vs the parser's expected camelCase `dueDate`) that none of the
 * existing patterns matched because the parser's error text doesn't say
 * "invalid enum/type/input" etc. See tests/battle/fixtures/filter-syntax-real-errors.jsonl
 * for the real transcript excerpt this was derived from.
 */
const VALIDATION_ERROR_PATTERNS = [
  /VALIDATION_ERROR/i,
  /invalid (?:enum|type|input|argument|value)/i,
  /invalid filter syntax/i,
  /expected condition (?:after|before)/i,
  /required/i,
  /expected .* received/i, // typical zod message shape
  /must be a? ?(?:positive|non-negative|number|string|integer)/i,
  /unrecognized_keys|unknown subcommand/i,
];

function isMcpToolCall(call: ToolCallRecord, serverName?: string): boolean {
  if (!call.name.startsWith(MCP_TOOL_PREFIX)) return false;
  if (!serverName) return true;
  return call.name.startsWith(`${MCP_TOOL_PREFIX}${serverName}__`);
}

function looksLikeValidationError(call: ToolCallRecord): boolean {
  if (!call.isError || !call.resultText) return false;
  return VALIDATION_ERROR_PATTERNS.some((re) => re.test(call.resultText ?? ''));
}

export function computeFriction(scenario: Scenario, transcript: ParsedTranscript, mcpServerName?: string): FrictionReport {
  const mcpCalls = transcript.toolCalls.filter((c) => isMcpToolCall(c, mcpServerName));
  const toolSearchCalls = transcript.toolCalls.filter((c) => c.name === TOOL_SEARCH_NAME);
  const nonMcpCalls = transcript.toolCalls.filter((c) => !isMcpToolCall(c, mcpServerName) && c.name !== TOOL_SEARCH_NAME);

  const invalidArgErrorCount = mcpCalls.filter(looksLikeValidationError).length;

  // Retry heuristic: the same tool called with byte-identical JSON args more
  // than once. A legitimate scenario sometimes calls the same tool
  // repeatedly with *different* args (e.g. creating 10 tasks) -- that's
  // normal and not counted. An identical repeat strongly suggests the first
  // attempt errored and the agent retried the exact same (or so it hoped,
  // differently-received) request.
  const seen = new Map<string, number>();
  for (const call of mcpCalls) {
    const key = `${call.name}::${JSON.stringify(call.input)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const retryCount = [...seen.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  const totalTokens =
    transcript.usage.inputTokens +
    transcript.usage.outputTokens +
    transcript.usage.cacheCreationInputTokens +
    transcript.usage.cacheReadInputTokens;

  const frictionNotes: string[] = [];
  if (nonMcpCalls.length > 0) {
    frictionNotes.push(
      `${nonMcpCalls.length} tool call(s) went to a non-vikunja tool (${[...new Set(nonMcpCalls.map((c) => c.name))].join(', ')}) -- the agent reached outside the scenario's intended tool surface.`,
    );
  }
  if (invalidArgErrorCount > 0) {
    frictionNotes.push(`${invalidArgErrorCount} call(s) failed with what looks like a validation/argument error.`);
  }
  if (retryCount > 0) {
    frictionNotes.push(`${retryCount} call(s) were byte-identical repeats of an earlier call (likely retries after a failure).`);
  }
  if (mcpCalls.length > scenario.optimalCallCount) {
    frictionNotes.push(
      `used ${mcpCalls.length} calls against an estimated optimum of ${scenario.optimalCallCount} ` +
        `(${(mcpCalls.length / scenario.optimalCallCount).toFixed(1)}x) -- a composite-tool candidate if this recurs across runs.`,
    );
  }
  if (transcript.parseWarnings.length > 0) {
    frictionNotes.push(`transcript parser warnings: ${transcript.parseWarnings.join('; ')}`);
  }
  if (toolSearchCalls.length > mcpCalls.length) {
    frictionNotes.push(
      `${toolSearchCalls.length} ToolSearch discovery call(s) against only ${mcpCalls.length} actual vikunja tool call(s) -- ` +
        'the agent spent more effort finding tools than using them.',
    );
  }

  return {
    scenarioId: scenario.id,
    toolCallCount: mcpCalls.length,
    optimalCallCount: scenario.optimalCallCount,
    callCountRatio: scenario.optimalCallCount > 0 ? mcpCalls.length / scenario.optimalCallCount : 0,
    invalidArgErrorCount,
    wrongToolAttemptCount: nonMcpCalls.length,
    toolSearchCallCount: toolSearchCalls.length,
    retryCount,
    totalTokens,
    wallTimeMs: transcript.durationMs,
    totalCostUsd: transcript.totalCostUsd,
    frictionNotes,
  };
}
