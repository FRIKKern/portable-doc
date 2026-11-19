import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPortableDocument } from '@portable-doc/react';
import { numberText } from '../packages/text/number-text.js';
import { SCALE_MAX_OPTIONS, scaleOptions } from '../packages/text/form-scale.js';
import { toMarkdown, toPlainText } from '../packages/text/index.js';

// A form's rating scale offers whole numbers from its min up by one. A document is untrusted: any
// finite bound it gives must render at once, with at most SCALE_MAX_OPTIONS options, and React's
// HTML, the Markdown and the plain text must show the same scale. "At once" is shown by counting:
// the options are capped, so the output is bounded; on the old code min -1e16 throws RangeError.

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

// An option's HTML is under 200 characters (its label is a number's digits), so a scale's HTML is bounded.
const MAX_HTML = 1000 + SCALE_MAX_OPTIONS * 200;

test('a scale with any finite bound renders at once, with at most SCALE_MAX_OPTIONS options, the same in HTML, Markdown and plain text', () => {
  for (const [name, scale] of Object.entries(SCALES)) {
    const [html, markdown, text] = [renderPortableDocument(form(scale)), toMarkdown(form(scale)), toPlainText(form(scale))];
    const shown = optionsIn(html);
    assert.ok(shown.length >= 1 && shown.length <= SCALE_MAX_OPTIONS, `${name}: ${shown.length} options`);
    assert.ok(html.length <= MAX_HTML && markdown.length < 500 && text.length < 500, `${name}: ${html.length}, ${markdown.length} and ${text.length} characters`);
    assert.equal(new Set(shown).size, shown.length, `${name}: an option shown twice`);
    assert.deepEqual(shown, scaleOptions(scale).map((v) => numberText(v)), `${name}: React shows other options than scaleOptions`);
    for (const [writer, out] of [['Markdown', markdown], ['plain text', text]]) assert.deepEqual(scaleLine(out), [shown[0], shown.at(-1)], `${name}: the ${writer} shows another scale`);
  }
});

// -1e16 plus 0 to 100: past 2^53 numbers are two apart, so 101 sums give 51 distinct options.
test('min -1e16 renders a counted scale: the options past 2^53 that repeat are shown once', () => {
  const html = renderPortableDocument(form({ min: -1e16 }));
  assert.deepEqual({ options: optionsIn(html).length, html: html.length, markdown: toMarkdown(form({ min: -1e16 })).length }, { options: 51, html: 6338, markdown: 58 });
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
