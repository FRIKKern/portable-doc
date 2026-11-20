// Fields the text writers do not write, whatever their value, because they only place something in
// a drawing. Each row: the block, the field, the values tried, and why the writers leave it out.
// Markdown and plain text must be the same for every value, and the same as with no value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMarkdown, toPlainText } from './index.js';

const ROWS = [
  {
    block: { type: 'roadmap', start: '2026-01-01', end: '2026-01-11', scale: ['Jan'], snapshot: [{ title: 'Build', left: 0, width: 50, status: 'done' }] },
    field: 'today',
    values: ['2026-01-04', 40, 'soon'],
    reason: "the today line is position only: it marks a place on the roadmap's track, as a lane's left and width do",
  },
];

for (const { block, field, values, reason } of ROWS) {
  test(`the writers leave ${block.type}.${field} out for every value: ${reason}`, () => {
    for (const write of [toMarkdown, toPlainText]) {
      const none = write([block]);
      assert.notEqual(none, '', `${write.name} wrote nothing for the block`);
      for (const value of values) assert.equal(write([{ ...block, [field]: value }]), none, `${write.name}, ${field} ${JSON.stringify(value)}`);
    }
  });
}
