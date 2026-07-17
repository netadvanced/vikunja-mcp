/**
 * Helpers to extract a usable detail (HTTP status + body) from errors thrown
 * by node-vikunja / fetch wrappers, so the wrapper can propagate the real
 * cause to the MCP client instead of replacing it with a generic message.
 *
 * Targets the same error shape that `isAuthenticationError` probes in
 * `auth-error-handler.ts`: `.status`, `.statusCode`, or `.response.status`
 * on the Error object, with the body in `.response.data`, `.body` or, as a
 * last resort, the error message itself.
 *
 * Introduced for Vikunja #307 (marea-14): the previous catch in
 * `updateTaskLabels` swallowed the real 403/422 from Vikunja and replaced
 * it with the LABEL_UPDATE "known limitation" message, making any future
 * label-path failure opaque.
 */

type ErrorWithStatus = Error & {
  status?: number;
  statusCode?: number;
  response?: { status?: number; data?: unknown };
  body?: unknown;
};

const MAX_BODY_CHARS = 400;

/**
 * Return the HTTP status of an error if one can be inferred, otherwise null.
 */
export function extractHttpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const e = error as ErrorWithStatus;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.response?.status === 'number') return e.response.status;
  return null;
}

/**
 * Render a short "(HTTP <status>: <body>)" suffix when the error exposes
 * an HTTP status. Returns the empty string when there is no signal, so
 * callers can concatenate unconditionally:
 *
 *   throw new MCPError(API_ERROR, `${baseMessage} ${extractHttpErrorDetail(err)}`.trim());
 */
export function extractHttpErrorDetail(error: unknown): string {
  const status = extractHttpStatus(error);
  if (status === null) return '';

  const e = error as ErrorWithStatus;
  const rawBody = e.response?.data ?? e.body ?? (e.message || undefined);

  let bodyStr = '';
  if (rawBody !== undefined && rawBody !== null) {
    bodyStr = typeof rawBody === 'string' ? rawBody : safeStringify(rawBody);
    bodyStr = bodyStr.trim();
    if (bodyStr.length > MAX_BODY_CHARS) {
      bodyStr = bodyStr.slice(0, MAX_BODY_CHARS) + '…';
    }
  }

  return bodyStr ? `(HTTP ${status}: ${bodyStr})` : `(HTTP ${status})`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
