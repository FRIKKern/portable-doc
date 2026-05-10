/**
 * Sandbox / disposable — proves TipTap can round-trip our `InlineNode[]` shape.
 *
 * The mapping flattens the nested-children AST (`strong`/`em`/`link` wrap a
 * children array) into TipTap's flat list of text-nodes-with-marks. The
 * inverse direction walks TipTap's inline node array and re-wraps consecutive
 * same-mark text into our nested shape.
 *
 * Round-trip is asserted on a normalized form on both sides:
 *   normalize :: InlineNode[] -> InlineNode[]
 *
 * Normalization:
 *   - merge adjacent `text` nodes with the same effective marks
 *   - drop empty `text` nodes
 *
 * `code` is treated as a leaf with `value`, like our AST has it (no children).
 * Compositional marks: a bold link is `marks: [{type:'bold'},{type:'link',attrs:{href}}]`
 * which round-trips back into a `strong` wrapping a `link` wrapping `text`
 * (deterministic outer-inner ordering: bold > italic > link > code).
 */
import type { JSONContent } from '@tiptap/core';
import type { InlineNode } from '@portable-doc/core';

type Marks = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: { href: string };
};

interface FlatRun {
  text: string;
  marks: Marks;
}

// ---------------------------------------------------------------------------
// InlineNode[] -> flat runs -> TipTap JSONContent[]
// ---------------------------------------------------------------------------

function flatten(nodes: InlineNode[], inherited: Marks = {}): FlatRun[] {
  const out: FlatRun[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push({ text: node.value, marks: { ...inherited } });
        break;
      case 'strong':
        out.push(...flatten(node.children, { ...inherited, bold: true }));
        break;
      case 'em':
        out.push(...flatten(node.children, { ...inherited, italic: true }));
        break;
      case 'code':
        // `code` is a leaf in our AST; merge with inherited marks if any.
        out.push({ text: node.value, marks: { ...inherited, code: true } });
        break;
      case 'link':
        out.push(...flatten(node.children, { ...inherited, link: { href: node.href } }));
        break;
    }
  }
  return out;
}

function runToTiptap(run: FlatRun): JSONContent {
  const marks: NonNullable<JSONContent['marks']> = [];
  // Order chosen for stability — TipTap doesn't care, but our re-wrap does.
  if (run.marks.bold) marks.push({ type: 'bold' });
  if (run.marks.italic) marks.push({ type: 'italic' });
  if (run.marks.link) marks.push({ type: 'link', attrs: { href: run.marks.link.href } });
  if (run.marks.code) marks.push({ type: 'code' });
  const out: JSONContent = { type: 'text', text: run.text };
  if (marks.length > 0) out.marks = marks;
  return out;
}

export function inlineNodesToTiptap(inline: InlineNode[]): JSONContent[] {
  return flatten(inline).map(runToTiptap);
}

// ---------------------------------------------------------------------------
// TipTap JSONContent[] -> flat runs -> InlineNode[]
// ---------------------------------------------------------------------------

function tiptapToRun(node: JSONContent): FlatRun | null {
  if (node.type !== 'text' || typeof node.text !== 'string') return null;
  const marks: Marks = {};
  for (const m of node.marks ?? []) {
    if (m.type === 'bold') marks.bold = true;
    else if (m.type === 'italic') marks.italic = true;
    else if (m.type === 'code') marks.code = true;
    else if (m.type === 'link') {
      const href = (m.attrs && typeof m.attrs['href'] === 'string') ? m.attrs['href'] : '';
      marks.link = { href };
    }
  }
  return { text: node.text, marks };
}

/**
 * Re-wrap a single FlatRun into nested InlineNodes following the deterministic
 * outermost-to-innermost order: strong > em > link > code/text.
 */
function runToInlineNode(run: FlatRun): InlineNode {
  // Innermost first.
  let inner: InlineNode = run.marks.code
    ? { type: 'code', value: run.text }
    : { type: 'text', value: run.text };
  if (run.marks.link) {
    // `code` inside a link is unusual; AST allows link.children to be any InlineNode[].
    inner = { type: 'link', href: run.marks.link.href, children: [inner] };
  }
  if (run.marks.italic) {
    inner = { type: 'em', children: [inner] };
  }
  if (run.marks.bold) {
    inner = { type: 'strong', children: [inner] };
  }
  return inner;
}

export function tiptapToInlineNodes(content: JSONContent[]): InlineNode[] {
  const runs: FlatRun[] = [];
  for (const node of content) {
    const run = tiptapToRun(node);
    if (run !== null && run.text.length > 0) runs.push(run);
  }
  return runs.map(runToInlineNode);
}

// ---------------------------------------------------------------------------
// Normalization — used by tests to compare round-trip equivalence.
// ---------------------------------------------------------------------------

/**
 * Normalize an InlineNode[] to the same flat-run + re-wrap form the round-trip
 * produces, so test assertions can compare apples-to-apples regardless of
 * incidental nesting differences in the original input.
 */
export function normalizeInline(nodes: InlineNode[]): InlineNode[] {
  const runs = flatten(nodes).filter((r) => r.text.length > 0);
  // Merge adjacent runs with identical marks.
  const merged: FlatRun[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && marksEqual(last.marks, r.marks)) {
      last.text += r.text;
    } else {
      merged.push({ text: r.text, marks: { ...r.marks } });
    }
  }
  return merged.map(runToInlineNode);
}

function marksEqual(a: Marks, b: Marks): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.code === !!b.code &&
    (a.link?.href ?? null) === (b.link?.href ?? null)
  );
}
