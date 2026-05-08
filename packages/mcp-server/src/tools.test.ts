/**
 * End-to-end tests for the four MCP tools.
 *
 * Tools are tested as pure functions (the stdio transport adds no logic
 * beyond serialization). The renderers run real backends — output is the
 * same string clients would receive over the wire.
 */
import { describe, expect, it } from 'vitest';
import type { PortableDoc } from '@portable-doc/core';
import { incident, welcome } from '@portable-doc/fixtures';
import {
  docExplainBlock,
  docRender,
  docSuggestFixes,
  docValidate,
} from './tools.js';

const ANSI_CSI = /\[[0-9;]*m/;

// ---------------------------------------------------------------------------
// doc_validate
// ---------------------------------------------------------------------------

describe('doc_validate', () => {
  it('returns valid:true with no issues for the welcome fixture', () => {
    const out = docValidate({ document: welcome });
    expect(out.valid).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('returns valid:true for the incident fixture (full coverage)', () => {
    const out = docValidate({ document: incident });
    expect(out.valid).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('returns valid:false with issues for a doc that breaks rules', () => {
    const broken: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'a',
          type: 'action',
          label: 'x'.repeat(100), // exceeds 48-char limit
          href: 'javascript:alert(1)', // disallowed scheme
          priority: 'primary',
        },
      ],
    };
    const out = docValidate({ document: broken });
    expect(out.valid).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);
    const rules = new Set(out.issues.map((i) => i.rule));
    expect(rules.has('content-constraint')).toBe(true);
    expect(rules.has('url-safety')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// doc_render
// ---------------------------------------------------------------------------

describe('doc_render', () => {
  it('renders web via backend-web-server (slim HTML, no react-native-web)', async () => {
    const out = await docRender({ document: welcome, surface: 'web' });
    expect(out.surface).toBe('web');
    expect(out.output.startsWith('<!doctype html>')).toBe(true);
    // backend-web-server emits inline-styled markup with no <style> blocks.
    expect(out.output).toContain('<body');
    // RNW would have left a `data-reactroot` or similar marker — must not be present.
    expect(out.output).not.toContain('data-reactroot');
  });

  it('renders email via backend-email (HTML doc)', async () => {
    const out = await docRender({ document: welcome, surface: 'email' });
    expect(out.surface).toBe('email');
    expect(out.output.length).toBeGreaterThan(0);
    expect(out.output.toLowerCase()).toMatch(/<!doctype html|<html/);
  });

  it('renders tui via backend-ink (string output)', async () => {
    const out = await docRender({ document: welcome, surface: 'tui' });
    expect(out.surface).toBe('tui');
    expect(typeof out.output).toBe('string');
    expect(out.output.length).toBeGreaterThan(0);
  });

  it('renders text as ANSI-stripped plain output (Ink in mono mode)', async () => {
    const out = await docRender({ document: welcome, surface: 'text' });
    expect(out.surface).toBe('text');
    expect(out.output.length).toBeGreaterThan(0);
    expect(ANSI_CSI.test(out.output)).toBe(false);
    // OSC-8 hyperlink prefix shouldn't appear either.
    expect(out.output.includes(']8;;')).toBe(false);
  });

  it('renders native as JSON-parseable Pd-tree', async () => {
    const out = await docRender({ document: welcome, surface: 'native' });
    expect(out.surface).toBe('native');
    const parsed = JSON.parse(out.output) as Record<string, unknown>;
    expect(typeof parsed).toBe('object');
    expect(parsed['kind']).toBe('PdContainer');
  });
});

// ---------------------------------------------------------------------------
// doc_explain_block
// ---------------------------------------------------------------------------

describe('doc_explain_block', () => {
  it('returns contract + per-surface explanation for callout', () => {
    const out = docExplainBlock({ blockType: 'callout' });
    expect(out.blockType).toBe('callout');
    expect(out.contract).toMatchObject({
      web: 'native',
      native: 'native',
      email: 'native',
      tui: 'native',
      text: 'native',
    });
    for (const surface of ['web', 'native', 'email', 'tui', 'text'] as const) {
      expect(typeof out.explanation[surface]).toBe('string');
      expect(out.explanation[surface].length).toBeGreaterThan(0);
    }
  });

  it('flags image as unsupported on email/tui/text', () => {
    const out = docExplainBlock({ blockType: 'image' });
    expect(out.contract.email).toBe('unsupported');
    expect(out.contract.tui).toBe('unsupported');
    expect(out.contract.text).toBe('unsupported');
    expect(out.contract.web).toBe('native');
    expect(out.contract.native).toBe('native');
  });

  it('throws on unknown block type', () => {
    expect(() => docExplainBlock({ blockType: 'unknown' })).toThrow(
      /Unknown blockType/,
    );
  });
});

// ---------------------------------------------------------------------------
// doc_suggest_fixes
// ---------------------------------------------------------------------------

describe('doc_suggest_fixes', () => {
  it('rewrites http:// to https:// for action.href', () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'a',
          type: 'action',
          label: 'Open',
          href: 'http://example.com/x',
          priority: 'primary',
        },
      ],
    };
    const out = docSuggestFixes({ document: doc });
    const action = out.fixedDocument.blocks[0];
    expect(action && action.type === 'action' && action.href).toBe(
      'https://example.com/x',
    );
    expect(out.changes.some((c) => c.includes('http:// to https://'))).toBe(true);
  });

  it('replaces empty heading.text with "Untitled section"', () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [{ id: 'h', type: 'heading', level: 1, text: '' }],
    };
    const out = docSuggestFixes({ document: doc });
    const heading = out.fixedDocument.blocks[0];
    expect(heading && heading.type === 'heading' && heading.text).toBe(
      'Untitled section',
    );
    expect(out.changes.some((c) => c.includes('Untitled section'))).toBe(true);
  });

  it('truncates overlong action.label to 45 chars + ellipsis', () => {
    const longLabel = 'X'.repeat(80);
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'a',
          type: 'action',
          label: longLabel,
          href: 'https://example.com',
          priority: 'primary',
        },
      ],
    };
    const out = docSuggestFixes({ document: doc });
    const action = out.fixedDocument.blocks[0];
    if (!action || action.type !== 'action') throw new Error('expected action block');
    expect(action.label.length).toBe(46); // 45 chars + … (1 char)
    expect(action.label.endsWith('…')).toBe(true);
    expect(out.changes.some((c) => c.includes('truncated'))).toBe(true);
  });

  it('drops paragraphs with empty content', () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        { id: 'p1', type: 'paragraph', content: [] },
        { id: 'p2', type: 'paragraph', content: [{ type: 'text', value: 'kept' }] },
      ],
    };
    const out = docSuggestFixes({ document: doc });
    expect(out.fixedDocument.blocks).toHaveLength(1);
    expect(out.fixedDocument.blocks[0]?.id).toBe('p2');
    expect(out.changes.some((c) => c.includes('dropped'))).toBe(true);
  });

  it('replaces empty action.label with "Continue"', () => {
    const doc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'a',
          type: 'action',
          label: '',
          href: 'https://example.com',
          priority: 'primary',
        },
      ],
    };
    const out = docSuggestFixes({ document: doc });
    const action = out.fixedDocument.blocks[0];
    if (!action || action.type !== 'action') throw new Error('expected action block');
    expect(action.label).toBe('Continue');
    expect(out.changes.some((c) => c.includes('Continue'))).toBe(true);
  });

  it('produces an empty changes array on a clean fixture', () => {
    const out = docSuggestFixes({ document: welcome });
    expect(out.changes).toEqual([]);
  });
});
