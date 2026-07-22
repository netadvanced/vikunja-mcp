import { runVerification } from '../../scripts/battle/lib/verify';
import type { VerifyCheck } from '../../scripts/battle/types';
import { FakeRestClient } from './helpers/fake-rest-client';

function scenario(): { id: string } {
  return { id: 'fixture' };
}

describe('runVerification / project-exists', () => {
  it('passes when a project with a matching title substring exists', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-abc-Q3 Offsite' }];
    const checks: VerifyCheck[] = [{ type: 'project-exists', titleContains: 'Q3 Offsite' }];

    const verdict = await runVerification(scenario(), checks, client);

    expect(verdict.passed).toBe(true);
    expect(verdict.checks[0]?.passed).toBe(true);
  });

  it('fails when no project title contains the substring', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-abc-Unrelated' }];
    const checks: VerifyCheck[] = [{ type: 'project-exists', titleContains: 'Q3 Offsite' }];

    const verdict = await runVerification(scenario(), checks, client);

    expect(verdict.passed).toBe(false);
    expect(verdict.checks[0]?.detail).toContain('no project with title containing');
  });
});

describe('runVerification / min-tasks-in-project', () => {
  it('fails cleanly when the project itself does not exist', async () => {
    const client = new FakeRestClient();
    const checks: VerifyCheck[] = [{ type: 'min-tasks-in-project', projectTitleContains: 'nope', min: 1 }];
    const verdict = await runVerification(scenario(), checks, client);
    expect(verdict.passed).toBe(false);
  });

  it('passes only once the task count reaches min', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 5, title: 'battle-x-Sprint' }];
    client.tasksByProject[5] = [
      { id: 1, title: 't1', project_id: 5 },
      { id: 2, title: 't2', project_id: 5 },
    ];
    const checks: VerifyCheck[] = [{ type: 'min-tasks-in-project', projectTitleContains: 'Sprint', min: 3 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(false);

    client.tasksByProject[5]!.push({ id: 3, title: 't3', project_id: 5 });
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);
  });
});

describe('runVerification / min-buckets-in-project', () => {
  it('counts buckets returned for the resolved project (kanban-view resolution is RestClient\'s own concern, per the VikunjaRestClient contract)', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 7, title: 'battle-x-Board' }];
    client.buckets[7] = [{ id: 10, title: 'To do' }, { id: 11, title: 'Doing' }, { id: 12, title: 'Done' }];
    const checks: VerifyCheck[] = [{ type: 'min-buckets-in-project', projectTitleContains: 'Board', min: 3 }];
    const verdict = await runVerification(scenario(), checks, client);
    expect(verdict.passed).toBe(true);
  });

  it('fails when there are fewer buckets than required', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 7, title: 'battle-x-Board' }];
    client.buckets[7] = [{ id: 10, title: 'To do' }];
    const checks: VerifyCheck[] = [{ type: 'min-buckets-in-project', projectTitleContains: 'Board', min: 3 }];
    const verdict = await runVerification(scenario(), checks, client);
    expect(verdict.passed).toBe(false);
  });
});

describe('runVerification / buckets-with-tasks-count', () => {
  it('counts only buckets whose `count` field is greater than zero, distinguishing "buckets exist" from "tasks were actually moved into them"', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 7, title: 'battle-x-Sprint Board' }];
    client.buckets[7] = [
      { id: 10, title: 'To Do', count: 3 },
      { id: 11, title: 'Doing', count: 3 },
      { id: 12, title: 'Done', count: 0 },
    ];
    const checks: VerifyCheck[] = [{ type: 'buckets-with-tasks-count', projectTitleContains: 'Sprint Board', min: 3 }];
    const verdict = await runVerification(scenario(), checks, client);
    expect(verdict.passed).toBe(false);
    expect(verdict.checks[0]?.detail).toContain('2/3');
  });

  it('passes once every targeted bucket holds at least one task', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 7, title: 'battle-x-Sprint Board' }];
    client.buckets[7] = [
      { id: 10, title: 'To Do', count: 3 },
      { id: 11, title: 'Doing', count: 3 },
      { id: 12, title: 'Done', count: 3 },
    ];
    const checks: VerifyCheck[] = [{ type: 'buckets-with-tasks-count', projectTitleContains: 'Sprint Board', min: 3 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);
  });

  it('fails cleanly when the project itself does not exist', async () => {
    const client = new FakeRestClient();
    const checks: VerifyCheck[] = [{ type: 'buckets-with-tasks-count', projectTitleContains: 'nope', min: 1 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(false);
  });

  it('treats a bucket with an undefined `count` as empty', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 7, title: 'battle-x-Board' }];
    client.buckets[7] = [{ id: 10, title: 'To Do' }];
    const checks: VerifyCheck[] = [{ type: 'buckets-with-tasks-count', projectTitleContains: 'Board', min: 1 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(false);
  });
});

describe('runVerification / tasks-field-match-count', () => {
  const client = new FakeRestClient();
  client.projects = [{ id: 1, title: 'battle-x-P' }];
  client.tasksByProject[1] = [
    { id: 1, title: 'a', project_id: 1, priority: 5, done: true },
    { id: 2, title: 'b', project_id: 1, priority: 1, done: false },
    { id: 3, title: 'c', project_id: 1, priority: 0, done: false },
  ];

  it('supports "set" (non-default value present)', async () => {
    const checks: VerifyCheck[] = [{ type: 'tasks-field-match-count', projectTitleContains: 'P', field: 'priority', op: 'set', min: 2 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);
  });

  it('supports "gte"', async () => {
    const checks: VerifyCheck[] = [{ type: 'tasks-field-match-count', projectTitleContains: 'P', field: 'priority', op: 'gte', value: 5, min: 1 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);
  });

  it('supports "eq" on a boolean field (done)', async () => {
    const checks: VerifyCheck[] = [{ type: 'tasks-field-match-count', projectTitleContains: 'P', field: 'done', op: 'eq', value: true, min: 1 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);

    const checksTooMany: VerifyCheck[] = [{ type: 'tasks-field-match-count', projectTitleContains: 'P', field: 'done', op: 'eq', value: true, min: 2 }];
    expect((await runVerification(scenario(), checksTooMany, client)).passed).toBe(false);
  });
});

describe('runVerification / tasks-due-date-in-range', () => {
  it('excludes Vikunja\'s "no due date" epoch sentinel from matching any range', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-x-P' }];
    client.tasksByProject[1] = [
      { id: 1, title: 'a', project_id: 1, due_date: '0001-01-01T00:00:00Z' },
      { id: 2, title: 'b', project_id: 1, due_date: '2026-09-15T00:00:00Z' },
    ];
    const checks: VerifyCheck[] = [
      { type: 'tasks-due-date-in-range', projectTitleContains: 'P', startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-30T23:59:59Z', min: 2 },
    ];
    const verdict = await runVerification(scenario(), checks, client);
    expect(verdict.passed).toBe(false);
    expect(verdict.checks[0]?.detail).toContain('1/2');
  });
});

describe('runVerification / label-exists and tasks-with-label-count', () => {
  it('finds labels by substring and counts tasks carrying them via the per-task labels endpoint', async () => {
    const client = new FakeRestClient();
    client.labels = [{ id: 1, title: 'battle-x-urgent' }];
    client.projects = [{ id: 1, title: 'battle-x-Sprint' }];
    client.tasksByProject[1] = [
      { id: 10, title: 't1', project_id: 1 },
      { id: 11, title: 't2', project_id: 1 },
    ];
    client.labelsByTask[10] = [{ id: 1, title: 'battle-x-urgent' }];
    client.labelsByTask[11] = [];

    const labelCheck: VerifyCheck[] = [{ type: 'label-exists', titleContains: 'urgent' }];
    expect((await runVerification(scenario(), labelCheck, client)).passed).toBe(true);

    const countCheck: VerifyCheck[] = [{ type: 'tasks-with-label-count', projectTitleContains: 'Sprint', labelTitleContains: 'urgent', min: 1 }];
    expect((await runVerification(scenario(), countCheck, client)).passed).toBe(true);

    const countCheckTooMany: VerifyCheck[] = [{ type: 'tasks-with-label-count', projectTitleContains: 'Sprint', labelTitleContains: 'urgent', min: 2 }];
    expect((await runVerification(scenario(), countCheckTooMany, client)).passed).toBe(false);
  });
});

describe('runVerification / task-has-subtasks', () => {
  it('reads subtasks off the parent\'s related_tasks.subtask array', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-x-Launch' }];
    client.tasksByProject[1] = [
      {
        id: 1,
        title: 'battle-x-Prepare launch',
        project_id: 1,
        related_tasks: { subtask: [{ id: 2, title: 'child1', project_id: 1 }, { id: 3, title: 'child2', project_id: 1 }] },
      },
    ];
    const checks: VerifyCheck[] = [{ type: 'task-has-subtasks', projectTitleContains: 'Launch', parentTitleContains: 'Prepare launch', min: 2 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);

    const tooMany: VerifyCheck[] = [{ type: 'task-has-subtasks', projectTitleContains: 'Launch', parentTitleContains: 'Prepare launch', min: 3 }];
    expect((await runVerification(scenario(), tooMany, client)).passed).toBe(false);
  });

  it('fails when no task matches the parent title substring', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-x-Launch' }];
    client.tasksByProject[1] = [{ id: 1, title: 'unrelated', project_id: 1 }];
    const checks: VerifyCheck[] = [{ type: 'task-has-subtasks', projectTitleContains: 'Launch', parentTitleContains: 'Prepare launch', min: 1 }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(false);
  });
});

describe('runVerification / project-has-share', () => {
  it('passes once at least one link share exists', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-x-Roadmap' }];
    client.shares[1] = [{ id: 1, hash: 'abc' }];
    const checks: VerifyCheck[] = [{ type: 'project-has-share', projectTitleContains: 'Roadmap' }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(true);
  });

  it('fails when there are zero shares', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-x-Roadmap' }];
    const checks: VerifyCheck[] = [{ type: 'project-has-share', projectTitleContains: 'Roadmap' }];
    expect((await runVerification(scenario(), checks, client)).passed).toBe(false);
  });
});

describe('runVerification / overall verdict', () => {
  it('passes only when every check passes', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-x-P' }];
    client.tasksByProject[1] = [{ id: 1, title: 't', project_id: 1 }];
    const checks: VerifyCheck[] = [
      { type: 'project-exists', titleContains: 'P' },
      { type: 'min-tasks-in-project', projectTitleContains: 'P', min: 5 }, // will fail: only 1 task
    ];
    const verdict = await runVerification(scenario(), checks, client);
    expect(verdict.passed).toBe(false);
    expect(verdict.checks[0]?.passed).toBe(true);
    expect(verdict.checks[1]?.passed).toBe(false);
  });
});
