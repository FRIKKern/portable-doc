import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { README, ruleSentence, withRule } from './write-readme.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the text README carries the alias rule as scripts/write-readme.mjs writes it from the table', () => {
  const text = fs.readFileSync(README, 'utf8');
  assert.equal(text, withRule(text), 'packages/text/README.md: run node scripts/write-readme.mjs');
});

test('every copy of the alias rule in the repo is byte-equal to the sentence in alias-table.js', () => {
  const sentence = ruleSentence();
  // Its first words, across any whitespace, so a copy wrapped onto several lines is found too.
  const head = /For\s+each\s+field,\s+read\s+the\s+names/g;
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const copies = [];
  for (const file of files) {
    // The table is the source; write-readme.mjs names the sentence's first words to cut it out.
    if (file === 'packages/text/alias-table.js' || file === 'scripts/write-readme.mjs' || !/\.(?:m?js|ts|tsx|md|json)$/.test(file) || !fs.existsSync(`${root}/${file}`)) continue;
    const text = fs.readFileSync(`${root}/${file}`, 'utf8');
    for (const { index } of text.matchAll(head)) {
      copies.push(file);
      assert.equal(text.slice(index, index + sentence.length), sentence, `${file}: a copy of the alias rule that differs from alias-table.js's`);
    }
  }
  assert.deepEqual(copies.sort(), ['packages/text/README.md', 'packages/text/read-aliases-rule.test.mjs']);
});

test('the rule is cut from the _comment only where it runs once from its first words to its last clause', () => {
  assert.throws(() => ruleSentence('no rule here'), /must run once/);
  const one = ruleSentence();
  assert.throws(() => ruleSentence(`${one} ${one}`), /must run once/);
  assert.equal(withRule('a\n  <!-- alias-rule:start -->\n  old\n  <!-- alias-rule:end -->\nb\n', 'S.'), 'a\n  <!-- alias-rule:start -->\n  S.\n  <!-- alias-rule:end -->\nb\n');
});
