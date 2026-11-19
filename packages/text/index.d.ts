/** One block of a PortableDoc document: a `type` plus that type's fields. */
export type Block = { type: string } & Record<string, unknown>;

/** A document: the blocks array itself, or an object with a `blocks` array. */
export type Doc = Block[] | { blocks: Block[] };

export interface TextOptions {
  /**
   * Documents to show in place of `embed` blocks, keyed by the block's
   * `target`. A target with no entry shows as `↪ target`.
   */
  embeds?: Record<string, Doc>;
}

/** Every block type, aliases included, that has its own text handler. */
export const BLOCK_TYPES: readonly string[];

/**
 * The document as CommonMark with GFM tables, task lists and strikethrough.
 * Returns '' for a document with nothing to show, else text ending in exactly
 * one newline. Never throws.
 */
export function toMarkdown(doc: Doc | unknown, options?: TextOptions): string;

/**
 * The document as plain text: no markup, links as "text (url)", lists with
 * "- " and "1. ", tables as space-aligned columns. Same ending rule as
 * toMarkdown. Never throws.
 */
export function toPlainText(doc: Doc | unknown, options?: TextOptions): string;

/**
 * GFM Markdown as PortableDoc blocks: headings, paragraphs with marks and
 * links, lists (task lists as checklists), code, tables, quotes, callouts
 * (`> [!tone]`), dividers, ```mermaid diagrams and ```portabledoc fences.
 * The result passes @portable-doc/validate. Never throws.
 */
export function fromMarkdown(markdown: string): Block[];

/**
 * The import's limits, counted from the text before it parses: `budget` for the work (each
 * line (depth + 1) × (2 + its UTF-8 bytes)), `lineBytes` for one line (null until the shared
 * pack sets it), and the notice it gives past either.
 */
export interface ImportLimits {
  readonly budget: number;
  readonly lineBytes: number | null;
  readonly notice: 'import_work_spent';
}
export const IMPORT_WORK: ImportLimits;

/**
 * A note from the import: text it kept as plain text, by `rule` ('budget': every line from
 * `line` on; 'line': each line past lineBytes, `lines` of them), the first such paragraph at
 * `path`. At most one per rule. `line` counts from 1.
 */
export interface ImportNotice {
  code: 'import_work_spent';
  rule: 'budget' | 'line';
  path: string;
  line: number;
  lines: number;
}

/**
 * fromMarkdown, with what it noticed: { blocks, notices, work }. `work` is the import's count
 * from the text; `notices` is empty unless a limit cut some text. `limits` defaults to
 * IMPORT_WORK. Never throws.
 */
export function readMarkdown(markdown: string, limits?: ImportLimits): { blocks: Block[]; notices: ImportNotice[]; work: number };
