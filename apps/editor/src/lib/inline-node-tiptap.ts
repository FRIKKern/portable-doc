/**
 * Bidirectional conversion between portable-doc's `InlineNode[]` AST and
 * TipTap's flat-text-with-marks JSON shape.
 *
 * Why this module exists
 * ----------------------
 * Our AST nests inline structure: `strong`, `em`, and `link` wrap a
 * `children: InlineNode[]` array, while `text` and `code` are leaves with
 * `value`. TipTap (built on ProseMirror) flattens that into a list of text
 * nodes carrying a `marks` array. To put a TipTap editor in front of any
 * `InlineNode[]` field we need a bijection (modulo normalization) between
 * those two shapes.
 *
 * Mark composition
 * ----------------
 * The four marks we care about — `bold`, `italic`, `code`, `link` — compose
 * cleanly with each other on the TipTap side; a single text node can carry
 * any subset. On the AST side that becomes nested wrappers, and we pick a
 * deterministic outermost-to-innermost ordering so the round-trip is stable:
 *
 *     strong > em > link > code/text
 *
 * Examples:
 *   - bold link        → `strong > link > text`
 *   - bold italic      → `strong > em > text`
 *   - bold em link     → `strong > em > link > text`
 *   - inline code      → `code` (leaf, no children)
 *
 * This ordering is arbitrary but stable. Tests compare on the normalized
 * form (see `normalizeInline`) so input written with a different ordering
 * still round-trips to canonical equality.
 *
 * Normalization
 * -------------
 * The exported `normalizeInline` function flattens the AST through the same
 * intermediate run representation, merges adjacent runs that share marks,
 * drops empty text, and re-wraps. Tests use it to assert round-trip
 * equivalence: `tiptapToInlineNodes(tiptap) === normalizeInline(original)`.
 *
 * Edge cases handled
 * ------------------
 * - Consecutive same-mark text (e.g. two adjacent `text` nodes both inside
 *   the same `strong`) merges into one run.
 * - Empty `text` nodes are dropped — TipTap doesn't emit them and we don't
 *   want them in the AST either.
 * - Non-text TipTap nodes (e.g. hard breaks) are skipped on conversion in;
 *   the editor never produces them under StarterKit's default config in our
 *   single-paragraph wrapper, but the guard prevents future surprises.
 * - Link with missing `href` attr defaults to empty string rather than
 *   throwing — keeps the round-trip lossless even on a half-built link.
 */
import type { JSONContent } from '@tiptap/core';
import type { InlineNode } from '@portable-doc/core';

// ---------------------------------------------------------------------------
// Internal flat-run representation
// ---------------------------------------------------------------------------

/**
 * Flat-run intermediate. Mirrors TipTap's text-with-marks shape, used as a
 * neutral pivot for both conversion directions.
 */
interface FlatRun {
  text: string;
  marks: RunMarks;
}

/** All marks supported by the round-trip. */
interface RunMarks {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: { href: string };
}

// ---------------------------------------------------------------------------
// InlineNode[] -> TipTap JSONContent[]
// ---------------------------------------------------------------------------

/**
 * Walk a (possibly nested) `InlineNode[]` and emit a flat sequence of runs,
 * accumulating marks down the tree. Each leaf (`text` or `code`) becomes one
 * run carrying the inherited marks plus its own.
 */
function flattenToRuns(nodes: InlineNode[], inherited: RunMarks = {}): FlatRun[] {
  const out: FlatRun[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push({ text: node.value, marks: { ...inherited } });
        break;
      case 'strong':
        out.push(...flattenToRuns(node.children, { ...inherited, bold: true }));
        break;
      case 'em':
        out.push(...flattenToRuns(node.children, { ...inherited, italic: true }));
        break;
      case 'code':
        // `code` is a leaf in our AST; merge with whatever marks were inherited.
        out.push({ text: node.value, marks: { ...inherited, code: true } });
        break;
      case 'link':
        out.push(
          ...flattenToRuns(node.children, { ...inherited, link: { href: node.href } }),
        );
        break;
    }
  }
  return out;
}

/**
 * Render a flat run as one TipTap text node with its marks attached.
 * The mark order on the TipTap side doesn't affect rendering, but a stable
 * order makes snapshot diffs and equality assertions easier to read.
 */
function runToTiptapTextNode(run: FlatRun): JSONContent {
  const marks: NonNullable<JSONContent['marks']> = [];
  if (run.marks.bold) marks.push({ type: 'bold' });
  if (run.marks.italic) marks.push({ type: 'italic' });
  if (run.marks.link) marks.push({ type: 'link', attrs: { href: run.marks.link.href } });
  if (run.marks.code) marks.push({ type: 'code' });
  const node: JSONContent = { type: 'text', text: run.text };
  if (marks.length > 0) node.marks = marks;
  return node;
}

/**
 * Convert an `InlineNode[]` (portable-doc AST) into the flat
 * text-with-marks shape TipTap consumes as a paragraph's `content`.
 *
 * Empty text leaves are filtered out — TipTap rejects zero-length text nodes,
 * and emitting one would corrupt the editor schema on mount.
 *
 * @example
 *   inlineNodesToTiptap([
 *     { type: 'text', value: 'Hello ' },
 *     { type: 'strong', children: [{ type: 'text', value: 'world' }] },
 *   ])
 *   // =>
 *   [
 *     { type: 'text', text: 'Hello ' },
 *     { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
 *   ]
 */
export function inlineNodesToTiptap(inline: InlineNode[]): JSONContent[] {
  return flattenToRuns(inline)
    .filter((r) => r.text.length > 0)
    .map(runToTiptapTextNode);
}

// ---------------------------------------------------------------------------
// TipTap JSONContent[] -> InlineNode[]
// ---------------------------------------------------------------------------

/**
 * Pull marks off a single TipTap text node into our intermediate `RunMarks`.
 * Returns `null` if the node isn't a text node (TipTap may emit hard-break
 * nodes etc.; we drop them silently rather than crash).
 */
function tiptapTextNodeToRun(node: JSONContent): FlatRun | null {
  if (node.type !== 'text' || typeof node.text !== 'string') return null;
  const marks: RunMarks = {};
  for (const m of node.marks ?? []) {
    if (m.type === 'bold') marks.bold = true;
    else if (m.type === 'italic') marks.italic = true;
    else if (m.type === 'code') marks.code = true;
    else if (m.type === 'link') {
      const href = m.attrs && typeof m.attrs['href'] === 'string' ? m.attrs['href'] : '';
      marks.link = { href };
    }
  }
  return { text: node.text, marks };
}

/**
 * Re-wrap a single FlatRun into a nested InlineNode following the canonical
 * outermost-to-innermost order (strong > em > link > code/text). The
 * resulting AST node is always exactly one wrapper-chain deep per run, so
 * round-trips converge after one pass.
 */
function runToInlineNode(run: FlatRun): InlineNode {
  // Innermost first: code is a leaf carrying the run text; otherwise text.
  let inner: InlineNode = run.marks.code
    ? { type: 'code', value: run.text }
    : { type: 'text', value: run.text };
  if (run.marks.link) {
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

/**
 * Merge adjacent flat runs with identical marks. TipTap also does this
 * internally when content is set, so applying it on the AST side keeps
 * the two representations aligned.
 */
function mergeAdjacentRuns(runs: FlatRun[]): FlatRun[] {
  const merged: FlatRun[] = [];
  for (const r of runs) {
    if (r.text.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && marksEqual(last.marks, r.marks)) {
      last.text += r.text;
    } else {
      merged.push({ text: r.text, marks: { ...r.marks } });
    }
  }
  return merged;
}

/** Structural equality on the closed set of mark fields we care about. */
function marksEqual(a: RunMarks, b: RunMarks): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.code === !!b.code &&
    (a.link?.href ?? null) === (b.link?.href ?? null)
  );
}

/**
 * Convert TipTap's flat text-node-with-marks list back into our nested
 * `InlineNode[]` AST. Each text node becomes one wrapper-chain; adjacent
 * same-mark nodes merge so the output stays minimal.
 *
 * @example
 *   tiptapToInlineNodes([
 *     { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
 *     { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
 *   ])
 *   // =>
 *   [
 *     { type: 'strong', children: [{ type: 'text', value: 'bold world' }] },
 *   ]
 */
export function tiptapToInlineNodes(content: JSONContent[]): InlineNode[] {
  const runs: FlatRun[] = [];
  for (const node of content) {
    const run = tiptapTextNodeToRun(node);
    if (run !== null) runs.push(run);
  }
  return mergeAdjacentRuns(runs).map(runToInlineNode);
}

// ---------------------------------------------------------------------------
// Normalization (exported for tests + external value-equality checks)
// ---------------------------------------------------------------------------

/**
 * Normalize an `InlineNode[]` to the canonical form the round-trip produces.
 * Useful for:
 *   - asserting round-trip equivalence in tests regardless of the input's
 *     incidental nesting (e.g. `[strong[text 'a'], strong[text 'b']]`
 *     normalizes to `[strong[text 'ab']]`),
 *   - cheap value-equality checks when deciding whether to push external
 *     value updates into a live editor (see `RichTextField`'s sync effect).
 */
export function normalizeInline(nodes: InlineNode[]): InlineNode[] {
  return mergeAdjacentRuns(flattenToRuns(nodes)).map(runToInlineNode);
}
