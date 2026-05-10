import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActionBlock,
  Block,
  CalloutBlock,
  CodeBlock,
  HeadingBlock,
  ImageBlock,
  InlineNode,
  ListBlock,
  ParagraphBlock,
  PortableDoc,
  SectionBlock,
} from '@portable-doc/core';
import { composeDocument } from './kernel.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const welcome = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'welcome.json'), 'utf8'),
) as PortableDoc;
const incident = JSON.parse(
  readFileSync(resolve(repoRoot, 'examples', 'incident.json'), 'utf8'),
) as PortableDoc;
import type {
  PdBoxNode,
  PdButtonNode,
  PdCalloutNode,
  PdContainerNode,
  PdImageNode,
  PdInlineCodeNode,
  PdLinkNode,
  PdNode,
  PdTextNode,
} from './pd.js';

function wrap(blocks: Block[]): PortableDoc {
  return { version: 1, blocks };
}

function isText(node: PdNode | string): node is PdTextNode {
  return typeof node !== 'string' && node.kind === 'PdText';
}

function isBox(node: PdNode | string): node is PdBoxNode {
  return typeof node !== 'string' && node.kind === 'PdBox';
}

describe('composeDocument — fixtures snapshot', () => {
  it('matches welcome fixture snapshot', () => {
    const tree = composeDocument(welcome);
    expect(tree).toMatchSnapshot();
  });

  it('matches incident fixture snapshot', () => {
    const tree = composeDocument(incident);
    expect(tree).toMatchSnapshot();
  });
});

describe('composeDocument — invariants', () => {
  it('is deterministic across calls', () => {
    const a = composeDocument(welcome);
    const b = composeDocument(welcome);
    expect(a).toEqual(b);
  });

  it('returns a top-level PdContainer with one child per non-section block', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'h',
        type: 'heading',
        level: 1,
        text: 'Hi',
      } satisfies HeadingBlock,
      {
        id: 'p',
        type: 'paragraph',
        content: [{ type: 'text', value: 'body' }],
      } satisfies ParagraphBlock,
      { id: 'd', type: 'divider' },
    ]);
    const tree = composeDocument(doc);
    expect(tree.kind).toBe('PdContainer');
    expect(tree.children).toHaveLength(3);
  });
});

describe('composeDocument — heading', () => {
  it('emits a bold PdText for a heading block', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'h',
        type: 'heading',
        level: 2,
        text: 'Title',
      } satisfies HeadingBlock,
    ]);
    const [head] = composeDocument(doc).children;
    expect(head).toBeDefined();
    if (!head || !isText(head)) throw new Error('expected PdText');
    expect(head.weight).toBe('bold');
    expect(head.children).toEqual(['Title']);
  });
});

describe('composeDocument — paragraph inline walker', () => {
  it('maps strong/em/link/code inline nodes to their Pd kinds', () => {
    const inline: InlineNode[] = [
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'em', children: [{ type: 'text', value: 'italic' }] },
      {
        type: 'link',
        href: 'https://example.com',
        children: [{ type: 'text', value: 'docs' }],
      },
      { type: 'code', value: 'x' },
    ];
    const doc: PortableDoc = wrap([
      {
        id: 'p',
        type: 'paragraph',
        content: inline,
      } satisfies ParagraphBlock,
    ]);
    const [para] = composeDocument(doc).children;
    if (!para || !isText(para)) throw new Error('expected PdText');
    expect(para.children).toHaveLength(4);
    const [strong, em, link, code] = para.children;
    expect(typeof strong === 'object' && strong && 'kind' in strong && strong.kind === 'PdText').toBe(true);
    if (typeof strong !== 'object' || !('kind' in strong) || strong.kind !== 'PdText') throw new Error('strong');
    expect(strong.weight).toBe('bold');
    if (typeof em !== 'object' || !('kind' in em) || em.kind !== 'PdText') throw new Error('em');
    expect(em.italic).toBe(true);
    expect(typeof link === 'object' && link && 'kind' in link && link.kind === 'PdLink').toBe(true);
    expect(typeof code === 'object' && code && 'kind' in code && code.kind === 'PdInlineCode').toBe(true);
  });
});

describe('composeDocument — list', () => {
  it('emits ordered-list "1. ", "2. " prefixes', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'l',
        type: 'list',
        ordered: true,
        items: [
          [{ type: 'text', value: 'first' }],
          [{ type: 'text', value: 'second' }],
        ],
      } satisfies ListBlock,
    ]);
    const [list] = composeDocument(doc).children;
    if (!list || !isBox(list)) throw new Error('expected PdBox');
    expect(list.children).toHaveLength(2);
    const [row1, row2] = list.children as PdBoxNode[];
    if (!row1 || !row2) throw new Error('rows missing');
    const prefix1 = (row1.children[0] as PdTextNode).children[0];
    const prefix2 = (row2.children[0] as PdTextNode).children[0];
    expect(prefix1).toBe('1. ');
    expect(prefix2).toBe('2. ');
  });

  it('emits unordered-list "• " prefix', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'l',
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', value: 'a' }]],
      } satisfies ListBlock,
    ]);
    const [list] = composeDocument(doc).children;
    if (!list || !isBox(list)) throw new Error('expected PdBox');
    const row = list.children[0] as PdBoxNode;
    expect((row.children[0] as PdTextNode).children[0]).toBe('• ');
  });
});

describe('composeDocument — callout', () => {
  it('produces PdCallout (semantic node, not a raw PdBox)', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'c',
        type: 'callout',
        tone: 'warning',
        title: 'Heads up',
        content: [{ type: 'text', value: 'careful' }],
      } satisfies CalloutBlock,
    ]);
    const [callout] = composeDocument(doc).children;
    expect(callout).toBeDefined();
    if (!callout || typeof callout === 'string') throw new Error('node');
    expect(callout.kind).toBe('PdCallout');
    const c = callout as PdCalloutNode;
    expect(c.tone).toBe('warning');
    expect(c.title).toBe('Heads up');
  });
});

describe('composeDocument — action', () => {
  it('preserves primary vs secondary priority on PdButton', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'a1',
        type: 'action',
        label: 'Go',
        href: 'https://example.com/a',
        priority: 'primary',
      } satisfies ActionBlock,
      {
        id: 'a2',
        type: 'action',
        label: 'Later',
        href: 'https://example.com/b',
        priority: 'secondary',
      } satisfies ActionBlock,
    ]);
    const [a, b] = composeDocument(doc).children as PdButtonNode[];
    if (!a || !b) throw new Error('buttons');
    expect(a.kind).toBe('PdButton');
    expect(a.priority).toBe('primary');
    expect(b.priority).toBe('secondary');
  });
});

describe('composeDocument — section', () => {
  it('recurses inner blocks into a PdBox column with bracketing PdHr', () => {
    const doc: PortableDoc = wrap([
      {
        id: 's',
        type: 'section',
        title: 'Inner',
        blocks: [
          {
            id: 'inner-p',
            type: 'paragraph',
            content: [{ type: 'text', value: 'hello' }],
          },
        ],
      } satisfies SectionBlock,
    ]);
    const [section] = composeDocument(doc).children;
    if (!section || !isBox(section)) throw new Error('expected PdBox');
    expect(section.children).toHaveLength(4); // hr, title, inner para, hr
    const [topHr, title, inner, bottomHr] = section.children;
    if (!topHr || typeof topHr === 'string') throw new Error('top hr');
    expect(topHr.kind).toBe('PdHr');
    if (!title || typeof title === 'string' || title.kind !== 'PdText') {
      throw new Error('title');
    }
    expect(title.weight).toBe('bold');
    if (!inner || typeof inner === 'string' || inner.kind !== 'PdText') {
      throw new Error('inner');
    }
    if (!bottomHr || typeof bottomHr === 'string') throw new Error('bottom hr');
    expect(bottomHr.kind).toBe('PdHr');
  });
});

describe('composeDocument — image', () => {
  it('keeps surfaces tuple intact on PdImage', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'img',
        type: 'image',
        src: 'https://example.com/img.png',
        alt: 'alt',
        surfaces: ['web', 'native'],
      } satisfies ImageBlock,
    ]);
    const [img] = composeDocument(doc).children;
    if (!img || typeof img === 'string') throw new Error('node');
    expect(img.kind).toBe('PdImage');
    expect((img as PdImageNode).surfaces).toEqual(['web', 'native']);
  });
});

describe('composeDocument — code', () => {
  it('emits one PdText per line (3 newlines → 4 PdText children)', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'cd',
        type: 'code',
        value: 'a\nb\nc\nd',
      } satisfies CodeBlock,
    ]);
    const [box] = composeDocument(doc).children;
    if (!box || !isBox(box)) throw new Error('expected PdBox');
    expect(box.children).toHaveLength(4);
    for (const line of box.children) {
      if (!isText(line)) throw new Error('line must be PdText');
      const inner = line.children[0];
      if (!inner || typeof inner === 'string' || inner.kind !== 'PdInlineCode') {
        throw new Error('inner must be PdInlineCode');
      }
    }
    const inner0 = ((box.children[0] as PdTextNode).children[0]) as PdInlineCodeNode;
    expect(inner0.value).toBe('a');
  });
});

describe('composeDocument — inline link flatten', () => {
  it('flattens a nested link inside a link to a plain PdText (no PdLink-in-PdLink)', () => {
    // Force a nested-link AST via cast — the validator would normally reject it.
    const inner: InlineNode = {
      type: 'link',
      href: 'https://example.com/inner',
      children: [{ type: 'text', value: 'inner' }],
    };
    const outer: InlineNode = {
      type: 'link',
      href: 'https://example.com/outer',
      children: [{ type: 'text', value: 'outer-' }, inner],
    };
    const doc: PortableDoc = wrap([
      {
        id: 'p',
        type: 'paragraph',
        content: [outer],
      } satisfies ParagraphBlock,
    ]);
    const [para] = composeDocument(doc).children;
    if (!para || !isText(para)) throw new Error('expected PdText');
    const [link] = para.children;
    if (!link || typeof link === 'string' || link.kind !== 'PdLink') {
      throw new Error('expected PdLink');
    }
    const linkNode = link as PdLinkNode;
    expect(linkNode.href).toBe('https://example.com/outer');
    // No PdLink should appear among link.children — nested link must be flattened.
    for (const child of linkNode.children) {
      if (typeof child === 'string') continue;
      // The wrapper type allows PdTextNode; recurse to assert no PdLink hidden inside.
      const stack: Array<unknown> = [child];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object' || !('kind' in cur)) continue;
        const k = (cur as { kind: string }).kind;
        expect(k).not.toBe('PdLink');
        if (k === 'PdText') {
          const tnode = cur as PdTextNode;
          for (const c of tnode.children) stack.push(c);
        }
      }
    }
  });
});

describe('composeDocument — paragraph inline links unwrapped', () => {
  it('emits a PdLink at top level of a paragraph that contains a single link', () => {
    const doc: PortableDoc = wrap([
      {
        id: 'p',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: 'https://example.com',
            children: [{ type: 'text', value: 'go' }],
          },
        ],
      } satisfies ParagraphBlock,
    ]);
    const [para] = composeDocument(doc).children;
    if (!para || !isText(para)) throw new Error('expected PdText');
    const [first] = para.children;
    if (!first || typeof first === 'string') throw new Error('expected PdLink');
    expect(first.kind).toBe('PdLink');
    expect((first as PdLinkNode).href).toBe('https://example.com');
  });
});
