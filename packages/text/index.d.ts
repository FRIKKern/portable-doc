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
