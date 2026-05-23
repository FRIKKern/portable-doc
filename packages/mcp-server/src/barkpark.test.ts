/**
 * Tests for the optional Barkpark forwarding path (Wave 4 / T4.5).
 *
 * Three behaviours are pinned, per the plan's verify clause:
 *   (a) with a target configured, the tool POSTs the applied op to the DERIVED
 *       ops URL with the bearer header and the op as the body;
 *   (b) no target → no network call; the result is byte-identical to the
 *       pre-forwarding behaviour (no `forward` field);
 *   (c) a forwarding failure (rejection or non-2xx) still returns a successful
 *       local append, with the error surfaced in `result.forward`.
 *
 * The URL-derivation helper is covered directly as well.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Block, PortableDoc } from '@portable-doc/core';
import { docAppendBlock } from './tools.js';
import {
  BARKPARK_INGEST_TOKEN_ENV,
  BARKPARK_INGEST_URL_ENV,
  deriveOpsUrl,
  forwardOp,
  resolveBarkparkTarget,
} from './barkpark.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;

const TOKEN = 'tok-secret-123';

function newBlock(): Block {
  return {
    id: 'streamed-heading',
    type: 'heading',
    level: 2,
    text: 'Streamed into Barkpark',
  };
}

/** A fetch stub that records its args and returns a 2xx JSON ops response. */
function okFetch(
  body: Record<string, unknown> = { ok: true, rev: 7, block_id: 'streamed-heading', position: 3 },
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// ---------------------------------------------------------------------------
// deriveOpsUrl — the single URL-derivation helper
// ---------------------------------------------------------------------------

describe('deriveOpsUrl', () => {
  it('replaces the trailing /papers with /papers/<slug>/ops', () => {
    expect(deriveOpsUrl('https://barkpark.example/v1/paperflow/papers', 'my-paper')).toBe(
      'https://barkpark.example/v1/paperflow/papers/my-paper/ops',
    );
  });

  it('tolerates a trailing slash on the ingest URL', () => {
    expect(deriveOpsUrl('https://barkpark.example/v1/paperflow/papers/', 'my-paper')).toBe(
      'https://barkpark.example/v1/paperflow/papers/my-paper/ops',
    );
  });

  it('falls back to <origin>/v1/paperflow/papers/<slug>/ops when no /papers in path', () => {
    expect(deriveOpsUrl('https://barkpark.example', 'my-paper')).toBe(
      'https://barkpark.example/v1/paperflow/papers/my-paper/ops',
    );
  });

  it('encodes a slug with URL-unsafe characters', () => {
    expect(deriveOpsUrl('https://barkpark.example/v1/paperflow/papers', 'a b/c')).toBe(
      'https://barkpark.example/v1/paperflow/papers/a%20b%2Fc/ops',
    );
  });

  it('drops any query/hash from the ingest URL', () => {
    expect(
      deriveOpsUrl('https://barkpark.example/v1/paperflow/papers?x=1#frag', 'p'),
    ).toBe('https://barkpark.example/v1/paperflow/papers/p/ops');
  });
});

// ---------------------------------------------------------------------------
// resolveBarkparkTarget — needs all three of slug + url + token
// ---------------------------------------------------------------------------

describe('resolveBarkparkTarget', () => {
  const fullEnv = {
    [BARKPARK_INGEST_URL_ENV]: 'https://barkpark.example/v1/paperflow/papers',
    [BARKPARK_INGEST_TOKEN_ENV]: TOKEN,
  } as NodeJS.ProcessEnv;

  it('resolves a target when slug + url + token are all present', () => {
    const t = resolveBarkparkTarget('my-paper', fullEnv);
    expect(t).toEqual({
      slug: 'my-paper',
      opsUrl: 'https://barkpark.example/v1/paperflow/papers/my-paper/ops',
      token: TOKEN,
    });
  });

  it('returns null when slug is missing', () => {
    expect(resolveBarkparkTarget(undefined, fullEnv)).toBeNull();
    expect(resolveBarkparkTarget('   ', fullEnv)).toBeNull();
  });

  it('returns null when the ingest URL env is missing', () => {
    expect(
      resolveBarkparkTarget('my-paper', { [BARKPARK_INGEST_TOKEN_ENV]: TOKEN } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('returns null when the token env is missing', () => {
    expect(
      resolveBarkparkTarget('my-paper', {
        [BARKPARK_INGEST_URL_ENV]: 'https://barkpark.example/v1/paperflow/papers',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('returns null (never throws) on a malformed ingest URL', () => {
    expect(
      resolveBarkparkTarget('my-paper', {
        [BARKPARK_INGEST_URL_ENV]: 'not a url',
        [BARKPARK_INGEST_TOKEN_ENV]: TOKEN,
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// forwardOp — POST shape + defensive failure handling
// ---------------------------------------------------------------------------

describe('forwardOp', () => {
  const target = {
    slug: 'my-paper',
    opsUrl: 'https://barkpark.example/v1/paperflow/papers/my-paper/ops',
    token: TOKEN,
  };
  const op = { op: 'append-block', block: newBlock() } as const;

  it('POSTs the op to the ops URL with the bearer header and JSON body', async () => {
    const { impl, calls } = okFetch();
    const res = await forwardOp(target, op, impl);

    expect(res).toEqual({ forwarded: true, rev: 7, blockId: 'streamed-heading', position: 3 });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(target.opsUrl);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual(op);
  });

  it('returns an error result (no throw) on a rejected fetch', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const res = await forwardOp(target, op, impl);
    expect(res).toMatchObject({ forwarded: false, reason: 'error' });
    if (res.forwarded === false && res.reason === 'error') {
      expect(res.error).toContain('ECONNREFUSED');
    }
  });

  it('returns an error result (no throw) on a non-2xx status', async () => {
    const impl = vi.fn(
      async () => new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    ) as unknown as typeof fetch;
    const res = await forwardOp(target, op, impl);
    expect(res).toMatchObject({ forwarded: false, reason: 'error' });
    if (res.forwarded === false && res.reason === 'error') {
      expect(res.error).toContain('500');
    }
  });
});

// ---------------------------------------------------------------------------
// docAppendBlock — the three end-to-end forwarding behaviours
// ---------------------------------------------------------------------------

describe('docAppendBlock forwarding', () => {
  it('(a) with a target configured, forwards the applied op to the derived URL', async () => {
    vi.stubEnv(BARKPARK_INGEST_URL_ENV, 'https://barkpark.example/v1/paperflow/papers');
    vi.stubEnv(BARKPARK_INGEST_TOKEN_ENV, TOKEN);
    try {
      const block = newBlock();
      const { impl, calls } = okFetch();
      const out = await docAppendBlock({
        document: welcome,
        block,
        barkparkSlug: 'my-paper',
        fetchImpl: impl,
      });

      // Local apply still succeeds.
      expect(out.document.blocks).toHaveLength(welcome.blocks.length + 1);
      expect(out.fragment).toContain('Streamed into Barkpark');

      // Forwarded to the derived ops URL with the bearer header + op body.
      expect(out.forward).toEqual({
        forwarded: true,
        rev: 7,
        blockId: 'streamed-heading',
        position: 3,
      });
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.url).toBe('https://barkpark.example/v1/paperflow/papers/my-paper/ops');
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
      expect(JSON.parse(String(call.init?.body))).toEqual({ op: 'append-block', block });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('(b) no target (no slug) → no network call, behaviour identical to before', async () => {
    vi.stubEnv(BARKPARK_INGEST_URL_ENV, 'https://barkpark.example/v1/paperflow/papers');
    vi.stubEnv(BARKPARK_INGEST_TOKEN_ENV, TOKEN);
    try {
      const block = newBlock();
      const impl = vi.fn() as unknown as typeof fetch;
      const out = await docAppendBlock({ document: welcome, block, fetchImpl: impl });

      expect(impl).not.toHaveBeenCalled();
      expect(out.forward).toBeUndefined();
      expect(out.document.blocks).toHaveLength(welcome.blocks.length + 1);
      expect(out.fragment).toContain('Streamed into Barkpark');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('(b2) slug given but env unset → not-configured, no network call', async () => {
    vi.stubEnv(BARKPARK_INGEST_URL_ENV, '');
    vi.stubEnv(BARKPARK_INGEST_TOKEN_ENV, '');
    try {
      const impl = vi.fn() as unknown as typeof fetch;
      const out = await docAppendBlock({
        document: welcome,
        block: newBlock(),
        barkparkSlug: 'my-paper',
        fetchImpl: impl,
      });
      expect(impl).not.toHaveBeenCalled();
      expect(out.forward).toEqual({ forwarded: false, reason: 'not-configured' });
      expect(out.document.blocks).toHaveLength(welcome.blocks.length + 1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('(c) a forwarding failure still returns a successful local append', async () => {
    vi.stubEnv(BARKPARK_INGEST_URL_ENV, 'https://barkpark.example/v1/paperflow/papers');
    vi.stubEnv(BARKPARK_INGEST_TOKEN_ENV, TOKEN);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const block = newBlock();
      const impl = vi.fn(
        async () => new Response('nope', { status: 500, statusText: 'Internal Server Error' }),
      ) as unknown as typeof fetch;
      const out = await docAppendBlock({
        document: welcome,
        block,
        barkparkSlug: 'my-paper',
        fetchImpl: impl,
      });

      // Local append succeeded despite the forward failure.
      expect(out.document.blocks).toHaveLength(welcome.blocks.length + 1);
      expect(out.fragment).toContain('Streamed into Barkpark');
      expect(out.forward).toMatchObject({ forwarded: false, reason: 'error' });
      if (out.forward && out.forward.forwarded === false && out.forward.reason === 'error') {
        expect(out.forward.error).toContain('500');
      }
    } finally {
      errSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
