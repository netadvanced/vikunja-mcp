/**
 * Verification engine ("DID IT WORK"): executes a scenario's `verify` spec
 * against the live Vikunja REST API via `RestClient`. Never trusts the
 * agent's own transcript/self-report -- every check here is an independent
 * REST read, exactly like a human re-opening the Vikunja UI to check an
 * agent's claimed work.
 *
 * Vikunja represents "no due date" as the epoch sentinel
 * `0001-01-01T00:00:00Z`, not `null` (confirmed against a live 2.3.0 stack
 * while building this harness) -- `hasRealDueDate` below is the only place
 * that sentinel needs to be known.
 */

import type { CheckVerdict, Scenario, VerifyCheck, VerificationVerdict } from '../types';
import type { VikunjaProject, VikunjaRestClient, VikunjaTask } from './rest-client';

const NO_DUE_DATE_SENTINEL = '0001-01-01T00:00:00Z';

function hasRealDueDate(task: VikunjaTask): boolean {
  return Boolean(task.due_date) && task.due_date !== NO_DUE_DATE_SENTINEL;
}

async function findProject(client: VikunjaRestClient, titleContains: string): Promise<VikunjaProject | undefined> {
  const projects = await client.listProjects();
  return projects.find((p) => p.title.includes(titleContains));
}

function fieldMatches(
  task: VikunjaTask,
  field: 'priority' | 'done' | 'due_date' | 'percent_done',
  op: 'gte' | 'eq' | 'set',
  value: number | boolean | undefined,
): boolean {
  switch (field) {
    case 'priority':
    case 'percent_done': {
      const actual = task[field] ?? 0;
      if (op === 'set') return actual > 0;
      if (typeof value !== 'number') return false;
      return op === 'gte' ? actual >= value : actual === value;
    }
    case 'done': {
      if (op === 'set') return task.done === true;
      return task.done === Boolean(value);
    }
    case 'due_date': {
      // "gte"/"eq" on a due date isn't meaningful without a richer date
      // check type -- scenarios needing a date range use
      // "tasks-due-date-in-range" instead. "set" is the only supported op
      // here (mirrored by the zod schema not requiring `value` for it).
      return hasRealDueDate(task);
    }
    default:
      return false;
  }
}

async function runCheck(client: VikunjaRestClient, check: VerifyCheck): Promise<CheckVerdict> {
  switch (check.type) {
    case 'project-exists': {
      const project = await findProject(client, check.titleContains);
      return {
        check,
        passed: Boolean(project),
        detail: project
          ? `found project "${project.title}" (id ${project.id})`
          : `no project with title containing "${check.titleContains}"`,
      };
    }

    case 'min-tasks-in-project': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const tasks = await client.listTasksInProject(project.id);
      return {
        check,
        passed: tasks.length >= check.min,
        detail: `project "${project.title}" has ${tasks.length} task(s), need >= ${check.min}`,
      };
    }

    case 'min-buckets-in-project': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const buckets = await client.listBuckets(project.id);
      return {
        check,
        passed: buckets.length >= check.min,
        detail: `project "${project.title}" has ${buckets.length} bucket(s) (${buckets.map((b) => b.title).join(', ') || 'none'}), need >= ${check.min}`,
      };
    }

    case 'buckets-with-tasks-count': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const buckets = await client.listBuckets(project.id);
      const nonEmpty = buckets.filter((b) => (b.count ?? 0) > 0);
      return {
        check,
        passed: nonEmpty.length >= check.min,
        detail:
          `${nonEmpty.length}/${buckets.length} bucket(s) in "${project.title}" hold at least one task ` +
          `(${buckets.map((b) => `${b.title}: ${b.count ?? 0}`).join(', ') || 'none'}), need >= ${check.min}`,
      };
    }

    case 'tasks-field-match-count': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const tasks = await client.listTasksInProject(project.id);
      const matching = tasks.filter((t) => fieldMatches(t, check.field, check.op, check.value));
      return {
        check,
        passed: matching.length >= check.min,
        detail:
          `${matching.length}/${tasks.length} task(s) in "${project.title}" match ` +
          `${check.field} ${check.op}${check.value !== undefined ? ` ${String(check.value)}` : ''}, need >= ${check.min}`,
      };
    }

    case 'tasks-due-date-in-range': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const start = new Date(check.startDate).getTime();
      const end = new Date(check.endDate).getTime();
      const tasks = await client.listTasksInProject(project.id);
      const matching = tasks.filter((t) => {
        if (!hasRealDueDate(t) || !t.due_date) return false;
        const due = new Date(t.due_date).getTime();
        return due >= start && due <= end;
      });
      return {
        check,
        passed: matching.length >= check.min,
        detail:
          `${matching.length}/${tasks.length} task(s) in "${project.title}" have a due date in ` +
          `[${check.startDate}, ${check.endDate}], need >= ${check.min}`,
      };
    }

    case 'label-exists': {
      const labels = await client.listLabels();
      const label = labels.find((l) => l.title.includes(check.titleContains));
      return {
        check,
        passed: Boolean(label),
        detail: label ? `found label "${label.title}" (id ${label.id})` : `no label with title containing "${check.titleContains}"`,
      };
    }

    case 'tasks-with-label-count': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const tasks = await client.listTasksInProject(project.id);
      let matching = 0;
      for (const task of tasks) {
        const labels = await client.requestOrEmpty<{ id: number; title: string }>(`/tasks/${task.id}/labels`);
        if (labels.some((l) => l.title.includes(check.labelTitleContains))) matching += 1;
      }
      return {
        check,
        passed: matching >= check.min,
        detail:
          `${matching}/${tasks.length} task(s) in "${project.title}" carry a label containing ` +
          `"${check.labelTitleContains}", need >= ${check.min}`,
      };
    }

    case 'task-has-subtasks': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const tasks = await client.listTasksInProject(project.id);
      const parent = tasks.find((t) => t.title.includes(check.parentTitleContains));
      if (!parent) {
        return {
          check,
          passed: false,
          detail: `no task in "${project.title}" with title containing "${check.parentTitleContains}"`,
        };
      }
      const full = await client.getTask(parent.id);
      const subtasks = full.related_tasks?.subtask ?? [];
      return {
        check,
        passed: subtasks.length >= check.min,
        detail: `task "${parent.title}" (id ${parent.id}) has ${subtasks.length} subtask(s), need >= ${check.min}`,
      };
    }

    case 'project-has-share': {
      const project = await findProject(client, check.projectTitleContains);
      if (!project) {
        return { check, passed: false, detail: `no project with title containing "${check.projectTitleContains}"` };
      }
      const shares = await client.listShares(project.id);
      return {
        check,
        passed: shares.length >= 1,
        detail: `project "${project.title}" has ${shares.length} link share(s)`,
      };
    }
  }
}

export async function runVerification(scenario: Pick<Scenario, 'id'>, checks: VerifyCheck[], client: VikunjaRestClient): Promise<VerificationVerdict> {
  const results: CheckVerdict[] = [];
  for (const check of checks) {
    results.push(await runCheck(client, check));
  }
  return {
    scenarioId: scenario.id,
    passed: results.every((r) => r.passed),
    checks: results,
  };
}
