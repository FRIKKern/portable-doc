// @vitest-environment jsdom
/**
 * url-state specs — encode/decode round-trip via the browser-native
 * `CompressionStream` API (jsdom inherits the Node 18+ globals so this works
 * inside vitest without polyfills). Garbage input must yield `null`, not a
 * thrown exception. `buildShareUrl` must append the `doc` query param to the
 * current location while preserving any existing path / hash.
 */
import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeDoc, encodeDoc } from './url-state.js';

describe('url-state', () => {
  it('encodeDoc + decodeDoc round-trips a JSON document', async () => {
    const json = JSON.stringify({ version: 1, title: 'Round-trip', blocks: [] });
    const encoded = await encodeDoc(json);
    expect(typeof encoded).toBe('string');
    expect(encoded).not.toContain('+'); // url-safe alphabet
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    const decoded = await decodeDoc(encoded);
    expect(decoded).toBe(json);
  });

  it('decodeDoc returns null on garbage input', async () => {
    const out = await decodeDoc('!!!not-base64!!!');
    expect(out).toBeNull();
  });

  it('buildShareUrl appends ?doc=… to a base URL', () => {
    const url = buildShareUrl('abc123', 'https://example.com/playground/');
    expect(url).toBe('https://example.com/playground/?doc=abc123');
  });

  it('buildShareUrl replaces an existing ?doc= param without duplicating it', () => {
    const url = buildShareUrl('NEW', 'https://example.com/?doc=OLD&other=1');
    expect(url).toMatch(/[?&]doc=NEW/);
    expect(url).not.toMatch(/doc=OLD/);
    expect(url).toMatch(/other=1/);
  });
});
