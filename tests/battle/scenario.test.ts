import { loadAllScenarios, renderScenario } from '../../scripts/battle/lib/scenario';
import { ScenarioSchema } from '../../scripts/battle/types';
import { SCENARIOS_DIR } from '../../scripts/battle/lib/config';

describe('renderScenario', () => {
  it('substitutes {{prefix}} in both the prompt and every verify check string field', () => {
    const scenario = ScenarioSchema.parse({
      id: 'fixture',
      title: 'Fixture',
      promptTemplate: 'Create a project called "{{prefix}}Demo" with a task "{{prefix}}task-1".',
      optimalCallCount: 2,
      verify: [
        { type: 'project-exists', titleContains: '{{prefix}}Demo' },
        { type: 'min-tasks-in-project', projectTitleContains: '{{prefix}}Demo', min: 1 },
      ],
    });

    const rendered = renderScenario(scenario, 'battle-abc123-fixture-');

    expect(rendered.prompt).toBe('Create a project called "battle-abc123-fixture-Demo" with a task "battle-abc123-fixture-task-1".');
    expect(rendered.checks[0]).toMatchObject({ type: 'project-exists', titleContains: 'battle-abc123-fixture-Demo' });
    expect(rendered.checks[1]).toMatchObject({ projectTitleContains: 'battle-abc123-fixture-Demo', min: 1 });
  });

  it('leaves non-string check fields (numbers, enums) untouched', () => {
    const scenario = ScenarioSchema.parse({
      id: 'fixture2',
      title: 'Fixture 2',
      promptTemplate: '{{prefix}} whatever',
      optimalCallCount: 1,
      verify: [{ type: 'tasks-field-match-count', projectTitleContains: '{{prefix}}P', field: 'priority', op: 'gte', value: 4, min: 3 }],
    });

    const rendered = renderScenario(scenario, 'battle-xyz-fixture2-');

    expect(rendered.checks[0]).toMatchObject({ field: 'priority', op: 'gte', value: 4, min: 3 });
  });
});

describe('renderScenario setup actions', () => {
  it('substitutes {{prefix}} in setup action string fields and defaults to an empty array when setup is absent', () => {
    const withoutSetup = ScenarioSchema.parse({
      id: 'no-setup',
      title: 'No setup',
      promptTemplate: 'do the thing',
      optimalCallCount: 1,
      verify: [{ type: 'project-exists', titleContains: 'x' }],
    });
    expect(renderScenario(withoutSetup, 'battle-abc-').setup).toEqual([]);

    const withSetup = ScenarioSchema.parse({
      id: 'with-setup',
      title: 'With setup',
      promptTemplate: 'do the thing',
      optimalCallCount: 1,
      setup: [{ type: 'create-label', title: '{{prefix}}existing-tag' }],
      verify: [{ type: 'project-exists', titleContains: 'x' }],
    });

    const rendered = renderScenario(withSetup, 'battle-abc-');
    expect(rendered.setup).toEqual([{ type: 'create-label', title: 'battle-abc-existing-tag' }]);
  });
});

describe('shipped scenario library (scripts/battle/scenarios/*.json)', () => {
  const scenarios = loadAllScenarios(SCENARIOS_DIR);

  it('ships between 6 and 15 scenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(6);
    expect(scenarios.length).toBeLessThanOrEqual(15);
  });

  it('has unique ids', () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('single-task-smoke remains the designated cheap live-smoke-test scenario', () => {
    // Historically the unique global minimum of optimalCallCount. That
    // invariant no longer holds unconditionally: a one-call composite that
    // provisions an entire structure (e.g. setup-kanban, issue #173) can
    // legitimately need FEWER calls than single-task-smoke's two primitive
    // calls (create-project + create-task) — q3-offsite-kanban and
    // setup-kanban-composite are both now estimated at 1 call. That's
    // expected and desired (it's the whole point of shipping the
    // composite), not a regression in single-task-smoke's designated role:
    // it remains docs/BATTLE-TESTING.md's/docs/RELEASING.md's named
    // live-smoke-test scenario because it is the simplest and most
    // deterministic to run, not because it is the lowest call count.
    const singleTaskSmoke = scenarios.find((s) => s.id === 'single-task-smoke');
    expect(singleTaskSmoke).toBeDefined();
    expect(singleTaskSmoke?.optimalCallCount).toBeLessThanOrEqual(3);
  });

  it.each(loadAllScenarios(SCENARIOS_DIR).map((s) => [s.id, s] as const))('%s renders and every check/setup action substitutes cleanly', (_id, scenario) => {
    const rendered = renderScenario(scenario, 'battle-testrun-x-');
    expect(rendered.prompt).not.toContain('{{prefix}}');
    for (const check of rendered.checks) {
      for (const value of Object.values(check)) {
        if (typeof value === 'string') expect(value).not.toContain('{{prefix}}');
      }
    }
    for (const action of rendered.setup) {
      for (const value of Object.values(action)) {
        if (typeof value === 'string') expect(value).not.toContain('{{prefix}}');
      }
    }
  });

  it('at least one shipped scenario seeds data via `setup` (evidence-gap coverage for find-then-apply flows)', () => {
    expect(scenarios.some((s) => (s.setup ?? []).length > 0)).toBe(true);
  });
});
