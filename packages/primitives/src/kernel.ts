/**
 * Kernel composer — turns a validated `PortableDoc` into a backend-agnostic
 * Pd-tree. No React, no DOM, no terminal.
 *
 * The kernel TRUSTS the AST has already passed `validateDoc`. It does not
 * re-validate URLs or tone palette membership. The validator is the only gate.
 *
 * Per-block mapping is exhaustive against `Block` — adding a new block type to
 * core forces a TypeScript error here via the `never` check in `composeBlock`.
 */

import type {
  Block,
  CalloutBlock,
  CodeBlock,
  HeadingBlock,
  InlineNode,
  ListBlock,
  ParagraphBlock,
  PortableDoc,
  SectionBlock,
  TableBlock,
} from '@portable-doc/core';
import type { DefaultTokens } from '@portable-doc/core';
import type {
  PdBoxNode,
  PdCalloutNode,
  PdContainerNode,
  PdHrNode,
  PdImageNode,
  PdInlineCodeNode,
  PdLinkNode,
  PdNode,
  PdTableNode,
  PdTextNode,
} from './pd.js';

export interface ComposeOptions {
  tokens?: DefaultTokens;
}

export function composeDocument(
  doc: PortableDoc,
  _opts?: ComposeOptions,
): PdContainerNode {
  return {
    kind: 'PdContainer',
    maxWidth: 600,
    children: doc.blocks.map(composeBlock),
  };
}

// ---------------------------------------------------------------------------
// Block dispatch
// ---------------------------------------------------------------------------

export function composeBlock(block: Block): PdNode {
  switch (block.type) {
    case 'heading':
      return composeHeading(block);
    case 'paragraph':
      return composeParagraph(block);
    case 'list':
      return composeList(block);
    case 'callout':
      return composeCallout(block);
    case 'action':
      return {
        kind: 'PdButton',
        href: block.href,
        label: block.label,
        priority: block.priority,
      };
    case 'section':
      return composeSection(block);
    case 'divider':
      return composeDivider();
    case 'code':
      return composeCode(block);
    case 'image':
      return composeImage(block);
    case 'table':
      return composeTable(block);
    default: {
      // Exhaustiveness guard — adding a new BlockType in core forces a TS error here.
      const _exhaustive: never = block;
      throw new Error(
        `composeBlock: unhandled block type ${(_exhaustive as Block).type}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Per-block composers
// ---------------------------------------------------------------------------

function composeHeading(block: HeadingBlock): PdTextNode {
  return {
    kind: 'PdText',
    weight: 'bold',
    children: [block.text],
  };
}

function composeParagraph(block: ParagraphBlock): PdTextNode {
  return {
    kind: 'PdText',
    children: composeInlineChildren(block.content),
  };
}

function composeList(block: ListBlock): PdBoxNode {
  const ordered = block.ordered === true;
  const itemRows = block.items.map((item, idx): PdBoxNode => {
    const prefix = ordered ? `${idx + 1}. ` : '• ';
    return {
      kind: 'PdBox',
      style: { flexDirection: 'row' },
      children: [
        { kind: 'PdText', children: [prefix] },
        { kind: 'PdText', children: composeInlineChildren(item) },
      ],
    };
  });
  return {
    kind: 'PdBox',
    style: { flexDirection: 'column' },
    children: itemRows,
  };
}

function composeCallout(block: CalloutBlock): PdCalloutNode {
  const body: PdTextNode = {
    kind: 'PdText',
    children: composeInlineChildren(block.content),
  };
  return {
    kind: 'PdCallout',
    tone: block.tone,
    ...(block.title !== undefined ? { title: block.title } : {}),
    children: [body],
  };
}

function composeSection(block: SectionBlock): PdBoxNode {
  const children: PdNode[] = [];
  children.push({ kind: 'PdHr' });
  if (block.title !== undefined) {
    children.push({
      kind: 'PdText',
      weight: 'bold',
      children: [block.title],
    });
  }
  for (const inner of block.blocks) {
    children.push(composeBlock(inner));
  }
  children.push({ kind: 'PdHr' });
  return {
    kind: 'PdBox',
    style: { flexDirection: 'column' },
    children,
  };
}

function composeDivider(): PdHrNode {
  return { kind: 'PdHr' };
}

function composeCode(block: CodeBlock): PdBoxNode {
  const lines = block.value.split('\n');
  const children: PdNode[] = lines.map(
    (line): PdNode => ({
      kind: 'PdText',
      children: [{ kind: 'PdInlineCode', value: line }],
    }),
  );
  return {
    kind: 'PdBox',
    style: { flexDirection: 'column' },
    children,
  };
}

function composeImage(block: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  surfaces: ['web', 'native'];
}): PdImageNode {
  return {
    kind: 'PdImage',
    src: block.src,
    alt: block.alt,
    ...(block.width !== undefined ? { width: block.width } : {}),
    ...(block.height !== undefined ? { height: block.height } : {}),
    surfaces: block.surfaces,
  };
}

function composeTable(block: TableBlock): PdTableNode {
  const rows: PdNode[][][] = block.rows.map((row) =>
    row.map((cell) => composeInlineChildren(cell).map(toPdNodeFromInlineChild)),
  );
  return {
    kind: 'PdTable',
    rows,
    surfaces: block.surfaces,
  };
}

// ---------------------------------------------------------------------------
// Inline walker
// ---------------------------------------------------------------------------

type InlineChild = PdTextNode | PdLinkNode | PdInlineCodeNode | string;

function composeInlineChildren(nodes: InlineNode[]): InlineChild[] {
  return nodes.map((n) => composeInline(n, false));
}

function composeInline(node: InlineNode, insideLink: boolean): InlineChild {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'strong':
      return {
        kind: 'PdText',
        weight: 'bold',
        children: node.children.map((c) => composeInline(c, insideLink)),
      };
    case 'em':
      return {
        kind: 'PdText',
        italic: true,
        children: node.children.map((c) => composeInline(c, insideLink)),
      };
    case 'code':
      return { kind: 'PdInlineCode', value: node.value };
    case 'link': {
      if (insideLink) {
        // Nested link — flatten to a plain text wrapper to keep links non-recursive.
        return {
          kind: 'PdText',
          children: node.children.map((c) =>
            composeInlineForLinkChildren(c, true),
          ),
        };
      }
      return {
        kind: 'PdLink',
        href: node.href,
        children: node.children.map((c) =>
          composeInlineForLinkChildren(c, true),
        ),
      };
    }
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `composeInline: unhandled inline type ${(_exhaustive as InlineNode).type}`,
      );
    }
  }
}

/** Link children are typed as `PdTextNode | string` only. */
function composeInlineForLinkChildren(
  node: InlineNode,
  insideLink: boolean,
): PdTextNode | string {
  const composed = composeInline(node, insideLink);
  if (typeof composed === 'string') return composed;
  if (composed.kind === 'PdText') return composed;
  // For `code` or a flattened nested link, wrap in a PdText so the type holds.
  return { kind: 'PdText', children: [composed] };
}

/** Coerce an inline child into a PdNode for table cells. */
function toPdNodeFromInlineChild(child: InlineChild): PdNode {
  if (typeof child === 'string') {
    return { kind: 'PdText', children: [child] };
  }
  return child;
}
