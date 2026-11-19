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
  /**
   * toMarkdown only. 'round-trip' writes Markdown that fromMarkdown reads back as the same
   * blocks, for each block import accepts, and returns { markdown, lost } instead of a string. The default is readable
   * Markdown, one way.
   */
  mode?: 'readable' | 'round-trip';
}

/**
 * A block round-trip mode could not keep, in the shape of the importer's kept-back fences: its
 * path in the doc ("/blocks/3"), its id and type (null when it has none), and why. The
 * reason is the fence's (`type`: a type a fence may not hold, here or nested; `address`: an
 * address import does not allow; `invalid`; `depth`; `id`: an id an earlier fence used;
 * `count`), or `changed` (the fence reads back different), `neighbours` (the blocks around
 * it change how it reads) or `not-a-block`. It is written readably.
 */
export interface LostBlock {
  path: string;
  id: string | null;
  type: string | null;
  reason: 'type' | 'address' | 'invalid' | 'depth' | 'id' | 'count' | 'changed' | 'neighbours' | 'not-a-block';
}

/** Every block type, aliases included, that has its own text handler. */
export const BLOCK_TYPES: readonly string[];

/**
 * The document as CommonMark with GFM tables, task lists and strikethrough.
 * Returns '' for a document with nothing to show, else text ending in exactly
 * one newline. Never throws.
 */
export function toMarkdown(doc: Doc | unknown, options: TextOptions & { mode: 'round-trip' }): { markdown: string; lost: LostBlock[] };
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

/** The code of the notice for a list item split at text after its nested list. */
export const LIST_ITEM_SPLIT: 'list_item_split';

/** The code of the notice that the import fell back to keeping the whole text as one code block. */
export const IMPORT_FELL_BACK: 'import_fell_back';

/**
 * A note from the import: text it kept as plain text, by `rule` ('budget': every line from
 * `line` on; 'line': each line past lineBytes; 'net': markdown-it's own count passed the
 * budget where the text's count said it would not, so the deep text from `line` on was kept,
 * a sign the text's count is wrong and a bug to report), the first such paragraph at `path`.
 * At most one per rule. `line` counts from 1; `lines` is how many lines were kept as text.
 */
export interface ImportWorkNotice {
  code: 'import_work_spent';
  rule: 'budget' | 'line' | 'net';
  path: string;
  line: number;
  lines: number;
}

/**
 * A note from the import: text after a list item's nested list became the new item at `path`,
 * the next at the same level (in an ordered list, the next number). `line` is the first source
 * line of that text, from 1, and `lines` how many lines it spans.
 */
export interface ListItemSplitNotice {
  code: 'list_item_split';
  path: string;
  line: number;
  lines: number;
}

/**
 * A note from the import: reading the text failed, so the whole text was kept as one code
 * block at `path` (`/blocks` when the text is blank and nothing was kept), every line of it:
 * `line` is 1 and `lines` how many lines the text has. A bug to report.
 */
export interface ImportFallbackNotice {
  code: 'import_fell_back';
  path: string;
  line: number;
  lines: number;
}

export type ImportNotice = ImportWorkNotice | ListItemSplitNotice | ImportFallbackNotice;

/**
 * fromMarkdown, with what it noticed: { blocks, notices, work }. `work` is the import's count
 * from the text. `notices` says what a limit cut and each list item split off, by kind: the
 * `budget` and `line` notices, then the splits in source order, then a `net` one; it is empty
 * when none happened. When the import falls back to one code block, its one notice is
 * `import_fell_back`. `limits` defaults to IMPORT_WORK. Never throws.
 */
export function readMarkdown(markdown: string, limits?: ImportLimits): { blocks: Block[]; notices: ImportNotice[]; work: number };
