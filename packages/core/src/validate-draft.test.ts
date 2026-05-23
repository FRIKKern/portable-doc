/**
 * validate-draft.test.ts — specs for U2: draft-validation mode + validateBlock.
 *
 * Draft mode relaxes ONLY the last top-level block's missing-required fields
 * to warnings and never early-returns, so the per-block walkers still run.
 * Every earlier block stays HARD; prop-allowlist / url-safety /
 * content-constraint / variant-allowlist stay HARD even on the draft block.
 *
 * validateBlock runs the four per-block walkers against a single block.
 */

import { describe, expect, it } from 'vitest';
import { validateDoc, validateBlock } from './validate.js';
import type {
  ActionBlock,
  Block,
  CalloutBlock,
  HeadingBlock,
  ParagraphBlock,
  PortableDoc,
} from './ast.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function doc(blocks: unknown[]): PortableDoc {
  return { version: 1, title: 'test', blocks: blocks as Block[] };
}

function heading(id: string, text = 'Hello'): HeadingBlock {
  return { id, type: 'heading', level: 1, text };
}

function paragraph(id: string, text = 'p'): ParagraphBlock {
  return { id, type: 'paragraph', content: [{ type: 'text', value: text }] };
}

function action(id: string, href = 'https://x.com', label = 'Click'): ActionBlock {
  return { id, type: 'action', label, href, priority: 'primary' };
}

// A heading missing its required `text` field — invalid shape.
const incompleteHeading = { id: 'incomplete', type: 'heading', level: 1 };

// An action missing label/href/priority — invalid shape.
const incompleteAction = { id: 'inc-action', type: 'action' };

function shapeIssues(issues: ReturnType<typeof validateDoc>) {
  return issues.filter((i) => i.rule === 'content-constraint' && /blocks\.\d+\./.test(i.message));
}

// ---------------------------------------------------------------------------
// Draft mode — trailing incomplete block warns
// ---------------------------------------------------------------------------

describe('draft mode: trailing incomplete block', () => {
  it('warns (does not error) on a missing required field in the LAST block', () => {
    const issues = validateDoc(doc([heading('h'), paragraph('p'), incompleteHeading]), {
      mode: 'draft',
    });
    const shape = shapeIssues(issues);
    expect(shape.length).toBeGreaterThan(0);
    expect(shape.every((i) => i.severity === 'warning')).toBe(true);
    // No errors from the missing-field shape parse.
    expect(shape.some((i) => i.severity === 'error')).toBe(false);
  });

  it('does not early-return — walkers still run on every block in draft', () => {
    // A clean leading block + an injected prop-leak on a MIDDLE block must
    // still be caught, proving the walker pass executed despite the trailing
    // incomplete block.
    const leaky = { ...heading('leaky'), boxShadow: '0 0 0 red' } as unknown as HeadingBlock;
    const issues = validateDoc(doc([leaky, incompleteHeading]), { mode: 'draft' });
    expect(issues.some((i) => i.rule === 'prop-allowlist')).toBe(true);
  });

  it('a fully-valid draft doc produces no errors and no warnings', () => {
    const issues = validateDoc(doc([heading('h'), paragraph('p'), action('a')]), {
      mode: 'draft',
    });
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Draft mode — non-trailing incomplete block stays HARD
// ---------------------------------------------------------------------------

describe('draft mode: non-trailing incomplete block', () => {
  it('errors on a missing required field in an EARLIER block', () => {
    const issues = validateDoc(doc([incompleteHeading, heading('h')]), { mode: 'draft' });
    const shape = shapeIssues(issues);
    expect(shape.length).toBeGreaterThan(0);
    expect(shape.some((i) => i.severity === 'error')).toBe(true);
  });

  it('errors on the earlier incomplete block while warning on the trailing one', () => {
    const issues = validateDoc(doc([incompleteAction, incompleteHeading]), { mode: 'draft' });
    const earlier = shapeIssues(issues).filter((i) => /blocks\.0\./.test(i.message));
    const trailing = shapeIssues(issues).filter((i) => /blocks\.1\./.test(i.message));
    expect(earlier.length).toBeGreaterThan(0);
    expect(earlier.every((i) => i.severity === 'error')).toBe(true);
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing.every((i) => i.severity === 'warning')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Draft mode — the four walkers stay HARD even on the trailing block
// ---------------------------------------------------------------------------

describe('draft mode: per-block rules stay HARD on the trailing block', () => {
  it('errors on a prop-leak in the trailing draft block', () => {
    const leaky = { ...heading('leaky'), opacity: 0.5 } as unknown as HeadingBlock;
    const issues = validateDoc(doc([heading('h'), leaky]), { mode: 'draft' });
    const propIssues = issues.filter((i) => i.rule === 'prop-allowlist');
    expect(propIssues.length).toBeGreaterThan(0);
    expect(propIssues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('errors on a bad URL in the trailing draft block', () => {
    const issues = validateDoc(doc([heading('h'), action('a', 'javascript:alert(1)')]), {
      mode: 'draft',
    });
    const urlIssues = issues.filter((i) => i.rule === 'url-safety');
    expect(urlIssues.length).toBeGreaterThan(0);
    expect(urlIssues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('errors on a content-constraint violation in the trailing draft block', () => {
    // callout with a bad tone — content-constraint walker, stays HARD.
    const badTone = { id: 'c', type: 'callout', tone: 'rainbow', content: [{ type: 'text', value: 'm' }] };
    const issues = validateDoc(doc([heading('h'), badTone]), { mode: 'draft' });
    const tone = issues.filter(
      (i) => i.rule === 'content-constraint' && /palette/.test(i.message),
    );
    expect(tone.length).toBeGreaterThan(0);
    expect(tone.every((i) => i.severity === 'error')).toBe(true);
  });

  it('errors on a bad variant in the trailing draft block', () => {
    const c = { ...({ id: 'c', type: 'callout', tone: 'info', content: [] } as CalloutBlock), variant: { flavor: 'spicy' } };
    const issues = validateDoc(doc([heading('h'), c]), { mode: 'draft' });
    const variant = issues.filter((i) => i.rule === 'variant-allowlist');
    expect(variant.length).toBeGreaterThan(0);
    expect(variant.every((i) => i.severity === 'error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateBlock — single-block walker pass
// ---------------------------------------------------------------------------

describe('validateBlock', () => {
  it('flags a prop-leak on one block', () => {
    const leaky = { ...heading('h'), borderRadius: 8 } as unknown as HeadingBlock;
    const issues = validateBlock(leaky);
    expect(issues.some((i) => i.rule === 'prop-allowlist')).toBe(true);
  });

  it('flags a bad URL on one block', () => {
    const issues = validateBlock(action('a', 'data:text/html,x'));
    expect(issues.some((i) => i.rule === 'url-safety')).toBe(true);
  });

  it('returns no issues for a clean block', () => {
    expect(validateBlock(heading('h'))).toEqual([]);
    expect(validateBlock(action('a'))).toEqual([]);
  });

  it('uses a fresh seenIds map per call (no duplicate-id false positive across calls)', () => {
    expect(validateBlock(heading('same'))).toEqual([]);
    expect(validateBlock(paragraph('same'))).toEqual([]);
  });

  it('accepts an optional opts arg without changing the walker outcome', () => {
    const leaky = { ...heading('h'), transform: 'translateY(-2px)' } as unknown as HeadingBlock;
    const a = validateBlock(leaky);
    const b = validateBlock(leaky, { mode: 'draft' });
    expect(a).toEqual(b);
    expect(a.some((i) => i.rule === 'prop-allowlist')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Strict-mode parity — default arg matches pre-U2 behavior
// ---------------------------------------------------------------------------

describe('strict-mode parity (default behavior unchanged)', () => {
  it('default (no opts) early-returns shape errors as errors, just like before', () => {
    const issues = validateDoc({ version: 1, blocks: [{ what: 'is this' }] });
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('explicit {mode:"strict"} equals the default no-opts result', () => {
    const d = doc([heading('h'), paragraph('p'), action('a')]);
    expect(validateDoc(d, { mode: 'strict' })).toEqual(validateDoc(d));
  });

  it('strict mode still errors (not warns) on a trailing incomplete block', () => {
    const issues = validateDoc(doc([heading('h'), incompleteHeading]), { mode: 'strict' });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('strict mode on a clean doc returns []', () => {
    expect(validateDoc(doc([heading('h'), paragraph('p'), action('a')]), { mode: 'strict' })).toEqual(
      [],
    );
  });
});
