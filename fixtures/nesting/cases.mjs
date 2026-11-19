// SPDX-License-Identifier: Apache-2.0
// The inputs of the shared callout-nesting cases: name → Markdown. scripts/write-shared-cases.mjs
// reads each with fromMarkdown and writes <name>.json as { markdown, blocks }.

/** D callouts, each in the one before: a level's `[!info]` line, then a bare `>`, so the next is a block of its body. */
const callouts = (D) => Array.from({ length: D }, (_, i) => `${'> '.repeat(i + 1)}[!info] h${i}\n${'> '.repeat(i + 1).trimEnd()}`).join('\n');

export const CASES = {
  'callout-paragraph-body': '> [!note] Heads up\n>\n> Second paragraph.',
  'callout-one-paragraph-two-lines': '> [!note] Heads up\n> same paragraph',
  'callout-list-and-code-body': '> [!warning] Mind the gap\n>\n> - one\n> - two\n>\n> ```js\n> x()\n> ```',
  'callout-empty-content-with-body': '> [!tip]\n>\n> Only a body.',
  'callout-in-callout': '> [!info] Outer\n>\n> > [!danger] Inner\n> >\n> > Deep.',
  'callout-portabledoc-fence-ids-shared': '> [!info] A\n>\n> ```portabledoc\n> [{"type":"divider","id":"d"}]\n> ```\n\n```portabledoc\n[{"type":"divider","id":"d"}]\n```',
  'callout-mermaid-caption': '> [!info] A\n>\n> ```mermaid\n> graph TD; A-->B\n> ```\n>\n> *The flow*',
  'plain-quote-stays-inline': '> a\n>\n> - b\n> - c',
  // 50 callouts read their body as blocks; the 51st keeps the 52nd as text in its content.
  'callout-52-deep-past-cap': callouts(52),
};
