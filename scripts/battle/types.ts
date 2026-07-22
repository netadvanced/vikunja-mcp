/**
 * Shared types for the agent battle-testing harness (Wave item T2, tracking
 * issue #28). See docs/BATTLE-TESTING.md for the full workflow writeup.
 *
 * A "scenario" is a natural-language prompt handed to a headless `claude -p`
 * agent whose tool surface is this repo's own MCP server (`node dist/index.js`,
 * see scripts/battle/lib/mcp-config.ts) plus the one built-in tool required
 * to discover it (`ToolSearch` -- see scripts/battle/run-scenario.ts's file
 * header), plus a `verify` spec describing the Vikunja REST-API-observable
 * end state the scenario should produce. The harness never trusts the
 * agent's own self-report of success -- only `runVerification`
 * (scripts/battle/lib/verify.ts) talking directly to the REST API counts.
 */

import { z } from 'zod';

// ============================================================================
// Verification checks
//
// Each check is self-contained (no cross-check references) and locates its
// own project/label/task rows by a `*TitleContains` substring match against
// the run's unique `battle-<runid>-` prefixed titles. Keeping checks
// self-contained -- rather than threading ids computed by an earlier check
// through to a later one -- keeps both the schema and the engine
// (scripts/battle/lib/verify.ts) trivial to unit test with static fixtures.
// ============================================================================

const ProjectExistsCheck = z.object({
  type: z.literal('project-exists'),
  titleContains: z.string().min(1),
});

const MinTasksInProjectCheck = z.object({
  type: z.literal('min-tasks-in-project'),
  projectTitleContains: z.string().min(1),
  min: z.number().int().positive(),
});

const MinBucketsInProjectCheck = z.object({
  type: z.literal('min-buckets-in-project'),
  projectTitleContains: z.string().min(1),
  min: z.number().int().positive(),
});

/**
 * Counts *distinct buckets* (within the matched project) that hold at least
 * one task, per `models.Bucket.count` in the Vikunja OpenAPI spec. Distinct
 * from `min-buckets-in-project` (which only checks the buckets themselves
 * exist): a project can have 3 empty columns and 10 tasks all still sitting
 * in the default bucket -- this check is what actually proves a
 * distribute-across-buckets composite (bulk-set-bucket) moved tasks, rather
 * than just creating the board structure.
 */
const BucketsWithTasksCountCheck = z.object({
  type: z.literal('buckets-with-tasks-count'),
  projectTitleContains: z.string().min(1),
  min: z.number().int().positive(),
});

/**
 * Counts tasks (within the matched project) whose `field` satisfies `op`
 * against `value` (or, for `op: "set"`, simply has a non-default/non-empty
 * value -- no `value` needed). Covers "tasks have priorities set", "tasks
 * are marked done", "tasks have a due date" style assertions without a
 * bespoke check type per field.
 */
const TasksFieldMatchCountCheck = z.object({
  type: z.literal('tasks-field-match-count'),
  projectTitleContains: z.string().min(1),
  field: z.enum(['priority', 'done', 'due_date', 'percent_done']),
  op: z.enum(['gte', 'eq', 'set']),
  value: z.union([z.number(), z.boolean()]).optional(),
  min: z.number().int().positive(),
});

const TasksDueDateInRangeCheck = z.object({
  type: z.literal('tasks-due-date-in-range'),
  projectTitleContains: z.string().min(1),
  startDate: z.string().min(1), // ISO 8601
  endDate: z.string().min(1), // ISO 8601
  min: z.number().int().positive(),
});

const LabelExistsCheck = z.object({
  type: z.literal('label-exists'),
  titleContains: z.string().min(1),
});

const TasksWithLabelCountCheck = z.object({
  type: z.literal('tasks-with-label-count'),
  projectTitleContains: z.string().min(1),
  labelTitleContains: z.string().min(1),
  min: z.number().int().positive(),
});

const TaskHasSubtasksCheck = z.object({
  type: z.literal('task-has-subtasks'),
  projectTitleContains: z.string().min(1),
  parentTitleContains: z.string().min(1),
  min: z.number().int().positive(),
});

const ProjectHasShareCheck = z.object({
  type: z.literal('project-has-share'),
  projectTitleContains: z.string().min(1),
});

// zod's discriminatedUnion needs the literal discriminator field name and the
// list of object schemas; kept as a builder function below the individual
// schemas so each branch above stays readable in isolation.
function buildVerifyCheckSchema() {
  return z.discriminatedUnion('type', [
    ProjectExistsCheck,
    MinTasksInProjectCheck,
    MinBucketsInProjectCheck,
    BucketsWithTasksCountCheck,
    TasksFieldMatchCountCheck,
    TasksDueDateInRangeCheck,
    LabelExistsCheck,
    TasksWithLabelCountCheck,
    TaskHasSubtasksCheck,
    ProjectHasShareCheck,
  ]);
}

export type VerifyCheck = z.infer<ReturnType<typeof buildVerifyCheckSchema>>;

export const VerifyCheckSchema = buildVerifyCheckSchema();

// ============================================================================
// Setup actions ("SEED THE STACK")
//
// Executed via direct REST (scripts/battle/lib/setup.ts), after
// cleanup-before and before the agent is spawned, so a scenario can require
// the agent to act on data that already existed rather than data it just
// created itself (e.g. "apply this already-existing label" -- the
// find-then-apply path, as opposed to create-then-apply). Like `verify`
// checks, every action's string fields may contain the `{{prefix}}`
// placeholder, substituted with the run's unique `battle-<runid>-` prefix at
// render time (see scripts/battle/lib/scenario.ts's `renderScenario`) so
// seeded data is swept by the same prefix-based cleanup as everything else.
// ============================================================================

const CreateLabelSetupAction = z.object({
  type: z.literal('create-label'),
  title: z.string().min(1),
});

function buildSetupActionSchema() {
  return z.discriminatedUnion('type', [CreateLabelSetupAction]);
}

export type SetupAction = z.infer<ReturnType<typeof buildSetupActionSchema>>;

export const SetupActionSchema = buildSetupActionSchema();

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'scenario id must be kebab-case'),
  title: z.string().min(1),
  description: z.string().optional(),
  /** May contain the literal placeholder `{{prefix}}`, substituted with `battle-<runid>-` at run time. */
  promptTemplate: z.string().min(1),
  /** Hand-estimated minimum number of vikunja_* tool calls an expert user of this tool surface would need. */
  optimalCallCount: z.number().int().positive(),
  /** Model alias/name override for this scenario (e.g. the cheapest scenario pins `haiku` for the live smoke test). */
  model: z.string().optional(),
  /** Optional seed data created via direct REST before the agent is spawned -- see "Setup actions" above. */
  setup: z.array(buildSetupActionSchema()).optional(),
  verify: z.array(buildVerifyCheckSchema()).min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

// ============================================================================
// Verification verdict ("DID IT WORK")
// ============================================================================

export interface CheckVerdict {
  check: VerifyCheck;
  passed: boolean;
  detail: string;
}

export interface VerificationVerdict {
  scenarioId: string;
  passed: boolean;
  checks: CheckVerdict[];
}

// ============================================================================
// Transcript parsing ("HOW HARD")
// ============================================================================

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  /** Present once the matching tool_result line has been seen. */
  resultText?: string;
  isError?: boolean;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface McpServerStatus {
  name: string;
  status: string;
}

export interface ParsedTranscript {
  toolCalls: ToolCallRecord[];
  assistantTexts: string[];
  numTurns: number;
  durationMs: number;
  totalCostUsd: number;
  usage: UsageTotals;
  finalResultText: string;
  resultIsError: boolean;
  mcpServers: McpServerStatus[];
  lineCount: number;
  parseWarnings: string[];
}

// ============================================================================
// Friction report ("HOW HARD", scenario-relative)
// ============================================================================

export interface FrictionReport {
  scenarioId: string;
  toolCallCount: number;
  optimalCallCount: number;
  callCountRatio: number;
  invalidArgErrorCount: number;
  wrongToolAttemptCount: number;
  /**
   * Calls to the built-in `ToolSearch` tool. The harness's MCP tools are
   * exposed as deferred tools (`--tools ToolSearch` is the only built-in
   * tool granted -- see docs/BATTLE-TESTING.md), so a `ToolSearch` call is
   * required plumbing to load a tool's schema before it can be invoked, not
   * a mistake -- tracked separately from `wrongToolAttemptCount` and
   * excluded from `toolCallCount`/`callCountRatio`, but still a genuine
   * discoverability signal in its own right (how many discovery round trips
   * did the agent need).
   */
  toolSearchCallCount: number;
  retryCount: number;
  totalTokens: number;
  wallTimeMs: number;
  totalCostUsd: number;
  frictionNotes: string[];
}

export interface ScenarioRunResult {
  scenario: Scenario;
  runPrefix: string;
  verification: VerificationVerdict;
  friction: FrictionReport;
  transcriptPath: string;
  verdictPath: string;
}
