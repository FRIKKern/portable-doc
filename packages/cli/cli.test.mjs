import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { toMarkdown, toPlainText } from '@portable-doc/text';
import { main } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const bin = path.join(here, 'bin', 'portable-doc.mjs');
// The bin itself, in a child process.
const run = (args, input) => spawnSync(process.execPath, [bin, ...args], { cwd: root, input: input ?? '', encoding: 'utf8' });
// The bin with module resolution refused for `blocked` specifiers, as when a package is not installed or not built.
function runWithout(blocked, args, input) {
  const hooks = `export async function resolve(s, c, next) { if (${JSON.stringify(blocked)}.includes(s)) { const e = new Error('not found: ' + s); e.code = 'ERR_MODULE_NOT_FOUND'; throw e; } return next(s, c); }`;
  const register = `import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hooks)}`)});`;
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(register)}`, bin, ...args], { cwd: root, input, encoding: 'utf8' });
}
// The same entry point in-process, for the cases that need no real process.
async function call(args, input = '') {
  const r = { stdout: '', stderr: '' };
  const io = { stdout: (t) => void (r.stdout += t), stderr: (t) => void (r.stderr += t), readStdin: async () => input, stdinIsTTY: false };
  r.status = await main(args, io);
  return r;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-doc-cli-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (name, value) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};
const broken = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/broken/mixed-three-codes.json'), 'utf8'));
const valid = fs.readdirSync(path.join(root, 'fixtures/valid')).filter((f) => f.endsWith('.json')).map((f) => `fixtures/valid/${f}`);

test('validate on a broken doc exits 1 and prints each error as file: code at /path: message', () => {
  const file = write('broken.json', broken.doc);
  const r = run(['validate', file]);
  assert.equal(r.status, 1, r.stderr);
  for (const { code, path: at } of broken.expect) assert.match(r.stdout, new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: ${code} at ${at}: \\S`, 'm'));
});

test('every valid fixture passes with exit 0', () => {
  const r = run(['validate', ...valid]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, valid.length);
});

test('stdin is read when the file is - or none is given', () => {
  assert.equal(run(['validate'], JSON.stringify(broken.doc)).status, 1);
  const r = run(['validate', '-'], '[{"type":"paragraph","text":"Hi"}]');
  assert.deepEqual([r.status, r.stdout], [0, '<stdin>: ok\n']);
});

test('bad JSON, a missing file, an unknown command or flag all exit 2', async () => {
  const bad = run(['validate', write('bad.json', '{\n  "blocks": [\n    {"type": nope}\n  ]\n}')]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /bad JSON at line 3, column 14: unexpected "n"/);
  assert.equal((await call(['validate', path.join(tmp, 'missing.json')])).status, 2);
  for (const args of [['frobnicate'], ['validate', '--strict', '-'], ['render', '--format', 'pdf', '-']]) {
    const r = await call(args, '[]');
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /Usage: portable-doc/);
  }
});

test('render markdown and text match @portable-doc/text, and an invalid doc is refused unless --force', async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/valid/nested-containers.json'), 'utf8'));
  const file = write('doc.json', doc);
  assert.equal(run(['render', file, '--format', 'markdown']).stdout, toMarkdown(doc));
  assert.equal(run(['render', file, '--format=text']).stdout, toPlainText(doc));
  const out = path.join(tmp, 'out.md');
  assert.equal((await call(['render', file, '-o', out])).status, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), toMarkdown(doc));
  const refused = await call(['render', '--format', 'text'], JSON.stringify(broken.doc));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /unknown_block_type at \/blocks\/1\/type/);
  assert.equal((await call(['render', '--format', 'text', '--force'], JSON.stringify(broken.doc))).stdout, toPlainText(broken.doc));
});

test('render html is the React renderer\'s markup, field and embed blocks included', () => {
  const doc = [{ type: 'heading', level: 2, text: 'Hello' }, { type: 'field-color', label: 'Accent', value: '#1e5347' }, { type: 'embed', target: 'Notes' }];
  const r = run(['render', '--format', 'html'], JSON.stringify(doc));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^<div class="bp-paper-surface"><h2>Hello<\/h2><div class="bp-field"><span class="bp-field__l">Accent<\/span>.*background:#1e5347.*data-embed="Notes">↪ Notes<\/section><\/div>\n$/s);
  assert.doesNotMatch(r.stdout, /Unsupported block|invalid block/);
});

test('html says what to install or build when the React renderer cannot load', () => {
  const doc = '[{"type":"heading","level":2,"text":"Hello"}]';
  const noReact = runWithout(['react/jsx-runtime'], ['render', '--format', 'html'], doc);
  assert.deepEqual([noReact.status, /run "npm ci"/.test(noReact.stderr)], [2, true], noReact.stderr);
  const unbuilt = runWithout(['@portable-doc/react'], ['render', '--format', 'html'], doc);
  assert.deepEqual([unbuilt.status, /run "npm run react:build"/.test(unbuilt.stderr)], [2, true], unbuilt.stderr);
});

test('explain and validate print doc text, file names and arguments with control characters escaped', async () => {
  const controls = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
  const file = write('esc\u001b]0;t\u0007.json', [{ type: '\u001b[31mred\u009b' }, { type: 'heading', level: 9, text: 'x' }]);
  const outs = [
    await call(['explain', file]),
    await call(['validate', file]),
    await call(['explain', '--json', file]),
    await call(['validate', path.join(tmp, 'gone\u001b[2J.json')]),
    await call(['render', '--format', '\u001b[2J'], '[]'),
  ];
  for (const r of outs) assert.doesNotMatch(r.stdout + r.stderr, controls);
  assert.match(outs[0].stdout, /in the \\u001b\[31mred\\u009b block at \/0/);
  assert.equal(JSON.parse(outs[2].stdout).files[0].errors[0].code, 'unknown_block_type');
});

test('explain --json carries the doc text once escaped: parsed, it is what explain prints before display escaping', async () => {
  const type = 'q"b\\s\u001bc\u007fd\u009be';
  const file = write('quoted.json', [{ type }]);
  const plain = (await call(['explain', file])).stdout.split('\n').filter((l) => /^(\d+\.| ) /.test(l)).map((l) => l.replace(/^(\d+\.| ) +/, ''));
  const [error] = JSON.parse((await call(['explain', '--json', file])).stdout).files[0].errors;
  const shown = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  assert.equal(shown(error.explanation), plain.join(' '));
  assert.ok(error.explanation.includes(`in the ${type} block at /0 `), error.explanation);
  assert.ok(error.explanation.includes(`${error.message}.`), error.explanation);
});

test('render -o - writes to stdout, and -o never takes a flag or the input file', async () => {
  const file = write('self.json', [{ type: 'paragraph', text: 'Keep me' }]);
  const before = fs.readFileSync(file, 'utf8');
  assert.equal((await call(['render', file, '-o', '-'])).stdout, 'Keep me\n');
  for (const args of [['render', file, '-o', file], ['render', file, '-o', path.join(tmp, '.', 'self.json')], ['render', file, '-o', '--force']]) {
    const r = await call(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /Usage: portable-doc render/);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('render -o refuses a hard link to the input and leaves the input as it was', () => {
  const file = write('linked.json', [{ type: 'paragraph', text: 'Keep me' }]);
  const before = fs.readFileSync(file);
  const link = path.join(tmp, 'linked-too.json');
  fs.linkSync(file, link);
  const r = run(['render', file, '-o', link]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Usage: portable-doc render/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('--json results parse, and explain adds the rule each error breaks', async () => {
  const file = write('broken.json', broken.doc);
  const v = JSON.parse(run(['validate', '--json', file, valid[0]]).stdout);
  assert.equal(v.ok, false);
  assert.deepEqual(v.files[0].errors.map((e) => e.code), broken.expect.map((e) => e.code));
  assert.equal(v.files[1].ok, true);
  const e = await call(['explain', file]);
  assert.equal(e.status, 1);
  assert.match(e.stdout, /3 errors[\s\S]*unknown_block_type at \/blocks\/1\/type, in the nope block at \/blocks\/1[\s\S]*Refused when a block's type is not in the schema's type enum\./);
  assert.equal(JSON.parse((await call(['explain', '--json', file])).stdout).files[0].errors[2].refusedWhen, 'a value is outside enum, const, minimum, maximum, or matches a not');
});

test('--help and --version print and exit 0', async () => {
  assert.equal(run(['--version']).stdout, '0.0.0\n');
  assert.match((await call(['--help'])).stdout, /Commands:/);
  assert.match((await call(['render', '--help'])).stdout, /--format/);
});

test('import turns Markdown from a file or stdin into a doc that validate accepts', async () => {
  const md = '## Notes\n\nSome **bold** text and [a link](https://example.com).\n\n- [x] done\n- [ ] next\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
  const file = write('notes.md', md);
  const fromFile = run(['import', file]);
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(run(['import'], md).stdout, fromFile.stdout);
  const doc = JSON.parse(fromFile.stdout);
  assert.deepEqual(doc.blocks.map((b) => b.type), ['heading', 'paragraph', 'list', 'table']);
  const out = path.join(tmp, 'notes.json');
  assert.equal((await call(['import', file, '-o', out])).status, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), fromFile.stdout);
  assert.deepEqual([run(['validate', out]).status, run(['validate'], fromFile.stdout).status], [0, 0]);
  assert.equal((await call(['import', path.join(tmp, 'missing.md')])).status, 2);
  assert.equal((await call(['import', file, '-o', file])).status, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), md);
});

test('validate, explain and render list the first MAX_ERRORS errors and say how many more there were', async () => {
  const file = write('many.json', { blocks: Array(1003).fill(5) });
  const checked = await call(['validate', file]);
  assert.equal(checked.status, 1);
  const lines = checked.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 1001);
  assert.equal(lines.at(-1), `${file}: 3 more errors, not listed`);
  const json = JSON.parse((await call(['validate', '--json', file])).stdout);
  assert.deepEqual([json.files[0].errors.length, json.files[0].more], [1000, 3]);
  const explained = await call(['explain', file]);
  assert.match(explained.stdout, new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: 1003 errors\n`));
  assert.match(explained.stdout, /\n1000\. /);
  assert.ok(explained.stdout.endsWith(`${file}: 3 more errors, not listed\n`));
  const rendered = await call(['render', file]);
  assert.equal(rendered.status, 1);
  assert.match(rendered.stderr, /: 3 more errors, not listed\n/);
  const one = JSON.parse((await call(['validate', '--json', write('few.json', { blocks: [5] })])).stdout);
  assert.equal(Object.hasOwn(one.files[0], 'more'), false);
});
