import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { FROM_MARKDOWN, fixtureCases } from '../../scripts/lib/fixture-cases.mjs';
import { KEEP_BYTES } from '../../scripts/write-shared-cases.mjs';
import { currentNames } from './current-names.js';
import { fromMarkdown, toMarkdown } from './index.js';
import { isMap } from './util.js';

// A list item holds blocks in its `children`. Import reads an item's nested lists back as its
// children and folds any other block in it into the item's text, by the split rule (text after a
// nested list starts a new item). So round-trip mode writes a list natively, an indented item with
// its blocks inside, exactly when its own Markdown reads back as it: today, items whose blocks are
// nested lists. Any other list goes in one fence of the whole list, or is listed in `lost`.

const ROUND_TRIP = { mode: 'round-trip' };
const t = (value) => ({ type: 'text', value });
const fence = (block) => toMarkdown([{ type: 'code', lang: 'portabledoc', value: JSON.stringify([block]) }]);
const holdsBlocks = (b) => Array.isArray(b.items) && b.items.some((item) => isMap(item) && Array.isArray(item.children) && item.children.length > 0);

/** The outermost lists in `x` whose items hold blocks: a list in one is written as part of it. */
function outermost(x, out = []) {
  if (Array.isArray(x)) for (const y of x) outermost(y, out);
  else if (isMap(x)) {
    if (holdsBlocks(x)) out.push(x);
    else for (const v of Object.values(x)) outermost(v, out);
  }
  return out;
}

test('in every fixture case, a list whose items hold blocks is written in its own Markdown exactly when that reads back, else as one fence of the whole list', async () => {
  const seen = new Set();
  const wrong = [];
  const routes = { native: 0, fenced: 0, lost: 0 };
  let fromText = 0;
  // A case's lists as stored: a round-trip case's input, before import puts its old names under
  // their current names, so a form stored under an old name counts as its own list.
  for (const { folder, name, blocks: read, input } of await fixtureCases()) {
    const blocks = input ?? read;
    // The few generated inputs over KEEP_BYTES (callouts 1000 deep) take seconds to read back.
    if (JSON.stringify(blocks).length > KEEP_BYTES) continue;
    for (const list of outermost(blocks)) {
      // Deduped per folder, so a list made from Markdown is checked as such even when an earlier folder holds it too.
      const key = `${folder} ${JSON.stringify(list)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const own = toMarkdown([list]);
      const readsBack = isDeepStrictEqual(fromMarkdown(own), currentNames([list]));
      const { markdown, lost } = toMarkdown([list], ROUND_TRIP);
      if (readsBack) {
        routes.native++;
        if (markdown !== own) wrong.push(`${name}: reads back in its own Markdown, but is not written so`);
      } else if (lost.length) routes.lost++;
      else {
        routes.fenced++;
        if (markdown !== fence(list)) wrong.push(`${name}: neither its own Markdown nor one fence of the whole list`);
      }
      if (!lost.length && !isDeepStrictEqual(fromMarkdown(markdown), currentNames([list]))) wrong.push(`${name}: written as kept, but reads back differently`);
      // A list import made from Markdown a person wrote reads back in its own Markdown, so a broken
      // nested-list writer shows here, not as lists quietly moved into fences.
      if (FROM_MARKDOWN.includes(folder)) {
        fromText++;
        if (!readsBack) wrong.push(`${name}: import made this list from Markdown, and its own Markdown no longer reads back as it`);
      }
    }
  }
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} lists`);
  // Exact, so a list cannot change route unseen; a new shared case moves these on purpose.
  // text-work "tabs between markers" reads as a list 99 deep since import nests to MAX_DEPTH; at 50
  // deep it was the same list as "a lazy line that looks like a fence", so it counted once.
  assert.deepEqual({ ...routes, fromText }, { native: 26, fenced: 61, lost: 0, fromText: 25 });
});

test('a list whose item holds a block import cannot bring back is reported in lost, never written as kept', () => {
  const item = (child) => [{ type: 'list', ordered: false, items: [{ content: [t('Item')], children: [child] }] }];
  const image = { type: 'image', src: 'https://example.com/a.png', alt: 'A' };
  const unsafe = { type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', children: [t('bad')] }] };
  for (const [child, reason] of [
    [image, 'type'],
    [unsafe, 'address'],
  ]) {
    const { markdown, lost } = toMarkdown(item(child), ROUND_TRIP);
    assert.deepEqual(lost, [{ path: '/blocks/0', id: null, type: 'list', reason }], child.type);
    assert.equal(markdown, toMarkdown(item(child)), `${child.type}: written readably`);
  }
});
