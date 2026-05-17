/**
 * Forward seed: PortableDoc JSON → TipTap-shaped JSON content.
 *
 * Symmetric to `tiptap-to-portable-doc.ts`. The reverse pipeline walks
 * TipTap's `{type, attrs, content, text, marks}` shape and builds
 * PortableDoc `Block[]`; this module walks the same shape in the
 * forward direction, emitting the canonical TipTap `JSONContent`
 * tree that `useEditor({content})` and `editor.commands.setContent()`
 * accept directly — no HTML round-trip.
 *
 * Why JSON, not HTML
 * ------------------
 * The previous seed (`portable-doc-to-tiptap.ts`) emitted an HTML
 * string and let TipTap's HTML parser project it back into the
 * schema. HTML parsing is lossy:
 *   - attrs that don't have an HTML attribute analogue (e.g. our
 *     `variant: { tone, emphasis }` on blockquote) survive only if
 *     we serialize them as `data-*` AND the schema's parser recognises
 *     them. Easy to lose silently.
 *   - mark order on a text run is implicit in the nesting of inline
 *     HTML elements (`<strong><em>x</em></strong>` vs `<em><strong>x
 *     </strong></em>`) — the parser flattens both to a marks array,
 *     but the order depends on parser internals and isn't easy to
 *     pin to the order `tiptapToPortableDoc` produces on the reverse
 *     leg. Round-trip stability suffers.
 *
 * Emitting JSON directly eliminates both problems: every attr survives
 * verbatim, and the marks array is explicit so its order is exactly
 * what we wrote.
 *
 * Block coverage
 * --------------
 * Every block type the HTML seed covered has a matching emitter here:
 *   heading, paragraph, list, callout, action, section, divider, code,
 *   image, table.
 *
 * Inline marks compose into TipTap's flat-marks-on-text-run shape via
 * `inlineNodes`. The mark-array order matches the wrap order in
 * `tiptapToPortableDoc.wrapWithMarks` (outermost mark first → first in
 * array) so a `strong > em > text` PortableDoc subtree → text run with
 * `marks: [{type:'bold'}, {type:'italic'}]`, and `wrapWithMarks` will
 * recover the same nesting on the way back.
 */
import type {
  Block,
  InlineNode,
  PortableDoc,
} from '@portable-doc/core';
import type { JSONContent } from '@tiptap/core';

// ---------------------------------------------------------------------------
// Inline nodes → TipTap text runs (with marks)
// ---------------------------------------------------------------------------

interface MarkSpec {
  type: string;
  attrs?: Record<string, unknown>;
}

/**
 * Walk a PortableDoc inline subtree and emit TipTap text runs. Marks
 * accumulate as we descend into `strong`/`em`/`link` wrappers and land
 * on the text leaf as a flat array. `code` is a PortableDoc LEAF
 * (`{type:'code', value:string}`) — when we hit one we emit a text run
 * with a `code` mark.
 *
 * Mark-array order matches the wrap order in
 * `tiptapToPortableDoc.wrapWithMarks` (outer mark first → first in
 * array) so round-trips are stable.
 */
function walkInline(node: InlineNode, marks: MarkSpec[]): JSONContent[] {
  switch (node.type) {
    case 'text': {
      const out: JSONContent = { type: 'text', text: node.value };
      if (marks.length > 0) out.marks = marks.map((m) => ({ ...m }));
      return [out];
    }
    case 'strong': {
      const next = [...marks, { type: 'bold' }];
      return node.children.flatMap((c) => walkInline(c, next));
    }
    case 'em': {
      const next = [...marks, { type: 'italic' }];
      return node.children.flatMap((c) => walkInline(c, next));
    }
    case 'link': {
      const next = [...marks, { type: 'link', attrs: { href: node.href } }];
      return node.children.flatMap((c) => walkInline(c, next));
    }
    case 'code': {
      // Inline code is a leaf in PortableDoc — emit a text run carrying
      // a `code` mark in addition to whatever wrappers we're under.
      const next = [...marks, { type: 'code' }];
      const run: JSONContent = { type: 'text', text: node.value };
      if (next.length > 0) run.marks = next.map((m) => ({ ...m }));
      return [run];
    }
  }
}

/** Public entrypoint for tests + block emitters. */
export function inlineNodes(content: InlineNode[]): JSONContent[] {
  return content.flatMap((n) => walkInline(n, []));
}

// ---------------------------------------------------------------------------
// Block → JSONContent
// ---------------------------------------------------------------------------

function blockToTipTapJson(block: Block): JSONContent[] {
  switch (block.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(6, block.level)) as 1 | 2 | 3 | 4 | 5 | 6;
      return [{
        type: 'heading',
        attrs: { level },
        content: inlineNodes([{ type: 'text', value: block.text }]),
      }];
    }
    case 'paragraph':
      return [{
        type: 'paragraph',
        content: inlineNodes(block.content),
      }];
    case 'list': {
      const type = block.ordered ? 'orderedList' : 'bulletList';
      return [{
        type,
        content: block.items.map((item) => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: inlineNodes(item),
          }],
        })),
      }];
    }
    case 'callout': {
      // Mirror the HTML seed: optional title becomes a bold-marked
      // prefix on the first paragraph followed by a hardBreak so the
      // body lands on the next visual line. The variant attr is
      // preserved when present (the reverse pipeline reads it back).
      const titlePrefix: JSONContent[] = block.title
        ? [
            { type: 'text', text: block.title, marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
          ]
        : [];
      const body: JSONContent = {
        type: 'paragraph',
        content: [...titlePrefix, ...inlineNodes(block.content)],
      };
      const node: JSONContent = {
        type: 'blockquote',
        content: [body],
      };
      if (block.variant) node.attrs = { variant: block.variant };
      return [node];
    }
    case 'action': {
      // Same shape as the HTML seed: a paragraph wrapping a single
      // link-marked text run. A5's variant chip layers on top via the
      // NodeView; this seed just keeps the link visible.
      return [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: block.label,
          marks: [{ type: 'link', attrs: { href: block.href } }],
        }],
      }];
    }
    case 'section': {
      // Section is not yet a real schema node — emit the same shape
      // as the HTML seed: heading-level-2 title + nested blocks
      // flattened inline.
      const heading: JSONContent[] = block.title
        ? [{
            type: 'heading',
            attrs: { level: 2 },
            content: inlineNodes([{ type: 'text', value: block.title }]),
          }]
        : [];
      const nested = block.blocks.flatMap(blockToTipTapJson);
      return [...heading, ...nested];
    }
    case 'divider':
      return [{ type: 'horizontalRule' }];
    case 'code': {
      const node: JSONContent = { type: 'codeBlock' };
      if (block.lang) node.attrs = { language: block.lang };
      node.content = block.value
        ? [{ type: 'text', text: block.value }]
        : [];
      return [node];
    }
    case 'image': {
      const attrs: Record<string, unknown> = {
        src: block.src,
        alt: block.alt,
      };
      if (typeof block.width === 'number') attrs.width = block.width;
      if (typeof block.height === 'number') attrs.height = block.height;
      return [{ type: 'image', attrs }];
    }
    case 'table':
      return [{
        type: 'table',
        content: block.rows.map((row) => ({
          type: 'tableRow',
          content: row.map((cell, ci) => ({
            type: ci === 0 ? 'tableHeader' : 'tableCell',
            content: [{
              type: 'paragraph',
              content: inlineNodes(cell),
            }],
          })),
        })),
      }];
  }
}

// ---------------------------------------------------------------------------
// PortableDoc → TipTap JSON (the public seed function)
// ---------------------------------------------------------------------------

/**
 * Convert a PortableDoc into a TipTap-canonical `JSONContent` tree.
 * The result is suitable for the `content` option of `useEditor` and
 * for `editor.commands.setContent(...)`. Empty docs emit a single
 * empty paragraph so TipTap has a cursor home; the Placeholder
 * extension surfaces hint text against that empty node.
 */
export function portableDocToTipTapJson(doc: PortableDoc): JSONContent {
  if (!doc.blocks || doc.blocks.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc',
    content: doc.blocks.flatMap(blockToTipTapJson),
  };
}
