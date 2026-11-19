import fs from 'node:fs';
const [textDir, outDir] = process.argv.slice(2);
const { fromMarkdown } = await import(textDir + '/index.js');
const cases = {
  'callout-paragraph-body': '> [!note] Heads up\n>\n> Second paragraph.',
  'callout-one-paragraph-two-lines': '> [!note] Heads up\n> same paragraph',
  'callout-list-and-code-body': '> [!warning] Mind the gap\n>\n> - one\n> - two\n>\n> ```js\n> x()\n> ```',
  'callout-empty-content-with-body': '> [!tip]\n>\n> Only a body.',
  'callout-in-callout': '> [!info] Outer\n>\n> > [!danger] Inner\n> >\n> > Deep.',
  'callout-portabledoc-fence-ids-shared': '> [!info] A\n>\n> ```portabledoc\n> [{"type":"divider","id":"d"}]\n> ```\n\n```portabledoc\n[{"type":"divider","id":"d"}]\n```',
  'callout-mermaid-caption': '> [!info] A\n>\n> ```mermaid\n> graph TD; A-->B\n> ```\n>\n> *The flow*',
  'plain-quote-stays-inline': '> a\n>\n> - b\n> - c',
  // 52 callouts, each in the one before: 50 read their body as blocks; the 51st keeps the 52nd as text in its content.
  'callout-52-deep-past-cap': Array.from({ length: 52 }, (_, i) => `${'> '.repeat(i + 1)}[!info] h${i}\n${'> '.repeat(i + 1).trimEnd()}`).join('\n'),
};
for (const [name, markdown] of Object.entries(cases)) fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ markdown, blocks: fromMarkdown(markdown) }, null, 2) + '\n');
console.log(Object.keys(cases).length, 'cases');
