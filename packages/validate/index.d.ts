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

export function validate(doc: unknown): Result;

export function compile(schema: object): (doc: unknown) => Result;
