/**
 * Attach subcommand of `vikunja_tasks`.
 *
 * Uploads a file as an attachment on an existing task via the Vikunja REST
 * endpoint `PUT /tasks/{id}/attachments` (`multipart/form-data`, field name
 * `files`). The endpoint accepts multiple files per call; this handler
 * uploads a single file per invocation to keep the schema simple.
 *
 * Two ways to provide the file:
 *   - `filePath`: absolute path readable by the MCP server process.
 *   - `fileContent`: base64-encoded contents (typical when the MCP client
 *     runs on a different machine than the server).
 *
 * When both are present, `filePath` takes precedence. `filename` is optional
 * and falls back to `basename(filePath)` or `attachment.bin`. Any directory
 * components in `filename` are stripped before upload.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';

import type { AuthManager } from '../../auth/AuthManager';
import { MCPError, ErrorCode } from '../../types';

export const attachSchemaFields = {
  filePath: z.string().optional(),
  fileContent: z.string().optional(),
  filename: z.string().optional(),
};

export interface TaskAttachArgs {
  id?: number;
  filePath?: string;
  fileContent?: string;
  filename?: string;
}

interface AttachResult {
  content: Array<{ type: 'text'; text: string }>;
}

export async function handleAttach(
  args: TaskAttachArgs,
  authManager: AuthManager,
): Promise<AttachResult> {
  const { id, filePath, fileContent, filename } = args ?? {};

  if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'attach requires a positive numeric task id',
    );
  }

  let bytes: Buffer;
  let name: string;
  let source: 'filePath' | 'fileContent';

  if (filePath) {
    try {
      bytes = readFileSync(filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        `attach: cannot read filePath ${filePath}: ${message}`,
      );
    }
    name = filename || basename(filePath);
    source = 'filePath';
  } else if (fileContent) {
    const decoded = Buffer.from(fileContent, 'base64');
    if (decoded.length === 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'attach: decoded fileContent is empty (not valid base64 or empty input)',
      );
    }
    bytes = decoded;
    name = filename || 'attachment.bin';
    source = 'fileContent';
  } else {
    throw new MCPError(
      ErrorCode.VALIDATION_ERROR,
      'attach requires filePath or fileContent',
    );
  }

  // Strip any directory component a caller might inject via `filename`.
  name = basename(name);

  const session = authManager.getSession();
  const base = (session.apiUrl ?? '').replace(/\/+$/, '');
  const url = `${base}/tasks/${id}/attachments`;

  const form = new FormData();
  form.append('files', new Blob([bytes]), name);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.apiToken}` },
      body: form,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MCPError(
      ErrorCode.API_ERROR,
      `attach: network error PUTting ${url}: ${message}`,
    );
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // Body unavailable; status alone is informative.
    }
    throw new MCPError(
      ErrorCode.API_ERROR,
      `attach failed: HTTP ${response.status} ${response.statusText}` +
        (body ? `: ${body.slice(0, 500)}` : ''),
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Vikunja can return an empty body on success.
  }

  const summary = { taskId: id, filename: name, bytes: bytes.length, source };

  return {
    content: [
      {
        type: 'text',
        text:
          `## ✅ Success\n\nAttached \`${name}\` (${bytes.length} bytes) to task #${id}\n\n` +
          `**Operation:** attach-task-file\n\n` +
          '```json\n' +
          JSON.stringify({ summary, response: data }, null, 2) +
          '\n```',
      },
    ],
  };
}
