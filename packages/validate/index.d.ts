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

export type Result = { ok: true } | { ok: false; errors: ValidationError[] };

export const CODES: readonly Code[];

export const MAX_DEPTH: number;

/**
 * The deepest any value may nest, in JSON levels counted from the doc root (the
 * doc itself is level 1): 1000. Past it, the first array or object is too_deep.
 */
export const MAX_VALUE_DEPTH: number;

export function validate(doc: unknown): Result;

export function compile(schema: object): (doc: unknown) => Result;
