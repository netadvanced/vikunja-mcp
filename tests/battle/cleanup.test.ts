import { cleanupByPrefix } from '../../scripts/battle/lib/cleanup';
import { FakeRestClient } from './helpers/fake-rest-client';

describe('cleanupByPrefix', () => {
  it('only touches projects/labels whose title starts with the given prefix', async () => {
    const client = new FakeRestClient();
    client.projects = [
      { id: 1, title: 'battle-run1-Foo' },
      { id: 2, title: 'Inbox' },
      { id: 3, title: 'MCP-Test' },
    ];
    client.tasksByProject[1] = [{ id: 10, title: 'battle-run1-task', project_id: 1 }];
    client.labels = [
      { id: 5, title: 'battle-run1-urgent' },
      { id: 6, title: 'someone-elses-label' },
    ];

    const result = await cleanupByPrefix(client, 'battle-run1-');

    expect(result.deletedProjects).toBe(1);
    expect(result.deletedLabels).toBe(1);
    expect(result.errors).toEqual([]);
    expect(client.deletedProjectIds).toEqual([1]);
    expect(client.deletedTaskIds).toEqual([10]);
    expect(client.deletedLabelIds).toEqual([5]);
  });

  it('deletes every task in a matched project before deleting the project itself', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'battle-run1-Foo' }];
    client.tasksByProject[1] = [
      { id: 10, title: 't1', project_id: 1 },
      { id: 11, title: 't2', project_id: 1 },
    ];

    await cleanupByPrefix(client, 'battle-run1-');

    expect(client.deletedTaskIds.sort()).toEqual([10, 11]);
    expect(client.deletedProjectIds).toEqual([1]);
  });

  it('is a no-op (zero deletions, zero errors) when nothing matches the prefix', async () => {
    const client = new FakeRestClient();
    client.projects = [{ id: 1, title: 'Inbox' }];
    client.labels = [{ id: 2, title: 'unrelated' }];

    const result = await cleanupByPrefix(client, 'battle-run1-');

    expect(result).toEqual({ deletedProjects: 0, deletedLabels: 0, errors: [] });
  });

  it('records a project-deletion failure as an error and continues the sweep rather than throwing', async () => {
    const client = new FakeRestClient();
    client.projects = [
      { id: 1, title: 'battle-run1-Bad' },
      { id: 2, title: 'battle-run1-Good' },
    ];
    client.tasksByProject[1] = [];
    client.tasksByProject[2] = [];
    client.failDeleteProjectIds.add(1);

    const result = await cleanupByPrefix(client, 'battle-run1-');

    expect(result.deletedProjects).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('battle-run1-Bad');
    expect(client.deletedProjectIds).toEqual([2]);
  });

  it('sweeps by the bare "battle-" root prefix across multiple distinct run ids', async () => {
    const client = new FakeRestClient();
    client.projects = [
      { id: 1, title: 'battle-run1-Foo' },
      { id: 2, title: 'battle-run2-Bar' },
      { id: 3, title: 'Inbox' },
    ];
    client.tasksByProject = { 1: [], 2: [] };

    const result = await cleanupByPrefix(client, 'battle-');

    expect(result.deletedProjects).toBe(2);
    expect(client.deletedProjectIds.sort()).toEqual([1, 2]);
  });
});
