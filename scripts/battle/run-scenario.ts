#!/usr/bin/env npx tsx
/**
 * Agent battle-testing harness runner (Wave item T2, tracking issue #28).
 * See docs/BATTLE-TESTING.md for the full workflow, cost expectations, and
 * how to add scenarios.
 *
 * Spawns a real, headless `claude -p` agent whose tool surface is this
 * repo's own MCP server build (pointed at the disposable local e2e stack)
 * plus exactly one built-in tool, `ToolSearch` -- required plumbing, since
 * this environment exposes MCP tools as deferred tools that must be
 * discovered via `ToolSearch` before they can be called (confirmed
 * empirically while building this harness: with zero built-in tools
 * granted, the agent can see the MCP tools are configured but has no
 * mechanism to ever load their schemas and call them -- see
 * docs/BATTLE-TESTING.md). No other built-in tool (Bash, Read, Write, etc.)
 * is granted, so every actual unit of work still goes through vikunja_*.
 * Grades the run two ways:
 *   1. DID IT WORK -- verified via direct Vikunja REST calls
 *      (scripts/battle/lib/verify.ts), never the agent's self-report.
 *   2. HOW HARD -- parsed from the full JSONL transcript
 *      (scripts/battle/lib/transcript-parser.ts +
 *      scripts/battle/lib/friction.ts): tool-call count vs. hand-estimated
 *      optimum, validation errors, wrong-tool attempts, retries, tokens,
 *      wall time.
 *
 * Usage:
 *   npm run battle -- --list
 *   npm run battle -- --scenario q3-offsite
 *   npm run battle -- --all
 *   npm run battle -- --all --model haiku   (cheapest available, for smoke-testing the plumbing)
 *
 * COST WARNING: every invocation (other than --list) spawns a real Claude
 * Code session against the configured Anthropic account. This harness is
 * NEVER wired into CI, a git hook, or any other automatic trigger -- it
 * only runs when a human deliberately types the command above. See
 * docs/BATTLE-TESTING.md's "COST WARNING" section before running `--all`.
 *
 * SAFETY: see scripts/battle/lib/config.ts's file header. This script
 * refuses to start if the configured Vikunja URL is not localhost, and
 * only ever talks to a freshly-minted credential against that stack.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  BATTLE_RESULTS_DIR,
  DIST_ENTRY,
  REPO_ROOT,
  SCENARIOS_DIR,
  TEST_PASSWORD,
  TEST_USERNAME,
  TOKEN_TITLE,
  VIKUNJA_URL,
  assertLocalUrl,
  ensureDir,
  generateRunId,
  runPrefixFor,
  safeBaseEnv,
} from './lib/config';
import { RestClient, login, mintApiToken } from './lib/rest-client';
import { cleanupByPrefix } from './lib/cleanup';
import { runSetup } from './lib/setup';
import { writeMcpConfig } from './lib/mcp-config';
import { loadAllScenarios, renderScenario } from './lib/scenario';
import { parseTranscriptText } from './lib/transcript-parser';
import { runVerification } from './lib/verify';
import { computeFriction } from './lib/friction';
import { renderFrictionReport } from './lib/report';
import type { ScenarioRunResult } from './types';

const MCP_SERVER_NAME = 'vikunja-battle';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function log(msg: string): void {
  // eslint-disable-next-line no-console -- CLI script, not src/
  console.log(`[battle] ${msg}`);
}

// ============================================================================
// CLI args
// ============================================================================

interface CliArgs {
  list: boolean;
  all: boolean;
  scenarioId?: string;
  modelOverride?: string;
  timeoutMs: number;
  keep: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { list: false, all: false, timeoutMs: DEFAULT_TIMEOUT_MS, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') args.list = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--keep') args.keep = true;
    else if (arg === '--scenario') args.scenarioId = argv[++i];
    else if (arg === '--model') args.modelOverride = argv[++i];
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  log('Usage:');
  log('  npm run battle -- --list');
  log('  npm run battle -- --scenario <id> [--model <alias>] [--timeout-ms <n>] [--keep]');
  log('  npm run battle -- --all [--model <alias>]');
  log('');
  log('No default run: you must pass --list, --scenario <id>, or --all.');
}

// ============================================================================
// Build + credentials
// ============================================================================

function buildProject(): void {
  log('Building project (npm run build) so the agent exercises current code...');
  const result = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`npm run build failed with exit code ${String(result.status)}`);
  }
}

async function getCredentials(): Promise<string> {
  log(`Logging in as '${TEST_USERNAME}' against ${VIKUNJA_URL}...`);
  const jwt = await login(VIKUNJA_URL, TEST_USERNAME, TEST_PASSWORD);
  log('Minting a fresh API token via PUT /tokens...');
  const token = await mintApiToken(VIKUNJA_URL, jwt, TOKEN_TITLE);
  if (token) {
    log('Obtained tk_* API token.');
    return token;
  }
  log('Falling back to the JWT itself as the API token.');
  return jwt;
}

// ============================================================================
// Spawning the headless agent
// ============================================================================

interface AgentRunOutcome {
  transcriptText: string;
  stderrText: string;
  timedOut: boolean;
  exitCode: number | null;
}

function runHeadlessAgent(params: {
  prompt: string;
  mcpConfigPath: string;
  model?: string;
  timeoutMs: number;
}): Promise<AgentRunOutcome> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      params.prompt,
      '--mcp-config',
      params.mcpConfigPath,
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--tools',
      'ToolSearch',
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
    ];
    if (params.model) args.push('--model', params.model);

    const child = spawn('claude', args, { cwd: REPO_ROOT, env: safeBaseEnv() });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, params.timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ transcriptText: stdout, stderrText: stderr, timedOut, exitCode: code });
    });
  });
}

// ============================================================================
// Per-scenario run
// ============================================================================

async function runOneScenario(params: {
  scenario: import('./types').Scenario;
  runId: string;
  vikunjaToken: string;
  modelOverride?: string;
  timeoutMs: number;
  keep: boolean;
}): Promise<ScenarioRunResult> {
  const { scenario, runId, vikunjaToken, modelOverride, timeoutMs, keep } = params;
  const scenarioPrefix = `${runPrefixFor(runId)}${scenario.id}-`;
  const rendered = renderScenario(scenario, scenarioPrefix);

  const client = new RestClient(VIKUNJA_URL, vikunjaToken);

  const traceDir = path.join(BATTLE_RESULTS_DIR, runId, scenario.id);
  ensureDir(traceDir);
  const transcriptPath = path.join(traceDir, 'transcript.jsonl');
  const verdictPath = path.join(traceDir, 'verdict.json');
  const mcpConfigPath = path.join(traceDir, 'mcp-config.json');
  const promptPath = path.join(traceDir, 'prompt.txt');

  log(`[${scenario.id}] cleanup-before (prefix "${scenarioPrefix}")...`);
  const before = await cleanupByPrefix(client, scenarioPrefix);
  if (before.errors.length > 0) log(`[${scenario.id}]   cleanup-before warnings: ${before.errors.join('; ')}`);

  if (rendered.setup.length > 0) {
    log(`[${scenario.id}] seeding ${rendered.setup.length} setup action(s)...`);
    const setupResult = await runSetup(client, rendered.setup);
    if (setupResult.errors.length > 0) log(`[${scenario.id}]   setup warnings: ${setupResult.errors.join('; ')}`);
  }

  writeMcpConfig(mcpConfigPath, {
    vikunjaUrl: VIKUNJA_URL,
    vikunjaApiToken: vikunjaToken,
    distEntry: DIST_ENTRY,
    serverName: MCP_SERVER_NAME,
  });
  fs.writeFileSync(promptPath, rendered.prompt);

  const model = modelOverride ?? scenario.model;
  log(`[${scenario.id}] spawning claude -p (model: ${model ?? 'default'}, timeout: ${timeoutMs}ms)...`);
  const outcome = await runHeadlessAgent({ prompt: rendered.prompt, mcpConfigPath, model, timeoutMs });
  fs.writeFileSync(transcriptPath, outcome.transcriptText);
  if (outcome.stderrText) fs.writeFileSync(path.join(traceDir, 'stderr.log'), outcome.stderrText);
  if (outcome.timedOut) log(`[${scenario.id}]   WARNING: agent run timed out after ${timeoutMs}ms and was killed.`);

  const transcript = parseTranscriptText(outcome.transcriptText);

  log(`[${scenario.id}] verifying end state via direct REST...`);
  const verification = await runVerification(scenario, rendered.checks, client);
  const friction = computeFriction(scenario, transcript, MCP_SERVER_NAME);

  fs.writeFileSync(
    verdictPath,
    JSON.stringify({ scenario: scenario.id, verification, friction, timedOut: outcome.timedOut, exitCode: outcome.exitCode }, null, 2),
  );

  if (!keep) {
    log(`[${scenario.id}] cleanup-after (prefix "${scenarioPrefix}")...`);
    const after = await cleanupByPrefix(client, scenarioPrefix);
    if (after.errors.length > 0) log(`[${scenario.id}]   cleanup-after warnings: ${after.errors.join('; ')}`);
  } else {
    log(`[${scenario.id}] --keep set: leaving scenario data in place for inspection.`);
  }

  log(
    `[${scenario.id}] verdict: ${verification.passed ? 'PASS' : 'FAIL'} -- ${friction.toolCallCount} calls ` +
      `(optimal ${friction.optimalCallCount}), ${friction.invalidArgErrorCount} validation error(s), ` +
      `${friction.retryCount} retr(y/ies)`,
  );

  return { scenario, runPrefix: scenarioPrefix, verification, friction, transcriptPath, verdictPath };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const allScenarios = loadAllScenarios(SCENARIOS_DIR);

  if (args.list) {
    log(`${allScenarios.length} scenario(s) available:`);
    for (const s of allScenarios) {
      log(`  ${s.id.padEnd(28)} optimal=${s.optimalCallCount}  ${s.title}`);
    }
    return;
  }

  if (!args.all && !args.scenarioId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  assertLocalUrl(VIKUNJA_URL);

  const scenariosToRun = args.all ? allScenarios : allScenarios.filter((s) => s.id === args.scenarioId);
  if (scenariosToRun.length === 0) {
    throw new Error(
      `No scenario with id "${String(args.scenarioId)}" found. Available: ${allScenarios.map((s) => s.id).join(', ')}`,
    );
  }

  buildProject();
  if (!fs.existsSync(DIST_ENTRY)) {
    throw new Error(`Build did not produce ${DIST_ENTRY} -- cannot spawn the MCP server.`);
  }

  const runId = generateRunId();
  log(`Run id: ${runId}`);

  const vikunjaToken = await getCredentials();

  // Sweep any leftover battle-* data from a previous crashed run under a
  // different run id -- belt-and-suspenders on top of each scenario's own
  // before/after cleanup (see docs/BATTLE-TESTING.md).
  const globalClient = new RestClient(VIKUNJA_URL, vikunjaToken);
  log("Sweeping any leftover 'battle-*' data from prior runs before starting...");
  const sweep = await cleanupByPrefix(globalClient, 'battle-');
  log(`  swept ${sweep.deletedProjects} project(s), ${sweep.deletedLabels} label(s).`);

  const results: ScenarioRunResult[] = [];
  for (const scenario of scenariosToRun) {
    const result = await runOneScenario({
      scenario,
      runId,
      vikunjaToken,
      modelOverride: args.modelOverride,
      timeoutMs: args.timeoutMs,
      keep: args.keep,
    });
    results.push(result);
  }

  const reportPath = path.join(BATTLE_RESULTS_DIR, runId, 'friction-report.md');
  fs.writeFileSync(reportPath, renderFrictionReport(runId, results));
  log(`Wrote aggregated friction report: ${reportPath}`);

  const passed = results.filter((r) => r.verification.passed).length;
  log(`\n=== Summary: ${passed}/${results.length} scenario(s) passed verification ===`);
  for (const r of results) {
    log(`  ${r.verification.passed ? 'PASS' : 'FAIL'}  ${r.scenario.id}`);
  }

  if (passed < results.length) process.exitCode = 1;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[battle] Fatal error:', e);
  process.exitCode = 1;
});
