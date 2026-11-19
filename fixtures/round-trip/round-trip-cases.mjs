// Writes the reading-half cases ({ name: { markdown, blocks } }) for every matrix form round-trip mode keeps,
// and prints the kept/lost tally by type.
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const [R, out] = process.argv.slice(2);
const { toMarkdown, fromMarkdown } = await import(`${R}/packages/text/index.js`);
const { allForms } = await import(`${R}/packages/text/block-forms.mjs`);
const L = { mode: 'round-trip' };
// A quoted value keeps its quotes as '-str', so level="1" and level=1 get different names.
const slug = (s) => s.replace(/"([^"]*)"/g, '$1 str').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const cases = {};
const put = (k, v) => { if (k in cases) throw new Error(`two forms share the name ${k}`); cases[k] = v; };
const byType = {};
for (const [name, block] of allForms()) {
  const { markdown, lost } = toMarkdown([block], L);
  const how = lost.length ? `lost:${lost[0].reason}` : markdown.startsWith('```portabledoc') ? 'fenced' : 'native';
  const t = name.split(' ')[0];
  (byType[t] ??= {})[how] = (byType[t][how] ?? 0) + 1;
  if (lost.length) continue;
  if (!isDeepStrictEqual(fromMarkdown(markdown), [block])) console.log('CASE MISMATCH', name);
  put(`round-trip-${slug(name)}`, { markdown, blocks: [block] });
}
const pair = [{ type: 'diagram', source: 'graph TD; A-->B' }, { type: 'paragraph', content: [{ type: 'em', children: [{ type: 'text', value: 'Not a caption' }] }] }];
put('round-trip-emphasis-after-diagram', { markdown: toMarkdown(pair, L).markdown, blocks: pair });
fs.writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`);
for (const [t, h] of Object.entries(byType)) if (Object.keys(h).some((k) => !k.startsWith('lost:type'))) console.log(t.padEnd(16), JSON.stringify(h));
const allLost = Object.entries(byType).filter(([, h]) => Object.keys(h).every((k) => k === 'lost:type')).map(([t]) => t);
console.log(`${allLost.length} types every form lost (type):`, allLost.join(' '));
console.log(Object.keys(cases).length, 'cases', fs.statSync(out).size, 'bytes ->', out);
