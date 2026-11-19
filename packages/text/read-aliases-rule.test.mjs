import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALIAS_CURRENT_WHITESPACE_WINS, ALIAS_TYPES } from './alias-types.js';
import { aliasTable, readItem } from './read-aliases.js';

// A second reader, written from the rule sentence in the table's _comment alone, with the
// table's rows and alias-types.js as its only data. It must agree with readItem on every field,
// over every combination of a set of values under the field's names.
const TABLE = aliasTable();
const RULE = "For each field, read the names in order: the current name first, then the old names in table order. Skip a name that is missing, null, or holds the wrong type. Where the row's column 'a whitespace-only value under the current name wins' says yes, take the first remaining name whose value holds any character, whitespace included. Where it says no, take the first remaining name whose value holds a non-whitespace character, else the first that holds any character. If none does, take the first remaining name as stored. If no name remains, the field is empty. A string holds the characters it has; a non-empty array, a number or a non-empty object holds a non-whitespace character.";

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const OF = { string: (v) => typeof v === 'string' || Number.isFinite(v), number: (v) => typeof v === 'number', integer: Number.isInteger, boolean: (v) => typeof v === 'boolean', array: Array.isArray, object: isObject, null: (v) => v === null };
const wrongType = (key, v) => ALIAS_TYPES[key] !== null && !ALIAS_TYPES[key].some((type) => OF[type](v));
const anyCharacter = (v) => (typeof v === 'string' ? v.length > 0 : nonWhitespace(v));
const nonWhitespace = (v) => (typeof v === 'string' ? /\S/.test(v) : (Array.isArray(v) && v.length > 0) || typeof v === 'number' || (isObject(v) && Object.keys(v).length > 0));

function bySentence(item, owner, field, names) {
  const remaining = names.filter((name) => item[name] !== undefined && item[name] !== null && !wrongType(`${owner}.${name}`, item[name]));
  const yes = ALIAS_CURRENT_WHITESPACE_WINS[`${owner}.${field}`];
  const pick = (yes ? remaining.find((n) => anyCharacter(item[n])) : remaining.find((n) => nonWhitespace(item[n])) ?? remaining.find((n) => anyCharacter(item[n]))) ?? remaining[0];
  return pick === undefined ? { name: field, value: undefined } : { name: pick, value: item[pick] };
}

const VALUES = [undefined, null, '', ' ', '\n', 'w', 0, 7, NaN, true, [], [{ type: 'text', value: 'a' }], [{ type: 'text', value: ' ' }], {}, { type: 'text', value: 'o' }];

test('the sentence in the table\'s _comment is the rule readItem follows: a reader built from it alone agrees on every field over every combination of values', () => {
  assert.ok(TABLE._comment.includes(RULE), 'the _comment states the rule word for word');
  const fields = new Map();
  for (const [from, { to }] of Object.entries(TABLE.aliases)) {
    if (!fields.has(to)) fields.set(to, [to.slice(to.lastIndexOf('.') + 1)]);
    fields.get(to).push(from.slice(from.lastIndexOf('.') + 1));
  }
  let reads = 0;
  for (const [to, names] of fields) {
    const owner = to.slice(0, to.lastIndexOf('.'));
    const field = names[0];
    const combos = names.reduce((acc) => acc.flatMap((c) => VALUES.map((v) => [...c, v])), [[]]);
    for (const combo of combos) {
      const item = {};
      names.forEach((name, i) => { if (combo[i] !== undefined) item[name] = combo[i]; });
      assert.deepEqual(readItem(item, owner, field), bySentence(item, owner, field, names), `${to} ${JSON.stringify(item)}`);
      reads++;
    }
  }
  assert.ok(reads > 50000, `${reads} reads`);
});
