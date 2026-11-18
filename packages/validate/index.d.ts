export type Code =
  | 'not_a_doc'
  | 'block_not_object'
  | 'portable_text_block'
  | 'missing_required_field'
  | 'unknown_block_type'
  | 'wrong_field_type'
  | 'value_not_allowed'
  | 'duplicate_block_id'
  | 'too_deep';

export interface ValidationError {
  code: Code;
  path: string;
  message: string;
}

/** `errors` holds at most MAX_ERRORS, the first found; `more`, present only when some were left out, counts the rest. */
export type Result = { ok: true } | { ok: false; errors: ValidationError[]; more?: number };

export const CODES: readonly Code[];

export const MAX_DEPTH: number;

/**
 * The deepest any value may nest, in JSON levels counted from the doc root (the
 * doc itself is level 1): 1000. Each branch that goes past it is too_deep at its first array or object past the limit.
 */
export const MAX_VALUE_DEPTH: number;

/** The most errors a result lists: 1000. */
export const MAX_ERRORS: number;

export interface WalkDepthOptions {
  /** The deepest level a container may sit at; default MAX_VALUE_DEPTH. */
  limit?: number;
  /** Containers not to walk. */
  skip?: { has(value: unknown): boolean };
  /** Values to walk in a scalar's own place, as a decoder that swaps it for them would. */
  expand?: (scalar: unknown) => Iterable<unknown>;
  /** Called with the JSON pointer of each container past the limit, the first on its branch; without it the walk stops at the first. */
  onTooDeep?: (path: string) => void;
}

/**
 * The one way JSON depth is counted: arrays and objects are one level each, a
 * scalar none, the root is level 1. Iterative and cycle-safe. Returns the
 * deepest level reached, at most limit + 1.
 */
export function walkDepth(root: unknown, options?: WalkDepthOptions): number;

export function validate(doc: unknown): Result;
/** The PortableDoc block schema (spec/blocks.schema.json) that `validate` checks against. Deep-frozen. */
export const blockSchema: Readonly<Record<string, unknown>>;

export function compile(schema: object): (doc: unknown) => Result;
