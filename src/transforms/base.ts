/**
 * Base types and interfaces for optimized response formatting system
 * Provides the foundation for verbosity-based field selection and size optimization
 */

/**
 * Verbosity levels for response formatting
 * Each level includes progressively more fields and detail
 */
export enum Verbosity {
  /** Only essential identification fields - IDs, titles, basic status */
  MINIMAL = 'minimal',
  /** Core operational fields - what most users need most of the time */
  STANDARD = 'standard',
  /** Extended fields including relationships, metadata, timestamps */
  DETAILED = 'detailed',
  /** All available fields including debug info, raw data, complete metadata */
  COMPLETE = 'complete'
}

/**
 * Field categories for systematic organization
 * Helps determine which fields to include at each verbosity level
 */
export enum FieldCategory {
  /** Core identification and status fields */
  CORE = 'core',
  /** Contextual fields like descriptions, projects, labels */
  CONTEXT = 'context',
  /** Time-related fields like due dates, reminders, scheduling */
  SCHEDULING = 'scheduling',
  /** Metadata, statistics, and debug information */
  METADATA = 'metadata'
}

/**
 * Field definition for the transformation system
 */
export interface FieldDefinition {
  /** Field name in the source object */
  fieldName: string;
  /** Target field name in the optimized response (can be same or different) */
  targetName?: string;
  /** Category this field belongs to */
  category: FieldCategory;
  /** Minimum verbosity level required for this field to be included */
  minVerbosity: Verbosity;
  /** Optional transformer function for custom field processing */
  transformer?: (value: unknown, source: Record<string, unknown>) => unknown;
  /** Whether this field should always be included regardless of verbosity */
  alwaysInclude?: boolean;
  /** Whether this field contains potentially sensitive data */
  sensitive?: boolean;
}

/**
 * Transformation result with size metrics
 */
export interface TransformationResult<T = unknown> {
  /** The transformed/optimized data */
  data: T;
  /** Size metrics for this transformation */
  metrics: {
    /** Original size in bytes (estimated) */
    originalSize: number;
    /** Optimized size in bytes (estimated) */
    optimizedSize: number;
    /** Size reduction percentage */
    reductionPercentage: number;
    /** Number of fields included */
    fieldsIncluded: number;
    /** Total number of fields available */
    totalFields: number;
    /** Field inclusion percentage */
    fieldInclusionPercentage: number;
  };
  /** Transformation metadata */
  metadata: {
    /** Verbosity level used */
    verbosity: Verbosity;
    /** Categories included */
    categoriesIncluded: FieldCategory[];
    /** Transformation timestamp */
    timestamp: string;
    /** Processing time in milliseconds */
    processingTimeMs: number;
  };
}

/**
 * Base interface for optimized responses
 * Extends StandardResponse pattern with optimization metadata
 */
export interface OptimizedResponse<T = unknown> {
  /** Standard response fields */
  success: boolean;
  operation: string;
  message: string;
  data: T;
  metadata: {
    /** Standard metadata */
    timestamp: string;
    count?: number;
    affectedFields?: string[];
    previousState?: Record<string, unknown>;

    /** Optimization metadata */
    optimization?: {
      /** Verbosity level used for this response */
      verbosity: Verbosity;
      /** Size reduction metrics */
      sizeMetrics: {
        originalSize: number;
        optimizedSize: number;
        reductionPercentage: number;
      };
      /** Field metrics */
      fieldMetrics: {
        fieldsIncluded: number;
        totalFields: number;
        inclusionPercentage: number;
      };
      /** Categories included in this response */
      categoriesIncluded: FieldCategory[];
      /** Processing performance */
      performance: {
        transformationTimeMs: number;
        totalTimeMs: number;
      };
    };

    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * Transformer configuration options
 */
export interface TransformerConfig {
  /** Verbosity level to apply */
  verbosity: Verbosity;
  /** Whether to include sensitive fields */
  includeSensitive?: boolean;
  /** Whether to track detailed metrics */
  trackMetrics?: boolean;
  /** Custom field overrides (include/exclude specific fields) */
  fieldOverrides?: {
    include?: string[];
    exclude?: string[];
  };
  /** Custom transformers for specific fields */
  customTransformers?: Record<string, (value: unknown, source: Record<string, unknown>) => unknown>;
}

/**
 * Size estimation utilities
 */
export const SizeEstimator = {
  /**
   * Estimate the size of a value in bytes
   */
  estimateSize(value: unknown): number {
    if (value === null || value === undefined) {
      return 0;
    }

    if (typeof value === 'string') {
      return value.length * 2; // UTF-16 characters are typically 2 bytes
    }

    if (typeof value === 'number') {
      return 8; // 64-bit number
    }

    if (typeof value === 'boolean') {
      return 4; // Boolean is typically stored as 4 bytes
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        let total = 2; // Array overhead
        for (const item of value) {
          total += SizeEstimator.estimateSize(item as unknown);
        }
        return total;
      }

      // Object
      let size = 2; // Object overhead
      for (const [key, val] of Object.entries(value)) {
        size += key.length * 2; // Key size
        size += SizeEstimator.estimateSize(val as unknown); // Value size
        size += 2; // Colon and comma/comma overhead
      }
      return size;
    }

    return 0;
  },

  /**
   * Calculate size reduction percentage
   */
  calculateReduction(originalSize: number, optimizedSize: number): number {
    if (originalSize === 0) return 0;
    return Math.round(((originalSize - optimizedSize) / originalSize) * 100);
  }
};

/**
 * Field categorization mapping for common Vikunja fields
 */
export const FIELD_CATEGORIES = {
  // Core fields (always included in minimal)
  CORE_FIELDS: [
    'id', 'title', 'done', 'status', 'success', 'operation', 'message'
  ],

  // Context fields (included in standard and above)
  CONTEXT_FIELDS: [
    'description', 'project_id', 'project', 'labels', 'assignees',
    'creator', 'created_by', 'priority', 'identifier'
  ],

  // Scheduling fields (included in detailed and above)
  SCHEDULING_FIELDS: [
    'due_date', 'start_date', 'end_date', 'reminders', 'created_at',
    'updated_at', 'completed_at', 'repeat_after'
  ],

  // Metadata fields (included in complete only)
  METADATA_FIELDS: [
    'hex_color', 'index', 'kanban_position', 'position', 'bucket_id',
    'parent_task_id', 'related_tasks', 'attachments', 'comments',
    'background_information', 'subscription', 'is_favorite'
  ]
} as const;

/**
 * Default verbosity field mappings
 */
export const DEFAULT_VERBOSITY_FIELDS = {
  [Verbosity.MINIMAL]: [
    ...FIELD_CATEGORIES.CORE_FIELDS
  ],

  [Verbosity.STANDARD]: [
    ...FIELD_CATEGORIES.CORE_FIELDS,
    ...FIELD_CATEGORIES.CONTEXT_FIELDS
  ],

  [Verbosity.DETAILED]: [
    ...FIELD_CATEGORIES.CORE_FIELDS,
    ...FIELD_CATEGORIES.CONTEXT_FIELDS,
    ...FIELD_CATEGORIES.SCHEDULING_FIELDS
  ],

  [Verbosity.COMPLETE]: [
    ...FIELD_CATEGORIES.CORE_FIELDS,
    ...FIELD_CATEGORIES.CONTEXT_FIELDS,
    ...FIELD_CATEGORIES.SCHEDULING_FIELDS,
    ...FIELD_CATEGORIES.METADATA_FIELDS
  ]
} as const;

/**
 * Name of the environment variable that allows operators to change the
 * default response verbosity for every tool call without needing a
 * per-call override.
 *
 * See https://github.com/democratize-technology/vikunja-mcp/issues/24
 * ("Phase 1": a single global env var default. Phase 2 - per-tool/per-call
 * overrides - already exists for some project tools via an explicit
 * `verbosity` argument, which always takes precedence over this default
 * when provided.)
 */
export const VERBOSITY_ENV_VAR = 'VIKUNJA_RESPONSE_VERBOSITY';

/**
 * All valid Verbosity values, used to validate the environment variable.
 */
const VALID_VERBOSITY_VALUES: readonly string[] = Object.values(Verbosity);

/**
 * Resolves the default response verbosity from the
 * `VIKUNJA_RESPONSE_VERBOSITY` environment variable.
 *
 * The value is matched case-insensitively against the `Verbosity` enum
 * ('minimal' | 'standard' | 'detailed' | 'complete'). If the environment
 * variable is unset, empty, or does not match one of those values, this
 * falls back to `Verbosity.STANDARD`.
 *
 * Callers that accept an explicit per-call verbosity parameter MUST prefer
 * that explicit value over this default when one is provided - this helper
 * only supplies the fallback, not an override.
 */
export function getDefaultVerbosity(): Verbosity {
  const rawValue = process.env[VERBOSITY_ENV_VAR];

  if (typeof rawValue !== 'string') {
    return Verbosity.STANDARD;
  }

  const normalized = rawValue.trim().toLowerCase();

  if (VALID_VERBOSITY_VALUES.includes(normalized)) {
    return normalized as Verbosity;
  }

  return Verbosity.STANDARD;
}