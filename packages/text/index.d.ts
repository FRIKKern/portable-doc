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
 * The import's work budget, counted in lines × nesting depth plus characters re-scanned,
 * and the notice it gives past it.
 */
export const IMPORT_WORK: { readonly budget: number; readonly notice: 'import_work_spent' };

/** The code of the notice for a list item split at text after its nested list. */
export const LIST_ITEM_SPLIT: 'list_item_split';

/** A note from the import: past the work budget, the rest of the deep text from `path` on was kept as plain text. */
export interface ImportWorkNotice {
  code: 'import_work_spent';
  path: string;
  work: number;
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

export type ImportNotice = ImportWorkNotice | ListItemSplitNotice;

/**
 * fromMarkdown, with what it noticed: { blocks, notices, work }. `work` is the import's count
 * of lines × nesting depth plus characters re-scanned; `notices` says where the budget ran out,
 * and each list item split off, in source order. Never throws.
 */
export function readMarkdown(markdown: string): { blocks: Block[]; notices: ImportNotice[]; work: number };
