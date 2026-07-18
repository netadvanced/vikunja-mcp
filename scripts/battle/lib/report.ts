/**
 * Renders the aggregated, cross-scenario friction report (markdown) that
 * ranks friction sources across a battle-testing run -- the artifact meant
 * to feed future tool-description/composite-tool improvement waves (see
 * docs/BATTLE-TESTING.md).
 */

import type { ScenarioRunResult } from '../types';

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function rankLine(label: string, value: number, unit = ''): string {
  return `- **${label}**: ${value}${unit}`;
}

export function renderFrictionReport(runId: string, results: ScenarioRunResult[]): string {
  const lines: string[] = [];
  lines.push(`# Battle-testing friction report -- run \`${runId}\``);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Scenarios run: ${results.length}`);
  lines.push('');

  const passed = results.filter((r) => r.verification.passed).length;
  lines.push(`## Verdict summary`);
  lines.push('');
  lines.push(`DID IT WORK: ${passed}/${results.length} scenarios fully passed verification.`);
  lines.push('');
  lines.push('| Scenario | Verdict | Calls (actual/optimal) | Validation errors | Retries | ToolSearch calls | Wrong-tool attempts | Tokens | Wall time |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const v = r.verification.passed ? 'PASS' : 'FAIL';
    const f = r.friction;
    lines.push(
      `| ${r.scenario.title} | ${v} | ${f.toolCallCount}/${f.optimalCallCount} (${fmtPct(f.callCountRatio)}) | ` +
        `${f.invalidArgErrorCount} | ${f.retryCount} | ${f.toolSearchCallCount} | ${f.wrongToolAttemptCount} | ${f.totalTokens} | ${(f.wallTimeMs / 1000).toFixed(1)}s |`,
    );
  }
  lines.push('');

  lines.push('## Friction ranking (most calls over optimal first)');
  lines.push('');
  const ranked = [...results].sort((a, b) => b.friction.callCountRatio - a.friction.callCountRatio);
  for (const r of ranked) {
    lines.push(`### ${r.scenario.title} (\`${r.scenario.id}\`)`);
    lines.push('');
    lines.push(rankLine('Verdict', 0).replace('0', r.verification.passed ? 'PASS' : 'FAIL'));
    lines.push(rankLine('Tool calls', r.friction.toolCallCount) + ` (optimal estimate: ${r.friction.optimalCallCount})`);
    lines.push(rankLine('Validation/argument errors', r.friction.invalidArgErrorCount));
    lines.push(rankLine('Retries (byte-identical repeats)', r.friction.retryCount));
    lines.push(rankLine('ToolSearch discovery calls', r.friction.toolSearchCallCount));
    lines.push(rankLine('Wrong-tool attempts', r.friction.wrongToolAttemptCount));
    lines.push(rankLine('Total tokens', r.friction.totalTokens));
    lines.push(rankLine('Wall time', Number((r.friction.wallTimeMs / 1000).toFixed(1)), 's'));
    lines.push(rankLine('Cost', Number(r.friction.totalCostUsd.toFixed(4)), ' USD'));
    if (r.friction.frictionNotes.length > 0) {
      lines.push('');
      lines.push('Notes:');
      for (const note of r.friction.frictionNotes) lines.push(`- ${note}`);
    }
    if (!r.verification.passed) {
      lines.push('');
      lines.push('Failed checks:');
      for (const c of r.verification.checks.filter((c) => !c.passed)) {
        lines.push(`- \`${c.check.type}\`: ${c.detail}`);
      }
    }
    lines.push('');
  }

  lines.push('## Traces');
  lines.push('');
  for (const r of results) {
    lines.push(`- \`${r.scenario.id}\`: transcript at \`${r.transcriptPath}\`, verdict at \`${r.verdictPath}\``);
  }
  lines.push('');

  return lines.join('\n');
}
