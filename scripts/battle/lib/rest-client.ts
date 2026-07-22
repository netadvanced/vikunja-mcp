/**
 * Minimal direct-REST client against the local Vikunja e2e stack, used
 * exclusively by the battle-testing harness for:
 *   1. minting the credential handed to the agent's MCP server child process
 *      (login + PUT /tokens, the same flow as docker/e2e/bootstrap.sh and
 *      scripts/mcp-e2e.ts), and
 *   2. verifying end state ("DID IT WORK") and sweeping `battle-*`-prefixed
 *      data before/after each run -- independently of whatever the agent's
 *      own tool calls claim happened (see docs/BATTLE-TESTING.md).
 *
 * This is intentionally separate from src/utils/vikunja-rest.ts (that's the
 * product's own direct-REST layer, used by the MCP tools themselves) --
 * this harness must observe the system from *outside* the tool surface it's
 * grading, exactly like a human double-checking the Vikunja UI after an
 * agent claims "done".
 */

export interface VikunjaProject {
  id: number;
  title: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  project_id: number;
  priority?: number;
  done?: boolean;
  percent_done?: number;
  due_date?: string | null;
  related_tasks?: Record<string, VikunjaTask[]>;
}

export interface VikunjaLabel {
  id: number;
  title: string;
}

export interface VikunjaBucket {
  id: number;
  title: string;
  /** Number of tasks currently in this bucket, per `models.Bucket.count` in the Vikunja OpenAPI spec -- used to verify actual task-to-bucket distribution, not just that the buckets themselves exist. */
  count?: number;
}

export interface VikunjaProjectView {
  id: number;
  title: string;
  view_kind?: string;
}

export interface VikunjaShare {
  id: number;
  hash?: string;
}

/**
 * Public contract used by the verification engine and cleanup sweep. A
 * plain interface (rather than requiring the concrete `RestClient` class)
 * so unit tests can supply a lightweight fake instead of a real class
 * instance -- see tests/battle/verify.test.ts and tests/battle/cleanup.test.ts.
 */
export interface VikunjaRestClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  requestOrEmpty<T>(path: string): Promise<T[]>;
  listProjects(): Promise<VikunjaProject[]>;
  listTasksInProject(projectId: number): Promise<VikunjaTask[]>;
  getTask(taskId: number): Promise<VikunjaTask>;
  listLabels(): Promise<VikunjaLabel[]>;
  listViews(projectId: number): Promise<VikunjaProjectView[]>;
  listBuckets(projectId: number): Promise<VikunjaBucket[]>;
  listShares(projectId: number): Promise<VikunjaShare[]>;
  deleteTask(taskId: number): Promise<void>;
  deleteProject(projectId: number): Promise<void>;
  deleteLabel(labelId: number): Promise<void>;
  /**
   * Seeds a label ahead of a scenario run (see scripts/battle/lib/setup.ts).
   * `PUT /labels` is the documented create endpoint (see docs/API_NOTES.md
   * and src/tools/labels.ts's own create call) -- POST does not exist for
   * this resource.
   */
  createLabel(title: string): Promise<VikunjaLabel>;
}

export class RestClient implements VikunjaRestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} failed: HTTP ${res.status} ${text}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Best-effort GET: returns `[]` instead of throwing on a non-2xx response (used for optional lookups during cleanup/verification). */
  async requestOrEmpty<T>(path: string): Promise<T[]> {
    try {
      const result = await this.request<T[]>('GET', path);
      return result ?? [];
    } catch {
      return [];
    }
  }

  listProjects(): Promise<VikunjaProject[]> {
    return this.requestOrEmpty<VikunjaProject>('/projects');
  }

  async listTasksInProject(projectId: number): Promise<VikunjaTask[]> {
    // No GET /projects/{id}/tasks in the Vikunja API (see docs/API_NOTES.md /
    // the vendored OpenAPI spec) -- cross-project GET /tasks with a
    // project_id filter is the documented way to list a single project's
    // tasks via direct REST.
    return this.requestOrEmpty<VikunjaTask>(
      `/tasks?filter=${encodeURIComponent(`project_id = ${projectId}`)}&per_page=200`,
    );
  }

  getTask(taskId: number): Promise<VikunjaTask> {
    return this.request<VikunjaTask>('GET', `/tasks/${taskId}`);
  }

  listLabels(): Promise<VikunjaLabel[]> {
    return this.requestOrEmpty<VikunjaLabel>('/labels');
  }

  async listViews(projectId: number): Promise<VikunjaProjectView[]> {
    return this.requestOrEmpty<VikunjaProjectView>(`/projects/${projectId}/views`);
  }

  async listBuckets(projectId: number): Promise<VikunjaBucket[]> {
    const views = await this.listViews(projectId);
    const kanban = views.find((v) => v.view_kind === 'kanban') ?? views[0];
    if (!kanban) return [];
    return this.requestOrEmpty<VikunjaBucket>(`/projects/${projectId}/views/${kanban.id}/buckets`);
  }

  listShares(projectId: number): Promise<VikunjaShare[]> {
    return this.requestOrEmpty<VikunjaShare>(`/projects/${projectId}/shares`);
  }

  deleteTask(taskId: number): Promise<void> {
    return this.request<void>('DELETE', `/tasks/${taskId}`);
  }

  deleteProject(projectId: number): Promise<void> {
    return this.request<void>('DELETE', `/projects/${projectId}`);
  }

  deleteLabel(labelId: number): Promise<void> {
    return this.request<void>('DELETE', `/labels/${labelId}`);
  }

  createLabel(title: string): Promise<VikunjaLabel> {
    return this.request<VikunjaLabel>('PUT', '/labels', { title });
  }
}

/** Logs in as the fixed e2e-test user and returns a JWT (mirrors docker/e2e/bootstrap.sh). */
export async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /login failed: ${res.status} ${await res.text()} -- is the e2e stack up? Run 'npm run e2e:up'.`,
    );
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Mints a fresh long-lived tk_* API token scoped to every permission the server advertises (mirrors docker/e2e/bootstrap.sh). Falls back to `null` on any failure so callers can fall back to the JWT itself. */
export async function mintApiToken(baseUrl: string, jwt: string, tokenTitle: string): Promise<string | null> {
  const routesRes = await fetch(`${baseUrl}/routes`, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!routesRes.ok) return null;
  const routes = (await routesRes.json()) as Record<string, Record<string, unknown>>;
  const permissions: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(routes)) {
    permissions[key] = Object.keys(value);
  }
  const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${baseUrl}/tokens`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: tokenTitle, permissions, expires_at: expiresAt }),
  });
  // The OpenAPI spec documents 200; the real server responds 201 (see
  // docker/e2e/bootstrap.sh / scripts/mcp-e2e.ts for the same tolerance).
  if (res.status !== 200 && res.status !== 201) return null;
  const body = (await res.json()) as { token: string | null };
  return body.token ?? null;
}
