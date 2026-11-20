// Every writer here, the text writers and React's reader, nests as deep as validate's MAX_DEPTH:
// a doc MAX_DEPTH blocks deep (a list in each list item, or a callout in each callout's body)
// is written whole, and one level more, a doc validate refuses, keeps the MAX_DEPTH levels above
// and writes the one past them as the too-deep notice, once. The round-trip writer's Markdown of
// the deepest valid doc reads back as the same blocks. The editor's writers are Barkpark's,
// copied by the sync (decision 0012), and are held there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, MAX_VALUE_DEPTH, validate, walkDepth } from '@portable-doc/validate';
import { TOO_DEEP } from '../packages/text/util.js';
import { WRITERS } from './lib/writers.mjs';

const OURS = WRITERS.filter((w) => !w.package.includes('editor'));
const t = (value) => [{ type: 'text', value }];
const chains = {
  lists: (n) => Array.from({ length: n - 1 }).reduce((b, _, i) => ({ type: 'list', ordered: false, items: [{ content: t(`w${n - 1 - i}`), children: [b] }] }), { type: 'list', ordered: false, items: [t(`w${n}`)] }),
  callouts: (n) => Array.from({ length: n - 1 }).reduce((b, _, i) => ({ type: 'callout', tone: 'info', content: t(`w${n - 1 - i}`), slots: { body: [b] } }), { type: 'callout', tone: 'info', content: t(`w${n}`) }),
};
const count = (s, part) => s.split(part).length - 1;

test('each text writer and React write a doc MAX_DEPTH deep whole, and one level more as that, then the too-deep notice once', () => {
  assert.deepEqual(OURS.map((w) => w.name), ['readable Markdown', 'plain text', 'round-trip Markdown', 'HTML', 'HTML with field and embed blocks']);
  for (const [shape, chain] of Object.entries(chains)) {
    const at = [chain(MAX_DEPTH)];
    const past = [chain(MAX_DEPTH + 1)];
    assert.deepEqual([validate(at).ok, validate(past).errors.map((e) => e.code)], [true, ['too_deep']], shape);
    for (const writer of OURS) {
      const label = `${writer.name}, ${shape}`;
      const whole = writer.write(at);
      const words = new Set(whole.output.match(/\bw\d+\b/g));
      assert.equal(words.size, MAX_DEPTH, `${label} ${MAX_DEPTH} deep: every level's word`);
      assert.equal(count(whole.output, TOO_DEEP), 0, `${label} ${MAX_DEPTH} deep: no notice`);
      if (whole.readBack) assert.deepEqual(whole.readBack, at, `${label} ${MAX_DEPTH} deep: reads back`);
      const cut = writer.write(past).output;
      assert.deepEqual([new Set(cut.match(/\bw\d+\b/g)).size, cut.includes(`w${MAX_DEPTH + 1}`), count(cut, TOO_DEEP)], [MAX_DEPTH, false, 1], `${label} ${MAX_DEPTH + 1} deep`);
    }
  }
});

// The text writers' flat text of an inline tree (inlineText in packages/text/inline.js: a
// wikilink's children, and an inline code node's old-named children, also read through the
// text-from-inline alias) counts one level for each list and each node, as validate counts a
// value's levels, against MAX_VALUE_DEPTH. The deepest valid doc of nested em under a wikilink,
// or under an inline code node's old children, is MAX_VALUE_DEPTH levels deep by walkDepth: each
// writer keeps every word of it. A doc deeper than validate allows keeps every word above the cap
// and the too-deep notice once. The marks path (flatten, inline.js) and React's reader are not
// held here: they count against MAX_DEPTH, with the notice past it.
const ems = (k) => [{ type: 'em', children: Array.from({ length: k - 1 }).reduce((kids, _, i) => [{ type: 'text', value: `w${k - 1 - i} ` }, { type: 'em', children: kids }], [{ type: 'text', value: `w${k}` }]) }];
const flat = {
  'a wikilink': (k) => [{ type: 'paragraph', content: [{ type: 'wikilink', target: 'page', children: ems(k) }] }],
  "an inline code node's old children": (k) => [{ type: 'paragraph', content: [{ type: 'code', children: ems(k) }] }],
};
const wordsOf = (s) => new Set(Array.from(s.matchAll(/w(\d+)/g), (m) => Number(m[1])));
const textWriters = OURS.filter((w) => w.package === '@portable-doc/text' && w.name !== 'round-trip Markdown');
// The doc's own levels above the nested em: doc, paragraph, content, the wikilink or code node,
// its children, and the em's text leaf at the bottom; two more for each em.
const DEEPEST_EM = (MAX_VALUE_DEPTH - 6) / 2;

test('the text writers keep every word of inline content under a wikilink or old code children at any depth a valid doc has', () => {
  assert.deepEqual(textWriters.map((w) => w.name), ['readable Markdown', 'plain text']);
  for (const [shape, doc] of Object.entries(flat)) {
    assert.equal(walkDepth(doc(DEEPEST_EM)), MAX_VALUE_DEPTH, `${shape}: ${DEEPEST_EM} em is the deepest valid doc`);
    assert.deepEqual([validate(doc(DEEPEST_EM)).ok, validate(doc(DEEPEST_EM + 1)).errors.map((e) => e.code)], [true, ['too_deep']], shape);
    for (const k of [51, DEEPEST_EM]) {
      for (const writer of textWriters) {
        const out = writer.write(doc(k)).output;
        assert.deepEqual([wordsOf(out).size, out.includes(`w${k}`), count(out, TOO_DEEP)], [k, true, 0], `${writer.name}, ${shape} over ${k} em: every word`);
      }
    }
  }
});

test('past MAX_VALUE_DEPTH, a doc validate refuses, the text writers keep every word above it and write the too-deep notice once', () => {
  // The em holding word i has its children at level 2i of the flat text's count: the cap stops the
  // em holding word MAX_VALUE_DEPTH / 2.
  const k = MAX_VALUE_DEPTH / 2;
  for (const [shape, doc] of Object.entries(flat)) {
    for (const writer of textWriters) {
      const out = writer.write(doc(k)).output;
      assert.deepEqual([wordsOf(out).size, out.includes(`w${k}`), count(out, TOO_DEEP)], [k - 1, false, 1], `${writer.name}, ${shape} over ${k} em`);
    }
  }
});
