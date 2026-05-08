/**
 * Rule-based fixer.
 *
 * Pure functions — no mutation of the input. Each rule walks a deep clone of
 * the document, applies its transformation, and pushes a one-line description
 * onto the `changes` log.
 *
 * Rules (per goal brief):
 *   1. http:// → https:// for link.href and action.href + image.src.
 *   2. empty heading.text → "Untitled section".
 *   3. action.label > 48 chars → truncate to 45 + "…".
 *   4. action.label === "" → "Continue".
 *   5. paragraph with empty content → drop.
 */
import type {
  Block,
  InlineNode,
  PortableDoc,
} from '@portable-doc/core';

export interface SuggestFixesResult {
  fixedDocument: PortableDoc;
  changes: string[];
}

export function suggestFixes(doc: PortableDoc): SuggestFixesResult {
  const cloned = structuredCloneCompat(doc);
  const changes: string[] = [];
  cloned.blocks = fixBlocks(cloned.blocks, changes);
  return { fixedDocument: cloned, changes };
}

function fixBlocks(blocks: Block[], changes: string[]): Block[] {
  const out: Block[] = [];
  for (const raw of blocks) {
    const fixed = fixBlock(raw, changes);
    if (fixed === null) continue;
    out.push(fixed);
  }
  return out;
}

function fixBlock(block: Block, changes: string[]): Block | null {
  switch (block.type) {
    case 'heading':
      if (block.text.length === 0) {
        changes.push(`heading[id="${block.id}"]: empty text replaced with "Untitled section"`);
        return { ...block, text: 'Untitled section' };
      }
      return block;

    case 'paragraph': {
      const fixedContent = fixInline(block.content, block.id, changes);
      if (fixedContent.length === 0) {
        changes.push(`paragraph[id="${block.id}"]: dropped (empty content)`);
        return null;
      }
      return { ...block, content: fixedContent };
    }

    case 'list': {
      const fixedItems = block.items.map((item) => fixInline(item, block.id, changes));
      return { ...block, items: fixedItems };
    }

    case 'callout': {
      const fixedContent = fixInline(block.content, block.id, changes);
      return { ...block, content: fixedContent };
    }

    case 'action': {
      const next = { ...block };
      if (next.label.length === 0) {
        changes.push(`action[id="${block.id}"]: empty label replaced with "Continue"`);
        next.label = 'Continue';
      } else if (next.label.length > 48) {
        const truncated = next.label.slice(0, 45) + '…';
        changes.push(
          `action[id="${block.id}"]: label truncated from ${next.label.length} to ${truncated.length} chars`,
        );
        next.label = truncated;
      }
      const fixedHref = fixHref(next.href, `action[id="${block.id}"].href`, changes);
      if (fixedHref !== next.href) next.href = fixedHref;
      return next;
    }

    case 'section': {
      const fixedChildren = fixBlocks(block.blocks, changes);
      return { ...block, blocks: fixedChildren };
    }

    case 'image': {
      const next = { ...block };
      const fixedSrc = fixHref(next.src, `image[id="${block.id}"].src`, changes);
      if (fixedSrc !== next.src) next.src = fixedSrc;
      return next;
    }

    case 'table': {
      const next = { ...block };
      next.rows = block.rows.map((row) =>
        row.map((cell) => fixInline(cell, block.id, changes)),
      );
      return next;
    }

    case 'divider':
    case 'code':
      return block;

    default: {
      // Exhaustiveness: any unhandled new block types fall through.
      const _never: never = block;
      void _never;
      return block;
    }
  }
}

function fixInline(nodes: InlineNode[], blockId: string, changes: string[]): InlineNode[] {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text':
      case 'code':
        return n;
      case 'strong':
        return { ...n, children: fixInline(n.children, blockId, changes) };
      case 'em':
        return { ...n, children: fixInline(n.children, blockId, changes) };
      case 'link': {
        const fixedHref = fixHref(n.href, `link[in block "${blockId}"].href`, changes);
        return { ...n, href: fixedHref, children: fixInline(n.children, blockId, changes) };
      }
    }
  });
}

function fixHref(href: string, label: string, changes: string[]): string {
  if (href.startsWith('http://')) {
    const next = 'https://' + href.slice('http://'.length);
    changes.push(`${label}: rewrote http:// to https://`);
    return next;
  }
  return href;
}

/**
 * Node ≥ 17 has structuredClone globally; the `Compat` shim is here so the
 * fixer doesn't crash if it's ever imported into a stripped-down runtime.
 */
function structuredCloneCompat<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}
