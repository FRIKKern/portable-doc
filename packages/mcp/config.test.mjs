import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RENDER_TIMEOUT_MS, configFromEnv } from './index.js';
import { readerUrl } from './render.js';

test('BARKPARK_TIMEOUT_MS takes a whole number of ms from 1 to 60000; anything else is the default', () => {
  assert.equal(configFromEnv({}).timeoutMs, RENDER_TIMEOUT_MS);
  for (const [value, ms] of [['1', 1], ['300', 300], ['60000', 60_000]]) assert.equal(configFromEnv({ BARKPARK_TIMEOUT_MS: value }).timeoutMs, ms);
  for (const value of ['', '0', '-5', '1.5', 'abc', '60001', '2147483648', ' ', '1e3x']) {
    assert.equal(configFromEnv({ BARKPARK_TIMEOUT_MS: value }).timeoutMs, RENDER_TIMEOUT_MS, value);
  }
});

test('BARKPARK_URL: missing, not a URL, not http, a path prefix, query and hash dropped', () => {
  assert.equal(configFromEnv({}).base, undefined);
  assert.match(readerUrl(undefined).error, /render needs BARKPARK_URL/);
  assert.match(readerUrl('').error, /render needs BARKPARK_URL/);
  assert.match(readerUrl('guerrilla').error, /is not a URL/);
  assert.match(readerUrl('ftp://x').error, /must be http or https/);
  assert.equal(readerUrl('https://h.example').url, 'https://h.example/v1/plugins/bulldocs/render');
  assert.equal(readerUrl('https://h.example/w/a/p/b//').url, 'https://h.example/w/a/p/b/v1/plugins/bulldocs/render');
  assert.equal(readerUrl('http://h.example:4000/?x=1#y').url, 'http://h.example:4000/v1/plugins/bulldocs/render');
});
