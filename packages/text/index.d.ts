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

/**
 * The most 'line' run notices a text gets (import-work.js gives the value and its reason). Past
 * them, one LineNoticesCappedNotice stands for every later run.
 */
export const MAX_LINE_NOTICES: number;

/** The code of the notice that stands for every run of cut lines past MAX_LINE_NOTICES. */
export const LINE_NOTICES_CAPPED: 'import_line_notices_capped';

/** The code of the notice for a list item split at text after its nested list. */
export const LIST_ITEM_SPLIT: 'list_item_split';

/** The code of the notice that the import fell back to keeping the whole text as one code block. */
export const IMPORT_FELL_BACK: 'import_fell_back';

/**
 * A note from the import: text it kept as plain text, by `rule` ('budget': every line from
 * `line` on; 'line': each line past lineBytes; 'net': markdown-it's own count passed the
 * budget where the text's count said it would not, so the deep text from `line` on was kept,
 * a sign the text's count is wrong and a bug to report), the first such paragraph at `path`.
 * At most one each for 'budget' and 'net'; one 'line' notice per run of cut lines (consecutive
 * line numbers; any line not cut ends a run), at its first line's paragraph, for the first
 * MAX_LINE_NOTICES runs; then one LineNoticesCappedNotice. `line` counts from 1; `lines` is how
 * many lines were kept as text, from `line` on.
 */
export interface ImportWorkNotice {
  code: 'import_work_spent';
  rule: 'budget' | 'line' | 'net';
  path: string;
  line: number;
  lines: number;
}

/**
 * The last line notice, past MAX_LINE_NOTICES runs: it stands for every later run of cut lines.
 * `path` is the paragraph of the first line it covers, `line` that line (from 1), `runs` how many
 * runs and `lines` how many lines, which need not be consecutive. So the line notices are at most
 * MAX_LINE_NOTICES + 1, and their `lines` add up to every cut line.
 */
export interface LineNoticesCappedNotice {
  code: 'import_line_notices_capped';
  rule: 'line';
  path: string;
  line: number;
  lines: number;
  runs: number;
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

/** The code of the notice for a value a fence's block lost when its old names folded into their current names. */
export const OLD_NAME_DROPPED: 'old_name_dropped';

/**
 * A note from the import: a ```portabledoc fence's block held a field under two names with
 * different values, and the import kept the one every reader picks (the current name, when it
 * holds a value) under the current name. `path` is the dropped key's, `name` that key, `current`
 * the field's current name and `fix` the fix, `write <current>`. `line` is the fence's first
 * source line, from 1, and `lines` how many lines the fence spans.
 */
export interface OldNameDroppedNotice {
  code: 'old_name_dropped';
  path: string;
  line: number;
  lines: number;
  name: string;
  current: string;
  fix: string;
}

/** The code of the notice for a block that keeps, as text, levels nested past the import's limits. */
export const NESTING_KEPT_AS_TEXT: 'nesting_kept_as_text';

/**
 * A note from the import: the block at `path` keeps as text, every word, levels nested past the
 * import's limits: blocks deeper than validate's MAX_DEPTH (a list in its deepest item, or a
 * callout's body), or marks inside marks deeper than 50. `line` is the block's first source
 * line, from 1, and `lines` how many lines it spans.
 */
export interface NestingKeptAsTextNotice {
  code: 'nesting_kept_as_text';
  path: string;
  line: number;
  lines: number;
}

/**
 * The code of the notice for each reason a ```portabledoc fence stays code or text, and its fix:
 * not JSON, not 1 to 50 blocks, nested too deep (as written, or where its blocks would sit), a
 * block type a fence may not hold, an address import does not allow, blocks validate refuses, a
 * block id an earlier fence uses, or a place that holds no blocks (a quote, or text read flat).
 */
export const FENCE_KEPT_AS_CODE: {
  readonly json: { readonly code: 'fence_not_json'; readonly fix: string };
  readonly count: { readonly code: 'fence_block_count'; readonly fix: string };
  readonly depth: { readonly code: 'fence_too_deep'; readonly fix: string };
  readonly type: { readonly code: 'fence_block_type'; readonly fix: string };
  readonly address: { readonly code: 'fence_unsafe_address'; readonly fix: string };
  readonly invalid: { readonly code: 'fence_invalid'; readonly fix: string };
  readonly id: { readonly code: 'fence_id_used'; readonly fix: string };
  readonly place: { readonly code: 'fence_place'; readonly fix: string };
};

/**
 * A note from the import: a ```portabledoc fence was not spliced. At block level it stays the code
 * block at `path`; in a list item or a quote it is inline code in the block at `path`, and in text
 * read flat it is part of that block's text. `code` names why (FENCE_KEPT_AS_CODE) and `fix` what
 * to change. `line` is the fence's first source line, from 1, and `lines` how many lines it spans.
 */
export interface FenceKeptAsCodeNotice {
  code: (typeof FENCE_KEPT_AS_CODE)[keyof typeof FENCE_KEPT_AS_CODE]['code'];
  path: string;
  line: number;
  lines: number;
  fix: string;
}

export type ImportNotice = ImportWorkNotice | LineNoticesCappedNotice | ListItemSplitNotice | ImportFallbackNotice | OldNameDroppedNotice | NestingKeptAsTextNotice | FenceKeptAsCodeNotice;

/**
 * fromMarkdown, with what it noticed: { blocks, notices, work }. `work` is the import's count
 * from the text. `notices` says what a limit cut and each list item split off, by kind: the
 * `budget` and `line` notices (LineNoticesCappedNotice among them), then the splits, a fence's dropped old names
 * (`old_name_dropped`) and each fence kept as code or text (FENCE_KEPT_AS_CODE) in source order,
 * then a `net` one; it is empty
 * when none happened. When the import falls back to one code block, its one notice is
 * `import_fell_back`. `limits` defaults to IMPORT_WORK. Never throws.
 */
export function readMarkdown(markdown: string, limits?: ImportLimits): { blocks: Block[]; notices: ImportNotice[]; work: number };
