import { describe, expect, it } from 'vitest';
import { defaultTokens } from '@portable-doc/core';
import { composeDocument } from '@portable-doc/primitives';
import type {
  PdBoxNode,
  PdButtonNode,
  PdCalloutNode,
  PdContainerNode,
  PdHrNode,
  PdImageNode,
  PdInlineCodeNode,
  PdLinkNode,
  PdNode,
  PdTableNode,
  PdTextNode,
} from '@portable-doc/primitives';
import { welcome } from '@portable-doc/fixtures';
import { toRn } from './translate.js';
import type { RnNode, RnPressable, RnText, RnView } from './shape.js';

// ---------------------------------------------------------------------------
// 1. Per-Pd-primitive snapshot tests
// ---------------------------------------------------------------------------

describe('toRn — per-primitive snapshots', () => {
  it('PdBox → RnView with mapped style', () => {
    const node: PdBoxNode = {
      kind: 'PdBox',
      style: {
        flexDirection: 'row',
        padding: 8,
        borderStyle: 'bold',
        borderColor: '#000',
        verticalAlign: 'middle',
      },
      children: [{ kind: 'PdText', children: ['hi'] }],
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdText → RnText with weight/italic/underline/strike', () => {
    const node: PdTextNode = {
      kind: 'PdText',
      weight: 'bold',
      italic: true,
      underline: true,
      strike: true,
      color: '#111',
      children: ['hello'],
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdLink → RnPressable wrapping RnText', () => {
    const node: PdLinkNode = {
      kind: 'PdLink',
      href: 'https://example.com',
      children: [{ kind: 'PdText', children: ['docs'] }],
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdInlineCode → RnText with monospace fontFamily', () => {
    const node: PdInlineCodeNode = { kind: 'PdInlineCode', value: 'x' };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdButton primary → RnPressable with branded inner View', () => {
    const node: PdButtonNode = {
      kind: 'PdButton',
      href: 'https://example.com/a',
      label: 'Go',
      priority: 'primary',
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdHr → thin RnView', () => {
    const node: PdHrNode = { kind: 'PdHr', thickness: 2 };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdContainer → RnView with width + center alignment', () => {
    const node: PdContainerNode = {
      kind: 'PdContainer',
      maxWidth: 480,
      children: [{ kind: 'PdText', children: ['body'] }],
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdImage → RnImage with source uri + accessibilityLabel', () => {
    const node: PdImageNode = {
      kind: 'PdImage',
      src: 'https://example.com/img.png',
      alt: 'logo',
      width: 120,
      height: 40,
      surfaces: ['web', 'native'],
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdTable → RnView columns of row Views of cell Views', () => {
    const node: PdTableNode = {
      kind: 'PdTable',
      rows: [
        [
          [{ kind: 'PdText', children: ['a'] }],
          [{ kind: 'PdText', children: ['b'] }],
        ],
      ],
      surfaces: ['web', 'native'],
    };
    expect(toRn(node)).toMatchSnapshot();
  });

  it('PdCallout → RnView with tone-coloured borderLeft', () => {
    const node: PdCalloutNode = {
      kind: 'PdCallout',
      tone: 'success',
      title: 'Done',
      children: [{ kind: 'PdText', children: ['ok'] }],
    };
    expect(toRn(node)).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// 2. End-to-end via composeDocument
// ---------------------------------------------------------------------------

describe('toRn — end-to-end composeDocument', () => {
  it('translates the welcome fixture through the shim', () => {
    const tree = toRn(composeDocument(welcome));
    expect(tree).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// 3. Tone color resolved from defaultTokens
// ---------------------------------------------------------------------------

describe('toRn — callout tone resolution', () => {
  it('borderColor matches defaultTokens.color.tone[tone].fg', () => {
    const node: PdCalloutNode = {
      kind: 'PdCallout',
      tone: 'success',
      children: [{ kind: 'PdText', children: ['ok'] }],
    };
    const out = toRn(node) as RnView;
    expect(out.style?.borderColor).toBe(defaultTokens.color.tone.success.fg);
    expect(out.style?.backgroundColor).toBe(defaultTokens.color.tone.success.bg);
  });
});

// ---------------------------------------------------------------------------
// 4. Button priority differentiation
// ---------------------------------------------------------------------------

describe('toRn — button priority differentiation', () => {
  it('primary vs secondary produce different inner View styles', () => {
    const primary = toRn({
      kind: 'PdButton',
      href: 'h',
      label: 'A',
      priority: 'primary',
    }) as RnPressable;
    const secondary = toRn({
      kind: 'PdButton',
      href: 'h',
      label: 'B',
      priority: 'secondary',
    }) as RnPressable;
    const pInner = primary.children[0] as RnView;
    const sInner = secondary.children[0] as RnView;
    expect(pInner.style?.backgroundColor).toBe(defaultTokens.color.brand);
    expect(pInner.style?.backgroundColor).not.toEqual(sInner.style?.backgroundColor);
    expect(sInner.style?.borderWidth).toBe(1);
    expect(pInner.style?.borderWidth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Image surfaces are NOT propagated onto RnImage
// ---------------------------------------------------------------------------

describe('toRn — image surfaces dropped', () => {
  it('does not carry the surfaces tuple onto RnImage', () => {
    const node: PdImageNode = {
      kind: 'PdImage',
      src: 'x',
      alt: 'a',
      surfaces: ['web', 'native'],
    };
    const out = toRn(node);
    expect('surfaces' in out).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Exhaustiveness — assertNever throws on unknown kind
// ---------------------------------------------------------------------------

describe('toRn — exhaustiveness guard', () => {
  it('throws on a fake unknown Pd kind', () => {
    const fake = { kind: 'PdUnknown' } as unknown as PdNode;
    expect(() => toRn(fake)).toThrow(/unhandled/);
  });
});

// ---------------------------------------------------------------------------
// 7. Inline link → Pressable+Text(underline)
// ---------------------------------------------------------------------------

describe('toRn — inline link shape', () => {
  it('emits RnPressable(role:link) wrapping an underlined RnText', () => {
    const link: PdLinkNode = {
      kind: 'PdLink',
      href: 'https://example.com',
      children: [{ kind: 'PdText', children: ['go'] }],
    };
    const out = toRn(link) as RnPressable;
    expect(out.component).toBe('Pressable');
    expect(out.accessibilityRole).toBe('link');
    expect(out.href).toBe('https://example.com');
    const inner = out.children[0] as RnText;
    expect(inner.component).toBe('Text');
    expect(inner.style?.textDecorationLine).toBe('underline');
  });
});

// ---------------------------------------------------------------------------
// 8. Determinism
// ---------------------------------------------------------------------------

describe('toRn — determinism', () => {
  it('image translated twice is deeply equal', () => {
    const node: PdImageNode = {
      kind: 'PdImage',
      src: 'x',
      alt: 'a',
      width: 10,
      height: 10,
      surfaces: ['web', 'native'],
    };
    expect(toRn(node)).toEqual(toRn(node));
  });

  it('full welcome tree translated twice is deeply equal', () => {
    const a = toRn(composeDocument(welcome));
    const b = toRn(composeDocument(welcome));
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Extra: PdBox border-style + verticalAlign mapping
// ---------------------------------------------------------------------------

describe('toRn — PdBox style mapping', () => {
  it("maps borderStyle 'double' → 'dashed' and 'bold' → 'solid' w/ thicker borderWidth", () => {
    const dbl = toRn({
      kind: 'PdBox',
      style: { borderStyle: 'double' },
      children: [],
    }) as RnView;
    const bold = toRn({
      kind: 'PdBox',
      style: { borderStyle: 'bold' },
      children: [],
    }) as RnView;
    expect(dbl.style?.borderStyle).toBe('dashed');
    expect(bold.style?.borderStyle).toBe('solid');
    expect(bold.style?.borderWidth).toBe(2);
  });

  it("maps verticalAlign 'middle' → alignItems 'center'", () => {
    const out = toRn({
      kind: 'PdBox',
      style: { verticalAlign: 'middle' },
      children: [],
    }) as RnView;
    expect(out.style?.alignItems).toBe('center');
  });
});

// ---------------------------------------------------------------------------
// Extra: every output is a plain JS data tree (no functions, no symbols)
// ---------------------------------------------------------------------------

describe('toRn — output is plain data', () => {
  it('contains only objects, arrays, strings, numbers (no functions)', () => {
    const tree: RnNode = toRn(composeDocument(welcome));
    const stack: unknown[] = [tree];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === null || cur === undefined) continue;
      const t = typeof cur;
      expect(['string', 'number', 'boolean', 'object']).toContain(t);
      expect(t).not.toBe('function');
      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item);
      } else if (t === 'object') {
        for (const v of Object.values(cur as Record<string, unknown>)) stack.push(v);
      }
    }
  });
});
