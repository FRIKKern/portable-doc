/**
 * validate.test.ts — exhaustive specs for the three rule classes:
 *
 *   1. prop-allowlist     — drop every leaked free-form style prop.
 *   2. content-constraint — code line ≤ 60, callout tone in 16-safe palette,
 *                            unique non-empty ids, length limits, image/table
 *                            surfaces locked to ['web','native'].
 *   3. url-safety         — http / https / mailto / tel only on every
 *                            href-bearing field.
 *
 * Tests inline-construct documents so they stand alone; T3 fixtures aren't
 * in the tree yet.
 */

import { describe, expect, it } from 'vitest';
import { validateDoc } from './validate.js';
import type {
  ActionBlock,
  Block,
  CalloutBlock,
  CodeBlock,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  PortableDoc,
  SectionBlock,
} from './ast.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function doc(blocks: Block[]): PortableDoc {
  return { version: 1, title: 'test', blocks };
}

function heading(id: string, text = 'Hello'): HeadingBlock {
  return { id, type: 'heading', level: 1, text };
}

function paragraph(id: string, text = 'p'): ParagraphBlock {
  return { id, type: 'paragraph', content: [{ type: 'text', value: text }] };
}

function callout(id: string, tone: CalloutBlock['tone'] = 'info'): CalloutBlock {
  return { id, type: 'callout', tone, content: [{ type: 'text', value: 'msg' }] };
}

function action(id: string, href = 'https://x.com', label = 'Click'): ActionBlock {
  return { id, type: 'action', label, href, priority: 'primary' };
}

function code(id: string, value: string): CodeBlock {
  return { id, type: 'code', value };
}

function list(id: string, items: string[]): ListBlock {
  return {
    id,
    type: 'list',
    items: items.map((s) => [{ type: 'text', value: s }]),
  };
}

function image(id: string, src = 'https://x/y.png'): ImageBlock {
  return { id, type: 'image', src, alt: 'a', surfaces: ['web', 'native'] };
}

function section(id: string, blocks: Block[]): SectionBlock {
  return { id, type: 'section', blocks };
}

function hasRule(issues: ReturnType<typeof validateDoc>, rule: string): boolean {
  return issues.some((i) => i.rule === rule);
}

// ---------------------------------------------------------------------------
// Rule 1 — prop-allowlist (drop every leaked free-form style prop)
// ---------------------------------------------------------------------------

describe('rule: prop-allowlist', () => {
  const forbiddenStyleProps: Array<[string, unknown]> = [
    ['borderRadius', 8],
    ['opacity', 0.5],
    ['boxShadow', '0 1px 2px black'],
    ['transform', 'translateY(-2px)'],
    ['animation', 'fade 1s'],
    ['gradient', 'linear-gradient(red, blue)'],
    ['flex', '1 1 auto'],
    ['flexWrap', 'wrap'],
    ['alignSelf', 'center'],
  ];

  for (const [prop, value] of forbiddenStyleProps) {
    it(`rejects "${prop}" injected onto a heading`, () => {
      const h = { ...heading('h'), [prop]: value } as unknown as HeadingBlock;
      const issues = validateDoc(doc([h]));
      const propIssues = issues.filter((i) => i.rule === 'prop-allowlist');
      expect(propIssues.length).toBeGreaterThan(0);
      expect(propIssues[0]!.message).toContain(prop);
    });
  }

  it("rejects justifyContent: 'space-between' specifically", () => {
    const h = { ...heading('h'), justifyContent: 'space-between' } as unknown as HeadingBlock;
    const issues = validateDoc(doc([h]));
    const propIssues = issues.filter((i) => i.rule === 'prop-allowlist');
    expect(propIssues.length).toBeGreaterThan(0);
    expect(propIssues[0]!.message).toContain('space-between');
  });

  it('flags leaked props on blocks nested inside a section', () => {
    const inner = { ...heading('h-inner', 'inner'), boxShadow: '0 0 0 black' } as unknown as HeadingBlock;
    const issues = validateDoc(doc([section('sec', [inner])]));
    expect(hasRule(issues, 'prop-allowlist')).toBe(true);
  });

  it('does not flag a clean intersection-safe document', () => {
    const issues = validateDoc(doc([heading('h'), paragraph('p'), action('a')]));
    expect(hasRule(issues, 'prop-allowlist')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — content constraints
// ---------------------------------------------------------------------------

describe('rule: content-constraint — code line ≤ 60 cols', () => {
  it('rejects a code block whose line is 61 cols', () => {
    const line = 'a'.repeat(61);
    const issues = validateDoc(doc([code('c', line)]));
    const m = issues.filter((i) => i.rule === 'content-constraint');
    expect(m.length).toBeGreaterThan(0);
    expect(m[0]!.message).toMatch(/61 cols/);
  });

  it('accepts a code block whose line is 60 cols', () => {
    const line = 'a'.repeat(60);
    const issues = validateDoc(doc([code('c', line)]));
    expect(hasRule(issues, 'content-constraint')).toBe(false);
  });

  it('reports each over-long code line individually', () => {
    const value = ['ok', 'a'.repeat(61), 'b'.repeat(70)].join('\n');
    const issues = validateDoc(doc([code('c', value)]));
    const codeIssues = issues.filter(
      (i) => i.rule === 'content-constraint' && /code line/.test(i.message),
    );
    expect(codeIssues).toHaveLength(2);
  });
});

describe('rule: content-constraint — callout tone in 16-safe palette', () => {
  it("rejects tone 'rainbow'", () => {
    const c = { ...callout('c'), tone: 'rainbow' as unknown as 'info' };
    const issues = validateDoc(doc([c]));
    expect(hasRule(issues, 'content-constraint')).toBe(true);
  });

  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral'] as const) {
    it(`accepts tone "${tone}"`, () => {
      const issues = validateDoc(doc([callout(`c-${tone}`, tone)]));
      const palette = issues.filter(
        (i) => i.rule === 'content-constraint' && /palette|tone/.test(i.message),
      );
      expect(palette).toHaveLength(0);
    });
  }
});

describe('rule: content-constraint — block ids', () => {
  it('rejects duplicate ids across two blocks', () => {
    const issues = validateDoc(doc([heading('same'), paragraph('same')]));
    const dup = issues.filter(
      (i) => i.rule === 'content-constraint' && /duplicate/.test(i.message),
    );
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toContain('same');
  });

  it('rejects an empty id', () => {
    const issues = validateDoc(doc([heading('')]));
    const empty = issues.filter(
      (i) =>
        i.rule === 'content-constraint' &&
        /id must be a non-empty string/.test(i.message),
    );
    expect(empty.length).toBeGreaterThan(0);
  });
});

describe('rule: content-constraint — heading.text length', () => {
  it('rejects heading.text at 81 chars', () => {
    const issues = validateDoc(doc([heading('h', 'x'.repeat(81))]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /heading\.text/.test(i.message));
    expect(m.length).toBeGreaterThan(0);
  });

  it('accepts heading.text at 80 chars', () => {
    const issues = validateDoc(doc([heading('h', 'x'.repeat(80))]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /heading\.text/.test(i.message));
    expect(m).toHaveLength(0);
  });
});

describe('rule: content-constraint — action.label length', () => {
  it('rejects an empty action.label', () => {
    const issues = validateDoc(doc([action('a', 'https://x', '')]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /action\.label/.test(i.message));
    expect(m.length).toBeGreaterThan(0);
  });

  it('rejects action.label > 48 chars', () => {
    const issues = validateDoc(doc([action('a', 'https://x', 'L'.repeat(49))]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /action\.label/.test(i.message));
    expect(m.length).toBeGreaterThan(0);
  });

  it('accepts action.label at 48 chars', () => {
    const issues = validateDoc(doc([action('a', 'https://x', 'L'.repeat(48))]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /action\.label/.test(i.message));
    expect(m).toHaveLength(0);
  });
});

describe("rule: content-constraint — image surfaces locked to ['web','native']", () => {
  it('rejects an image without surfaces ["web","native"]', () => {
    const img = { ...image('i'), surfaces: ['web'] as unknown as ['web', 'native'] };
    const issues = validateDoc(doc([img]));
    // Schema-level rejection lands as a content-constraint issue.
    expect(hasRule(issues, 'content-constraint')).toBe(true);
  });

  it('accepts a properly declared image', () => {
    const issues = validateDoc(doc([image('i')]));
    const m = issues.filter(
      (i) => i.rule === 'content-constraint' && /image|surfaces/.test(i.message),
    );
    expect(m).toHaveLength(0);
  });
});

describe('rule: content-constraint — list item length', () => {
  it('rejects a list item at 201 chars', () => {
    const issues = validateDoc(doc([list('l', ['x'.repeat(201)])]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /list item/.test(i.message));
    expect(m.length).toBeGreaterThan(0);
  });

  it('accepts a list item at 200 chars', () => {
    const issues = validateDoc(doc([list('l', ['x'.repeat(200)])]));
    const m = issues.filter((i) => i.rule === 'content-constraint' && /list item/.test(i.message));
    expect(m).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — URL safety
// ---------------------------------------------------------------------------

describe('rule: url-safety — link.href', () => {
  it('rejects javascript:', () => {
    const p: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'javascript:alert(1)',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    const issues = validateDoc(doc([p]));
    expect(hasRule(issues, 'url-safety')).toBe(true);
  });

  it('rejects data:text/html', () => {
    const p: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'data:text/html,<script>',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    expect(hasRule(validateDoc(doc([p])), 'url-safety')).toBe(true);
  });

  it('rejects file://', () => {
    const p: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'file:///etc/passwd',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    expect(hasRule(validateDoc(doc([p])), 'url-safety')).toBe(true);
  });

  it('accepts https://', () => {
    const p: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'https://example.com',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    expect(hasRule(validateDoc(doc([p])), 'url-safety')).toBe(false);
  });

  it('accepts mailto:', () => {
    const p: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'mailto:a@b.com',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    expect(hasRule(validateDoc(doc([p])), 'url-safety')).toBe(false);
  });

  it('accepts tel:', () => {
    const p: ParagraphBlock = {
      id: 'p',
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: 'tel:+15551234',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    expect(hasRule(validateDoc(doc([p])), 'url-safety')).toBe(false);
  });
});

describe('rule: url-safety — action.href', () => {
  it('rejects javascript:', () => {
    expect(hasRule(validateDoc(doc([action('a', 'javascript:alert(1)')])), 'url-safety')).toBe(true);
  });
  it('rejects data:', () => {
    expect(hasRule(validateDoc(doc([action('a', 'data:text/html,x')])), 'url-safety')).toBe(true);
  });
  it('accepts https:', () => {
    expect(hasRule(validateDoc(doc([action('a', 'https://x.com')])), 'url-safety')).toBe(false);
  });
});

describe('rule: url-safety — image.src', () => {
  it('rejects file://', () => {
    expect(hasRule(validateDoc(doc([image('i', 'file:///x.png')])), 'url-safety')).toBe(true);
  });
  it('accepts https:', () => {
    expect(hasRule(validateDoc(doc([image('i', 'https://x/y.png')])), 'url-safety')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rule 4 — variant-allowlist
// ---------------------------------------------------------------------------

describe('rule: variant-allowlist', () => {
  function variantIssues(d: PortableDoc) {
    return validateDoc(d).filter((i) => i.rule === 'variant-allowlist');
  }

  it('accepts a valid callout variant {tone, emphasis}', () => {
    const c: CalloutBlock = {
      ...callout('c'),
      variant: { tone: 'success', emphasis: 'bold' },
    };
    expect(variantIssues(doc([c]))).toHaveLength(0);
  });

  it('accepts a valid action variant {priority, size}', () => {
    const a: ActionBlock = {
      ...action('a'),
      variant: { priority: 'primary', size: 'medium' },
    };
    expect(variantIssues(doc([a]))).toHaveLength(0);
  });

  it('accepts a valid section variant {density}', () => {
    const s: SectionBlock = {
      ...section('s', [paragraph('s-p')]),
      variant: { density: 'compact' },
    };
    expect(variantIssues(doc([s]))).toHaveLength(0);
  });

  it("rejects an unknown axis on callout ({flavor: 'spicy'})", () => {
    const c: CalloutBlock = {
      ...callout('c'),
      variant: { flavor: 'spicy' },
    };
    const v = variantIssues(doc([c]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toMatch(/unknown variant axis 'flavor' on 'callout'/);
    expect(v[0]!.blockId).toBe('c');
  });

  it("rejects an unknown value within a known axis on callout (tone: 'rainbow')", () => {
    // Use a valid tone field on the block itself so content-constraint stays
    // clean — only the variant.tone value is invalid.
    const c: CalloutBlock = {
      ...callout('c', 'info'),
      variant: { tone: 'rainbow', emphasis: 'bold' },
    };
    const v = variantIssues(doc([c]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toMatch(/unknown variant value 'rainbow' for axis 'tone' on 'callout'/);
  });

  it('rejects a variant on a no-catalog block (heading)', () => {
    const h = { ...heading('h'), variant: { level: 'h1' } } as unknown as HeadingBlock;
    const v = variantIssues(doc([h]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toMatch(/heading.*does not accept variants/);
    expect(v[0]!.blockId).toBe('h');
  });

  it('rejects a variant on a no-catalog block (paragraph)', () => {
    const p = { ...paragraph('p'), variant: { weight: 'bold' } } as unknown as ParagraphBlock;
    const v = variantIssues(doc([p]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toMatch(/paragraph.*does not accept variants/);
  });

  it('rejects a variant on a no-catalog block (image)', () => {
    const img = { ...image('i'), variant: { fit: 'cover' } } as unknown as ImageBlock;
    const v = variantIssues(doc([img]));
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toMatch(/image.*does not accept variants/);
  });

  it('produces 0 variant issues for a block with no variant field', () => {
    expect(variantIssues(doc([heading('h'), paragraph('p'), callout('c')]))).toHaveLength(0);
  });

  it('produces 0 variant issues for a block with variant: {} (empty)', () => {
    const c: CalloutBlock = { ...callout('c'), variant: {} };
    const h: HeadingBlock = { ...heading('h'), variant: {} };
    expect(variantIssues(doc([c, h]))).toHaveLength(0);
  });

  it('flags exactly the one invalid variant in a multi-block doc', () => {
    const good: CalloutBlock = {
      ...callout('good'),
      variant: { tone: 'info', emphasis: 'subtle' },
    };
    const bad: ActionBlock = {
      ...action('bad'),
      variant: { priority: 'primary', size: 'enormous' },
    };
    const v = variantIssues(doc([heading('h'), good, bad, paragraph('p')]));
    expect(v).toHaveLength(1);
    expect(v[0]!.blockId).toBe('bad');
    expect(v[0]!.message).toMatch(/unknown variant value 'enormous' for axis 'size' on 'action'/);
  });

  it('walks into sections and flags an invalid variant on a nested block', () => {
    const innerBad: CalloutBlock = {
      ...callout('inner'),
      variant: { tone: 'success', emphasis: 'screaming' },
    };
    const v = variantIssues(doc([section('sec', [innerBad])]));
    expect(v).toHaveLength(1);
    expect(v[0]!.blockId).toBe('inner');
  });
});

describe('end-to-end', () => {
  it('returns 0 issues for a valid welcome-shaped doc', () => {
    const d: PortableDoc = doc([
      heading('welcome-h', 'Welcome'),
      paragraph('intro', 'Hello there'),
      callout('cta', 'info'),
      action('go', 'https://example.com', 'Continue'),
    ]);
    expect(validateDoc(d)).toEqual([]);
  });

  it('returns exactly three issues — one per rule class — for a doc with one error of each kind', () => {
    const badProp = { ...heading('h'), borderRadius: 8 } as unknown as HeadingBlock;
    const badContent = code('c', 'x'.repeat(61));
    const badUrl = action('a', 'javascript:alert(1)');
    const issues = validateDoc(doc([badProp, badContent, badUrl]));

    expect(issues.filter((i) => i.rule === 'prop-allowlist')).toHaveLength(1);
    expect(issues.filter((i) => i.rule === 'content-constraint')).toHaveLength(1);
    expect(issues.filter((i) => i.rule === 'url-safety')).toHaveLength(1);
    expect(issues).toHaveLength(3);
  });

  it('returns issues (does not throw) for a malformed input', () => {
    const issues = validateDoc({ version: 1, blocks: [{ what: 'is this' }] });
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });
});
