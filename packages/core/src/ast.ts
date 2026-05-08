/**
 * AST shape for portable documents.
 *
 * One document, many surfaces. Every block must be representable on every
 * declared surface — except `image` and `table`, which are escape hatches
 * locked to `surfaces: ['web','native']`.
 */

export type Surface = 'web' | 'native' | 'email' | 'tui' | 'text';

/** Binary support per spec §9 grill: a backend either renders the block natively or refuses. */
export type SurfaceSupport = 'native' | 'unsupported';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type BorderStyle = 'single' | 'double' | 'bold';

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'callout'
  | 'action'
  | 'section'
  | 'divider'
  | 'code'
  | 'image'
  | 'table';

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export interface BlockBase {
  id: string;
  type: BlockType;
  surfaces?: Surface[];
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  level: 1 | 2 | 3;
  text: string;
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph';
  content: InlineNode[];
}

export interface ListBlock extends BlockBase {
  type: 'list';
  ordered?: boolean;
  items: InlineNode[][];
}

export interface CalloutBlock extends BlockBase {
  type: 'callout';
  tone: Tone;
  title?: string;
  content: InlineNode[];
}

export interface ActionBlock extends BlockBase {
  type: 'action';
  label: string;
  href: string;
  priority: 'primary' | 'secondary';
}

export interface SectionBlock extends BlockBase {
  type: 'section';
  title?: string;
  blocks: Block[];
}

export interface DividerBlock extends BlockBase {
  type: 'divider';
}

export interface CodeBlock extends BlockBase {
  type: 'code';
  lang?: string;
  value: string;
}

/** Escape-hatch block; surfaces is type-narrowed to ['web','native']. */
export interface ImageBlock extends BlockBase {
  type: 'image';
  src: string;
  alt: string;
  width?: number;
  height?: number;
  surfaces: ['web', 'native'];
}

/** Escape-hatch block; surfaces is type-narrowed to ['web','native']. */
export interface TableBlock extends BlockBase {
  type: 'table';
  rows: InlineNode[][][];
  surfaces: ['web', 'native'];
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CalloutBlock
  | ActionBlock
  | SectionBlock
  | DividerBlock
  | CodeBlock
  | ImageBlock
  | TableBlock;

export interface PortableDoc {
  version: 1;
  title?: string;
  preview?: string;
  blocks: Block[];
}
