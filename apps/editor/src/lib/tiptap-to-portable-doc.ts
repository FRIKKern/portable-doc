/**
 * Reverse pipeline: TipTap JSON → PortableDoc.
 *
 * The editor's authoritative state is ProseMirror; `editor.getJSON()` returns
 * a TipTap-shaped document like:
 *
 *   {
 *     type: 'doc',
 *     content: [
 *       { type: 'heading',   attrs: { level: 2 }, content: [{type:'text', text:'…'}] },
 *       { type: 'paragraph', content: [...] },
 *       { type: 'bulletList', content: [{ type: 'listItem', content: [...] }] },
 *       { type: 'blockquote', attrs: { variant: { tone:'warning', emphasis:'bold' } }, content: [...] },
 *       { type: 'codeBlock',  attrs: { language: 'ts' }, content: [{type:'text', text:'…'}] },
 *       { type: 'horizontalRule' },
 *       { type: 'image',      attrs: { src: '…', alt: '…' } },
 *       { type: 'table',      content: [{ type: 'tableRow', content: [{ type: 'tableHeader'|'tableCell', content: [...] }] }] },
 *     ]
 *   }
 *
 * This module maps that shape back to PortableDoc Block[] so the AST stays
 * canonical and the email/ink/web backends receive live edits.
 *
 * Inline marks (bold/italic/code/link) become nested InlineNodes
 * (`strong` / `em` / `code` / `link`). Marks compose: `bold + italic + text`
 * round-trips to `{ type:'strong', children:[{type:'em', children:[{type:'text', value:'…'}]}] }`.
 * The strong/em ordering inside the tree is deterministic — we apply the
 * marks in the order TipTap emits them, which matches the order they were
 * applied. Round-tripping through the editor again preserves the order.
 *
 * IDs: PortableDoc requires every block to carry an `id`. TipTap doesn't
 * track stable IDs across edits (typing a character is a full replacement
 * of the node from the schema's POV). We mint deterministic content-hashed
 * IDs so identical doc state produces identical IDs — this avoids
 * spurious diffs in tests + makes MarginDiagnostics' blockId lookup
 * stable across save/load cycles.
 */
import type {
  Block,
  CalloutBlock,
  CodeBlock,
  HeadingBlock,
  ImageBlock,
  InlineNode,
  ListBlock,
  PortableDoc,
  TableBlock,
  Tone,
} from '@portable-doc/core';

// ---------------------------------------------------------------------------
// Local types for TipTap JSON
// ---------------------------------------------------------------------------

interface TtMark {
  type: string;
  attrs?: Record<string, unknown>;
}
interface TtNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TtNode[];
  text?: string;
  marks?: TtMark[];
}

// ---------------------------------------------------------------------------
// Deterministic content-hashed IDs
// ---------------------------------------------------------------------------

/** djb2 hash — small, deterministic, no crypto dependency. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  // Convert to unsigned 32-bit and base-36 for compact IDs.
  return (h >>> 0).toString(36);
}
function mintId(blockType: string, idx: number, content: string): string {
  return `${blockType}-${idx}-${hashString(content)}`;
}

// ---------------------------------------------------------------------------
// Inline marks → InlineNode tree
// ---------------------------------------------------------------------------

/**
 * Wrap a base text node with its marks. TipTap stores marks as a flat array
 * on the text node (`{ type: 'text', text: '…', marks: [{type:'bold'},
 * {type:'italic'}] }`); PortableDoc represents the same as nested children
 * (strong → em → text). We wrap inside-out: the first mark in the array
 * becomes the outermost wrapper.
 */
function wrapWithMarks(textNode: InlineNode, marks: TtMark[] | undefined): InlineNode {
  if (!marks || marks.length === 0) return textNode;
  // Apply marks from last to first so the FIRST mark ends up outermost
  // (matches the typical convention in serialized HTML: <strong><em>x</em></strong>).
  let acc = textNode;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]!;
    switch (m.type) {
      case 'bold':
      case 'strong':
        acc = { type: 'strong', children: [acc] };
        break;
      case 'italic':
      case 'em':
        acc = { type: 'em', children: [acc] };
        break;
      case 'code': {
        // Inline code in PortableDoc is a leaf (value: string); if we
        // already have a structured child, fall back to wrapping in
        // strong to preserve content (rare edge case: code + bold + …).
        if (acc.type === 'text') {
          acc = { type: 'code', value: acc.value };
        } else {
          // Shouldn't happen in practice — TipTap doesn't combine
          // inline-code with other marks on the same text run — but
          // preserve content rather than throw.
          acc = { type: 'code', value: inlineToPlainText([acc]) };
        }
        break;
      }
      case 'link': {
        const href = typeof m.attrs?.href === 'string' ? (m.attrs.href as string) : '';
        acc = { type: 'link', href, children: [acc] };
        break;
      }
      default:
        // Unknown mark — skip silently. Marks the editor doesn't surface
        // (e.g. an extension we haven't registered) shouldn't crash conversion.
        break;
    }
  }
  return acc;
}

function inlineNodeFromTipTap(node: TtNode): InlineNode | null {
  if (node.type === 'text') {
    return wrapWithMarks(
      { type: 'text', value: node.text ?? '' },
      node.marks,
    );
  }
  if (node.type === 'hardBreak') {
    // PortableDoc doesn't have a dedicated hardBreak; collapse to a
    // newline text node. v0.5 may add a real PdSoftBreak primitive.
    return { type: 'text', value: '\n' };
  }
  return null;
}

/** Walk a TipTap inline-content array and produce a flat InlineNode[]. */
function inlineChildrenFromTipTap(content: TtNode[] | undefined): InlineNode[] {
  if (!content) return [];
  const out: InlineNode[] = [];
  for (const child of content) {
    const node = inlineNodeFromTipTap(child);
    if (node) out.push(node);
  }
  return out;
}

/** Recover plain text from an InlineNode tree (for code-mark fallback +
 *  heading text + tone-callout title extraction). */
function inlineToPlainText(nodes: InlineNode[]): string {
  let s = '';
  for (const n of nodes) {
    if (n.type === 'text') s += n.value;
    else if (n.type === 'code') s += n.value;
    else if (n.type === 'strong' || n.type === 'em' || n.type === 'link') {
      s += inlineToPlainText(n.children);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Block converters
// ---------------------------------------------------------------------------

type Variant = Record<string, string>;
function readVariantAttr(attrs: Record<string, unknown> | undefined): Variant | undefined {
  const raw = attrs?.variant;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Variant;
  }
  return undefined;
}

function blockFromTipTap(node: TtNode, idx: number): Block | null {
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);
      const clamped = (Math.max(1, Math.min(6, Number.isFinite(level) ? level : 1)) as
        HeadingBlock['level']);
      const text = inlineToPlainText(inlineChildrenFromTipTap(node.content));
      return {
        id: mintId('heading', idx, `${clamped}|${text}`),
        type: 'heading',
        level: clamped,
        text,
      };
    }
    case 'paragraph': {
      const content = inlineChildrenFromTipTap(node.content);
      return {
        id: mintId('paragraph', idx, inlineToPlainText(content)),
        type: 'paragraph',
        content,
      };
    }
    case 'bulletList':
    case 'orderedList': {
      const items: InlineNode[][] = [];
      for (const li of node.content ?? []) {
        if (li.type !== 'listItem') continue;
        // Each <li> in TipTap typically wraps a single paragraph; we
        // flatten that to the InlineNode[] PortableDoc expects per item.
        const itemContent: InlineNode[] = [];
        for (const child of li.content ?? []) {
          if (child.type === 'paragraph') {
            itemContent.push(...inlineChildrenFromTipTap(child.content));
          }
        }
        items.push(itemContent);
      }
      const block: ListBlock = {
        id: mintId('list', idx, items.map(inlineToPlainText).join('|')),
        type: 'list',
        items,
      };
      if (node.type === 'orderedList') block.ordered = true;
      return block;
    }
    case 'blockquote': {
      // TipTap's blockquote can hold multiple paragraphs; PortableDoc's
      // callout has `content: InlineNode[]`. Flatten all child paragraphs
      // into a single inline sequence, separating with newlines so word
      // boundaries survive.
      const inlines: InlineNode[] = [];
      const paragraphs = node.content ?? [];
      paragraphs.forEach((p, pIdx) => {
        if (p.type !== 'paragraph') return;
        if (pIdx > 0) inlines.push({ type: 'text', value: '\n' });
        inlines.push(...inlineChildrenFromTipTap(p.content));
      });
      const variant = readVariantAttr(node.attrs);
      const tone: Tone =
        (variant?.tone as Tone | undefined) ?? 'info';
      const block: CalloutBlock = {
        id: mintId('callout', idx, inlineToPlainText(inlines)),
        type: 'callout',
        tone,
        content: inlines,
      };
      if (variant && Object.keys(variant).length > 0) {
        block.variant = variant;
      }
      return block;
    }
    case 'codeBlock': {
      const text = (node.content ?? [])
        .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
        .join('');
      const lang = typeof node.attrs?.language === 'string' ? (node.attrs.language as string) : undefined;
      const variant = readVariantAttr(node.attrs);
      const block: CodeBlock = {
        id: mintId('code', idx, `${lang ?? ''}|${text}`),
        type: 'code',
        value: text,
      };
      if (lang) block.lang = lang;
      if (variant && Object.keys(variant).length > 0) {
        block.variant = variant;
      }
      return block;
    }
    case 'horizontalRule':
      return {
        id: mintId('divider', idx, ''),
        type: 'divider',
      };
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? (node.attrs.src as string) : '';
      const alt = typeof node.attrs?.alt === 'string' ? (node.attrs.alt as string) : '';
      const block: ImageBlock = {
        id: mintId('image', idx, `${src}|${alt}`),
        type: 'image',
        src,
        alt,
        surfaces: ['web', 'native'],
      };
      const w = node.attrs?.width;
      const h = node.attrs?.height;
      if (typeof w === 'number') block.width = w;
      if (typeof h === 'number') block.height = h;
      return block;
    }
    case 'table': {
      const rows: InlineNode[][][] = [];
      for (const row of node.content ?? []) {
        if (row.type !== 'tableRow') continue;
        const cells: InlineNode[][] = [];
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
          const cellInline: InlineNode[] = [];
          for (const child of cell.content ?? []) {
            if (child.type === 'paragraph') {
              cellInline.push(...inlineChildrenFromTipTap(child.content));
            }
          }
          cells.push(cellInline);
        }
        rows.push(cells);
      }
      const block: TableBlock = {
        id: mintId(
          'table',
          idx,
          rows.map((r) => r.map(inlineToPlainText).join('|')).join('||'),
        ),
        type: 'table',
        rows,
        surfaces: ['web', 'native'],
      };
      return block;
    }
    default:
      // Unknown node — skip silently. The TipTap doc could contain
      // extension-specific nodes we haven't mapped yet (e.g. a future
      // section node). Better to drop than to crash.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Top-level entrypoint
// ---------------------------------------------------------------------------

/**
 * Convert the result of `editor.getJSON()` to a PortableDoc.
 *
 * Preserves the input's `title` / `preview` if the caller threads them
 * through — TipTap doesn't model those fields, so the parent component
 * (App.tsx) should merge them in afterwards if needed. The signature
 * accepts a `prev: PortableDoc | null` so callers can preserve those
 * top-level fields across the conversion.
 */
export function tiptapToPortableDoc(
  json: TtNode | { type: string; content?: TtNode[] },
  prev?: PortableDoc | null,
): PortableDoc {
  const root = json as TtNode;
  const blocks: Block[] = [];
  const children = root.content ?? [];
  children.forEach((node, idx) => {
    const b = blockFromTipTap(node, idx);
    if (b) blocks.push(b);
  });
  const out: PortableDoc = {
    version: 1,
    blocks,
  };
  if (prev?.title) out.title = prev.title;
  if (prev?.preview) out.preview = prev.preview;
  return out;
}
