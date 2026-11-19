import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { numberText } from '../packages/text/number-text.js';
import { SCALE_MAX_OPTIONS, scaleOptions } from '../packages/text/form-scale.js';
import { toMarkdown, toPlainText } from '../packages/text/index.js';

// A form's rating scale offers whole numbers from its min up by one. A document is untrusted: any
// finite bound it gives must render at once, with at most SCALE_MAX_OPTIONS options, and React's
// HTML, the Markdown and the plain text must show the same scale.

const form = (scale) => [{ type: 'form', questions: [{ id: 'q', prompt: 'Rate', type: 'scale', scale }] }];
const optionsIn = (html) => [...html.matchAll(/<input type="radio" name="q" value="([^"]*)">/g)].map((m) => m[1]);
const scaleLine = (text) => text.match(/Scale: (.*) to (.*)/)?.slice(1) ?? null;

const SCALES = {
  'min -1e16': { min: -1e16 },
  'min -1e16, max -1e16 + 1000': { min: -1e16, max: -1e16 + 1000 },
  'min -1e21': { min: -1e21 },
  'min -1e21, max 1e21': { min: -1e21, max: 1e21 },
  'max 1e21': { max: 1e21 },
  'min the largest number, max too': { min: Number.MAX_VALUE, max: Number.MAX_VALUE },
  'min 2^53': { min: 2 ** 53, max: 2 ** 53 + 1000 },
  'step 1e-300': { min: 1, max: 1e21, step: 1e-300 },
  'step 0': { min: 1, max: 1e21, step: 0 },
  'bounds as strings of 400 nines': { min: '-' + '9'.repeat(400), max: '9'.repeat(400) },
  'bounds as strings past 2^53': { min: '-9007199254740993000', max: '9007199254740993000' },
};

test('a scale with any finite bound renders at once, with at most SCALE_MAX_OPTIONS options, the same in HTML, Markdown and plain text', () => {
  const started = performance.now();
  for (const [name, scale] of Object.entries(SCALES)) {
    const shown = optionsIn(renderPortableDocument(form(scale)));
    assert.ok(shown.length >= 1 && shown.length <= SCALE_MAX_OPTIONS, `${name}: ${shown.length} options`);
    assert.equal(new Set(shown).size, shown.length, `${name}: an option shown twice`);
    assert.deepEqual(shown, scaleOptions(scale).map((v) => numberText(v)), `${name}: React shows other options than scaleOptions`);
    for (const write of [toMarkdown, toPlainText]) assert.deepEqual(scaleLine(write(form(scale))), [shown[0], shown.at(-1)], `${name}: ${write.name} shows another scale`);
  }
  assert.ok(performance.now() - started < 1000, 'the scales took a second or more to render');
});

test('the scale offers min through min + 100, and nothing when max is below min', () => {
  assert.equal(SCALE_MAX_OPTIONS, 101);
  assert.deepEqual(scaleOptions({ min: 1, max: 1000 }), Array.from({ length: 101 }, (_, k) => 1 + k));
  assert.deepEqual(scaleOptions(undefined), [1, 2, 3, 4, 5]);
  assert.deepEqual(scaleOptions({ min: '2', max: 4.5 }), [2, 3, 4, 5], 'a bound that is not whole is its default');
  assert.deepEqual(scaleOptions({ min: 5, max: 1 }), []);
  assert.deepEqual(optionsIn(renderPortableDocument(form({ min: 5, max: 1 }))), []);
  assert.equal(scaleLine(toMarkdown(form({ min: 5, max: 1 }))), null);
});
