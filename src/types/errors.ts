/**
 * MCP Server Error Types and Utilities
 */

export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_FAILED = 'AUTH_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  REQUEST_TOO_LARGE = 'REQUEST_TOO_LARGE',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
}

interface MCPErrorDetails {
  vikunjaError?: unknown;
  statusCode?: number;
  endpoint?: string;
  // Rate limiting specific properties
  rateLimitType?: string;
  requestSize?: number;
  responseSize?: number;
  timeout?: number;
  limit?: number;
  current?: number;
  resetTime?: number;
  maxRequestSize?: number;
  maxResponseSize?: number;
  toolName?: string;
  /**
   * Set by network-layer failures wrapped into an MCPError (e.g.
   * src/utils/vikunja-rest.ts) to record whether the original cause looked
   * transient (connection reset, timeout, DNS failure, ...) BEFORE the
   * original error's `.code`/`.cause.code` — which callers like a retry
   * predicate need — got discarded by the string-formatted MCPError
   * message. Absent for non-network failures (e.g. HTTP error responses,
   * which use `statusCode` instead).
   */
  transient?: boolean;
}

export class MCPError extends Error {
  code: ErrorCode;
  details?: MCPErrorDetails;

  constructor(code: ErrorCode, message: string, details?: MCPErrorDetails) {
    super(message);
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    this.name = 'MCPError';
  }

  toJSON(): { error: { code: string; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export interface MCPResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
