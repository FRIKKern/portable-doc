import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { transcript } from './transcript.mjs';

test('TRANSCRIPT.md is what the transcript script writes today', async () => {
  const fresh = await transcript();
  assert.match(fresh, /## 5\. Render it through the reader/);
  assert.equal(fs.readFileSync(new URL('TRANSCRIPT.md', import.meta.url), 'utf8'), fresh, 'stale: run node packages/mcp/transcript.mjs');
});
