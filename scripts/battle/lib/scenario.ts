/**
 * Scenario loading + `{{prefix}}` substitution.
 *
 * Scenario JSON files (scripts/battle/scenarios/*.json) write their prompt
 * and every `verify` check's `*TitleContains` field using the literal
 * placeholder `{{prefix}}`. `renderScenario` substitutes it with the run's
 * unique `battle-<runid>-` prefix in both places at once, so the prompt the
 * agent sees and the titles verification looks for always agree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ScenarioSchema, type Scenario, type VerifyCheck } from '../types';

const PLACEHOLDER = '{{prefix}}';

function substitute(value: string, prefix: string): string {
  return value.split(PLACEHOLDER).join(prefix);
}

/** Recursively substitutes `{{prefix}}` in every string field of a verify check. */
function substituteCheck(check: VerifyCheck, prefix: string): VerifyCheck {
  const out: Record<string, unknown> = { ...check };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string') out[key] = substitute(value, prefix);
  }
  return out as VerifyCheck;
}

export interface RenderedScenario {
  scenario: Scenario;
  prompt: string;
  checks: VerifyCheck[];
}

export function renderScenario(scenario: Scenario, prefix: string): RenderedScenario {
  return {
    scenario,
    prompt: substitute(scenario.promptTemplate, prefix),
    checks: scenario.verify.map((c) => substituteCheck(c, prefix)),
  };
}

export function loadScenario(filePath: string): Scenario {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return ScenarioSchema.parse(raw);
}

export function loadAllScenarios(dir: string): Scenario[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((f) => loadScenario(path.join(dir, f)));
}
