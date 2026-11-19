// The playground's other views of a doc, and Markdown into a doc. Plain
// functions, so the tests run them without a browser.
import { fromMarkdown, toMarkdown, toPlainText } from '@portable-doc/text';
import { tidyJson } from './parse.js';
import { MAX_DOC_BYTES, overCap } from './share.js';

/** The doc as Markdown and as plain text, as @portable-doc/text writes them. */
export const outputsOf = (doc) => ({ markdown: toMarkdown(doc), text: toPlainText(doc) });

/**
 * Markdown as a new doc for the editor, and how many blocks it has. Its JSON takes
 * the share links' path: laid out like the examples while that stays under `limit`
 * bytes, else as sent; a doc whose JSON alone passes `limit` is refused with { error }.
 */
export function docFromMarkdown(markdown, limit = MAX_DOC_BYTES) {
  const blocks = fromMarkdown(markdown);
  const compact = JSON.stringify({ blocks });
  if (overCap(compact, limit)) return { error: `The Markdown makes a doc too big for the editor (over ${limit / 1_000_000} MB)`, blocks: blocks.length };
  return { text: tidyJson(compact, limit), blocks: blocks.length };
}
