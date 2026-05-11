/**
 * One-way seed: PortableDoc JSON → TipTap-compatible HTML.
 *
 * Used by `Editor.tsx` (A1) to render a doc into the single document-level
 * TipTap instance on mount. v0.4's editor owns the doc model — TipTap holds
 * the live working state, and the AST exists as the on-disk format only.
 * Subsequent tasks (A2 NodeView, A6 reorder, etc.) read TipTap → AST through
 * a separate inverse pipeline.
 *
 * What this covers
 * ----------------
 * - heading        → <h1|2|3>
 * - paragraph      → <p>  (inline marks: strong / em / code / link)
 * - list           → <ul|ol> + <li>
 * - callout        → <blockquote data-tone> (A2 will paint the chrome)
 * - action         → <p><a href> placeholder (A5 ships the chip; this is
 *                    just visible content so the editor isn't empty)
 * - section        → recursive — emits the section title as <h2> + the
 *                    nested blocks inline. A2 will replace this with a
 *                    section NodeView.
 * - divider        → <hr>
 * - code           → <pre><code class="language-{lang}">
 * - image          → <p>[image: alt]</p>  (naive — A2's NodeView ships)
 * - table          → <p>[table: N rows]</p>  (naive — A2's NodeView ships)
 *
 * Inline marks compose into TipTap's flat-text + marks shape via standard
 * HTML wrappers (strong / em / code / a). The TipTap parser accepts this
 * verbatim.
 */
import type {
  Block,
  InlineNode,
  PortableDoc,
} from '@portable-doc/core';

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// ---------------------------------------------------------------------------
// Inline nodes → HTML
// ---------------------------------------------------------------------------

function inlineToHtml(nodes: InlineNode[]): string {
  return nodes.map(inlineNodeToHtml).join('');
}

function inlineNodeToHtml(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'strong':
      return `<strong>${inlineToHtml(node.children)}</strong>`;
    case 'em':
      return `<em>${inlineToHtml(node.children)}</em>`;
    case 'code':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'link':
      return `<a href="${escapeAttr(node.href)}">${inlineToHtml(node.children)}</a>`;
  }
}

// ---------------------------------------------------------------------------
// Block → HTML
// ---------------------------------------------------------------------------

function blockToHtml(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(3, block.level));
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${inlineToHtml(block.content)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items
        .map((li) => `<li><p>${inlineToHtml(li)}</p></li>`)
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'callout': {
      // A2 will swap this for a NodeView; the data-tone attribute is the
      // hook so the chrome knows which side-stripe color to paint.
      const title = block.title
        ? `<p><strong>${escapeHtml(block.title)}</strong></p>`
        : '';
      const tone = escapeAttr(block.tone);
      return `<blockquote data-tone="${tone}">${title}<p>${inlineToHtml(block.content)}</p></blockquote>`;
    }
    case 'action': {
      // A5 ships the variant chip. For A1 we just keep the link visible so
      // the editor isn't an empty surface.
      const href = escapeAttr(block.href);
      const label = escapeHtml(block.label);
      return `<p><a href="${href}" data-action-priority="${escapeAttr(block.priority)}">${label}</a></p>`;
    }
    case 'section': {
      const heading = block.title
        ? `<h2>${escapeHtml(block.title)}</h2>`
        : '';
      const nested = block.blocks.map(blockToHtml).join('');
      return `${heading}${nested}`;
    }
    case 'divider':
      return `<hr>`;
    case 'code': {
      const lang = block.lang ? `language-${escapeAttr(block.lang)}` : '';
      const cls = lang ? ` class="${lang}"` : '';
      return `<pre><code${cls}>${escapeHtml(block.value)}</code></pre>`;
    }
    case 'image':
      // Naive placeholder — A2's NodeView replaces this with a real image.
      return `<p>[image: ${escapeHtml(block.alt)}]</p>`;
    case 'table':
      return `<p>[table: ${block.rows.length} rows]</p>`;
  }
}

// ---------------------------------------------------------------------------
// PortableDoc → HTML (the public seed function)
// ---------------------------------------------------------------------------

/**
 * Convert a PortableDoc into a TipTap-compatible HTML string suitable for
 * the `content` option of `useEditor`. Empty docs produce a single empty
 * paragraph so TipTap has something to mount the cursor into; the
 * Placeholder extension surfaces the hint text from that empty node.
 */
export function portableDocToTipTapHtml(doc: PortableDoc): string {
  if (!doc.blocks || doc.blocks.length === 0) return '<p></p>';
  return doc.blocks.map(blockToHtml).join('');
}
