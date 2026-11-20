// Every writer here, the text writers and React's reader, nests as deep as validate's MAX_DEPTH:
// a doc MAX_DEPTH blocks deep (a list in each list item, or a callout in each callout's body)
// is written whole, and one level more, a doc validate refuses, keeps the MAX_DEPTH levels above
// and writes the one past them as the too-deep notice, once. The round-trip writer's Markdown of
// the deepest valid doc reads back as the same blocks. The editor's writers are Barkpark's,
// copied by the sync (decision 0012), and are held there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DEPTH, validate } from '@portable-doc/validate';
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
