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
   * toMarkdown only. 'lossless' writes Markdown that fromMarkdown reads back as the same
   * blocks, and returns { markdown, lost } instead of a string. The default is readable
   * Markdown, one way.
   */
  mode?: 'readable' | 'lossless';
}

/**
 * A block lossless mode could not keep, in the shape of the importer's kept-back fences: its
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
export function toMarkdown(doc: Doc | unknown, options: TextOptions & { mode: 'lossless' }): { markdown: string; lost: LostBlock[] };
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
