/**
 * Shared permission-level resolution for project sharing operations.
 *
 * The Vikunja API encodes project permission levels as a small integer
 * (0 = Read, 1 = Write, 2 = Admin) — `models.Permission` in the vendored
 * OpenAPI spec — on every sharing-related endpoint: link shares
 * (`models.LinkSharing.permission`), direct user shares
 * (`models.ProjectUser.permission`), and direct team shares
 * (`models.TeamProject.permission`). MCP tool callers may supply either the
 * numeric value directly or one of the friendly string aliases (`'read'` /
 * `'write'` / `'admin'`); this resolves either form to the numeric value the
 * API expects, with one shared set of validation rules used everywhere a
 * sharing permission is accepted — link shares, direct user shares, and
 * direct team shares alike.
 */

import { MCPError, ErrorCode } from '../../types';

export type PermissionInput = 'read' | 'write' | 'admin' | 0 | 1 | 2;

const PERMISSION_NAME_TO_VALUE: Record<string, 0 | 1 | 2> = {
  read: 0,
  write: 1,
  admin: 2,
};

/**
 * Resolves a caller-supplied permission (string alias or numeric value) to
 * the numeric `models.Permission` value the Vikunja API expects.
 *
 * @throws MCPError (VALIDATION_ERROR) when `right` is missing, an
 *         unrecognized string, an out-of-range number, or neither a string
 *         nor a number.
 */
export function resolvePermission(right: PermissionInput | undefined): 0 | 1 | 2 {
  if (right === undefined) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right is required');
  }

  if (typeof right === 'string') {
    const normalized = right.trim().toLowerCase();
    const resolved = PERMISSION_NAME_TO_VALUE[normalized];
    if (resolved === undefined) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Share right must be one of: read, write, admin',
      );
    }
    return resolved;
  }

  if (typeof right === 'number') {
    if (right !== 0 && right !== 1 && right !== 2) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid permission level. Use: 0=Read, 1=Write, 2=Admin',
      );
    }
    return right;
  }

  throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Share right must be a string or number');
}
