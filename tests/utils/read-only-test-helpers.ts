/**
 * Shared helpers for asserting global read-only mode behavior across each
 * tool's test file. Each tool's own suite already exercises its handlers'
 * happy paths with tool-specific mocks — these helpers only assert whether
 * `assertWriteAllowed` (src/utils/read-only.ts) fired, without depending on
 * a full downstream success round trip (which would require duplicating
 * each tool's entire mock setup here).
 */

import { MCPError } from '../../src/types';

/** Calls `handler(args)` and returns the thrown value, or undefined if it resolved. */
export async function callAndCatch(
  handler: (args: Record<string, unknown>) => Promise<unknown>,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    await handler(args);
    return undefined;
  } catch (error) {
    return error;
  }
}

/** True if `error` is the read-only mode rejection thrown by assertWriteAllowed. */
export function isReadOnlyRejection(error: unknown): boolean {
  return (
    error instanceof MCPError &&
    typeof error.message === 'string' &&
    error.message.includes('server is in read-only mode')
  );
}
