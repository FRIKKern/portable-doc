import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('TRANSCRIPT.md is what the transcript script writes today, and importing the script writes nothing', async () => {
  const file = new URL('TRANSCRIPT.md', import.meta.url);
  const before = fs.statSync(file).mtimeMs;
  const { transcript } = await import('./transcript.mjs');
  assert.equal(fs.statSync(file).mtimeMs, before);
  const fresh = await transcript();
  assert.match(fresh, /## 5\. Render it through the reader/);
  assert.equal(fs.readFileSync(file, 'utf8'), fresh, 'stale: run node packages/mcp/transcript.mjs');
});
