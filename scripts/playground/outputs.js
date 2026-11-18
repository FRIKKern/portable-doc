// The playground's other views of a doc, and Markdown into a doc. Plain
// functions, so the tests run them without a browser.
import { fromMarkdown, toMarkdown, toPlainText } from '@portable-doc/text';

/** The doc as Markdown and as plain text, as @portable-doc/text writes them. */
export const outputsOf = (doc) => ({ markdown: toMarkdown(doc), text: toPlainText(doc) });

/** Markdown as a new doc for the editor: its JSON laid out like the examples, and how many blocks it has. */
export function docFromMarkdown(markdown) {
  const blocks = fromMarkdown(markdown);
  return { text: JSON.stringify({ blocks }, null, 2), blocks: blocks.length };
}
