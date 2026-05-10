/**
 * Four spec-mandated tools:
 *
 *   - doc_validate         — runs intersection-schema validator (core/validate)
 *   - doc_render           — surface ∈ {web, native, email, tui, text}
 *   - doc_explain_block    — block-type contract + per-surface explanation
 *   - doc_suggest_fixes    — rule-based AST repair
 *
 * Each tool is exported as a standalone async function so unit tests exercise
 * them without going through the stdio transport. The MCP server (server.ts)
 * wraps them into MCP tool calls.
 *
 * Backends are loaded lazily so the cold-start cost stays tight — only the
 * surface actually requested is imported.
 */
import type {
  BlockType,
  PortableDoc,
  Surface,
  ValidationIssue,
} from '@portable-doc/core';
import { blockContracts, validateDoc } from '@portable-doc/core';
import { composeDocument } from '@portable-doc/primitives';
import { suggestFixes } from './suggestFixes.js';

// ---------------------------------------------------------------------------
// Tool: doc_validate
// ---------------------------------------------------------------------------

export interface DocValidateInput {
  document: unknown;
}

export interface DocValidateResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function docValidate(input: DocValidateInput): DocValidateResult {
  const issues = validateDoc(input.document);
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Tool: doc_render
// ---------------------------------------------------------------------------

export type RenderSurface = Surface;

export interface DocRenderInput {
  document: PortableDoc;
  surface: RenderSurface;
}

export interface DocRenderResult {
  surface: RenderSurface;
  output: string;
}

export async function docRender(input: DocRenderInput): Promise<DocRenderResult> {
  const tree = composeDocument(input.document);

  switch (input.surface) {
    case 'web': {
      const { renderHtml } = await import('@portable-doc/backend-web/static');
      return { surface: 'web', output: renderHtml(tree) };
    }
    case 'email': {
      const { renderEmail } = await import('@portable-doc/backend-email');
      return { surface: 'email', output: await renderEmail(tree) };
    }
    case 'tui': {
      const { renderInk } = await import('@portable-doc/backend-ink');
      return { surface: 'tui', output: renderInk(tree) };
    }
    case 'text': {
      // Plain text per spec §10 = Ink in mono mode (no ANSI, no OSC-8).
      const { renderInk } = await import('@portable-doc/backend-ink');
      return {
        surface: 'text',
        output: renderInk(tree, { colorDepth: 'mono', hyperlinks: false }),
      };
    }
    case 'native': {
      // Server emits the Pd-tree; in-app code materializes via backend-native.
      return { surface: 'native', output: JSON.stringify(tree, null, 2) };
    }
    default: {
      const _never: never = input.surface;
      void _never;
      throw new Error(`Unsupported surface: ${String(input.surface)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool: doc_explain_block
// ---------------------------------------------------------------------------

export interface DocExplainBlockInput {
  blockType: string;
}

export interface DocExplainBlockResult {
  blockType: BlockType;
  contract: Record<Surface, 'native' | 'unsupported'>;
  explanation: Record<Surface, string>;
}

const BLOCK_TYPES: ReadonlySet<BlockType> = new Set([
  'heading',
  'paragraph',
  'list',
  'callout',
  'action',
  'section',
  'divider',
  'code',
  'image',
  'table',
]);

const EXPLANATIONS: Record<BlockType, Record<Surface, string>> = {
  heading: {
    web: 'Inline-styled <h1>/<h2>/<h3> with system-font, doc-typography sizes.',
    native: 'RN <Text> with weight/size mirroring the chosen level.',
    email: 'React-Email Heading wrapped in MSO-safe <table> outer.',
    tui: 'Bold ANSI line, level-1 underlined with ─, level-2/3 bare bold.',
    text: 'Plain bold-stripped line; level prefix lost because ANSI is off.',
  },
  paragraph: {
    web: 'Inline-styled <div> with body font + line-height.',
    native: 'RN <Text> stack honoring inline marks (strong, em, code, link).',
    email: 'React-Email Text with explicit color + line-height for clients.',
    tui: 'Wrapped to width, OSC-8 hyperlinks where supported.',
    text: 'Wrapped to width, hyperlinks rendered as visible URLs in parens.',
  },
  list: {
    web: 'Inline-styled <ul>/<ol> with manual margins.',
    native: 'RN <View> stack of bullet/numbered <Text> rows.',
    email: 'React-Email <ul>/<ol> tuned for Outlook spacing quirks.',
    tui: 'Bullet (•) or 1./2./3. prefix, items wrapped to width.',
    text: 'Bullet/number prefix + wrapped item content, no styling.',
  },
  callout: {
    web: 'Tinted box with tone-mapped bg/border/glyph (inline styles).',
    native: 'RN <View> with tone bg/border, glyph + title row, body text.',
    email: 'Colored <table> shell with tone glyph + bold title.',
    tui: 'Border-framed block with tone glyph and ANSI tone color.',
    text: 'Border-framed block; tone color stripped, glyph still present.',
  },
  action: {
    web: 'Inline-styled <a role="button"> with brand bg for primary, outline for secondary.',
    native: 'RN <Pressable> with brand styling and hit target.',
    email: 'React-Email <Button>; Outlook gets a VML rounded-rect fallback.',
    tui: 'Bracketed label, OSC-8 hyperlink to href, brand color for primary.',
    text: '[Label](https://...) — visible URL inline, no color or hyperlink.',
  },
  section: {
    web: 'Inline-styled <section> with optional <h2> title and child blocks.',
    native: 'RN <View> stack with optional <Text> title.',
    email: 'React-Email <Section> with optional title heading.',
    tui: 'Title underlined, child blocks rendered with section-local indent.',
    text: 'Title with ─── underline, child blocks rendered plainly.',
  },
  divider: {
    web: 'Inline-styled <hr> with border-top in --rule color.',
    native: 'RN <View> with 1-px border-top-color rule.',
    email: '<hr> with border-color attribute and Outlook border fallback.',
    tui: 'Full-width ─ rule (or ═ for double).',
    text: 'Full-width - rule.',
  },
  code: {
    web: 'Inline-styled <pre><code> with mono font and surface-bg.',
    native: 'RN <Text> in mono, fixed bg, no syntax highlighting.',
    email: '<pre><code> wrapped in safe table; line-length capped at 60 cols.',
    tui: 'Border-framed mono block; lines truncated to 60 cols (per validator rule).',
    text: 'Mono lines, no border, no color.',
  },
  image: {
    web: 'Inline-styled <img> with alt + width/height; plain HTML.',
    native: 'RN <Image> with source URI and intrinsic size.',
    email: 'unsupported — falls back to plain alt text where the renderer requires output.',
    tui: 'unsupported — falls back to plain alt text.',
    text: 'unsupported — falls back to plain alt text.',
  },
  table: {
    web: 'Inline-styled <table> with row × cell <td>; mono-spaced.',
    native: 'RN <View> grid with row + column gaps to approximate a table.',
    email: 'unsupported — falls back to plain text rows where rendering is required.',
    tui: 'unsupported — falls back to plain text rows.',
    text: 'unsupported — falls back to plain text rows.',
  },
};

export function docExplainBlock(input: DocExplainBlockInput): DocExplainBlockResult {
  if (!BLOCK_TYPES.has(input.blockType as BlockType)) {
    throw new Error(
      `Unknown blockType "${input.blockType}". Expected one of: ${[...BLOCK_TYPES].join(', ')}.`,
    );
  }
  const blockType = input.blockType as BlockType;
  return {
    blockType,
    contract: blockContracts[blockType],
    explanation: EXPLANATIONS[blockType],
  };
}

// ---------------------------------------------------------------------------
// Tool: doc_suggest_fixes
// ---------------------------------------------------------------------------

export interface DocSuggestFixesInput {
  document: PortableDoc;
}

export interface DocSuggestFixesResult {
  fixedDocument: PortableDoc;
  changes: string[];
}

export function docSuggestFixes(input: DocSuggestFixesInput): DocSuggestFixesResult {
  return suggestFixes(input.document);
}

// ---------------------------------------------------------------------------
// Tool registry — used by the MCP server to advertise tools + dispatch calls.
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  'doc_validate',
  'doc_render',
  'doc_explain_block',
  'doc_suggest_fixes',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: 'doc_validate',
    description:
      'Validate a PortableDoc against the intersection schema (prop allowlist + content constraints + URL safety).',
    inputSchema: {
      type: 'object',
      properties: {
        document: { type: 'object', description: 'PortableDoc AST to validate.' },
      },
      required: ['document'],
      additionalProperties: false,
    },
  },
  {
    name: 'doc_render',
    description:
      'Render a PortableDoc to one of: web (slim HTML), native (Pd-tree JSON), email (React Email HTML), tui (ANSI), text (plain).',
    inputSchema: {
      type: 'object',
      properties: {
        document: { type: 'object', description: 'PortableDoc AST to render.' },
        surface: {
          type: 'string',
          enum: ['web', 'native', 'email', 'tui', 'text'],
          description: 'Target surface.',
        },
      },
      required: ['document', 'surface'],
      additionalProperties: false,
    },
  },
  {
    name: 'doc_explain_block',
    description:
      'Return the surface-support contract and per-surface rendering explanation for a single block type.',
    inputSchema: {
      type: 'object',
      properties: {
        blockType: {
          type: 'string',
          enum: [
            'heading',
            'paragraph',
            'list',
            'callout',
            'action',
            'section',
            'divider',
            'code',
            'image',
            'table',
          ],
        },
      },
      required: ['blockType'],
      additionalProperties: false,
    },
  },
  {
    name: 'doc_suggest_fixes',
    description:
      'Apply rule-based fixes (http→https, untitled headings, action-label trimming, empty-paragraph drop) and return the patched document plus a change log.',
    inputSchema: {
      type: 'object',
      properties: {
        document: { type: 'object', description: 'PortableDoc AST to patch.' },
      },
      required: ['document'],
      additionalProperties: false,
    },
  },
];

/** Dispatch a tool call by name. Returns a JSON-serializable result. */
export async function dispatchTool(name: string, args: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'doc_validate':
      return docValidate({ document: a['document'] });
    case 'doc_render':
      return docRender({
        document: a['document'] as PortableDoc,
        surface: a['surface'] as RenderSurface,
      });
    case 'doc_explain_block':
      return docExplainBlock({ blockType: String(a['blockType']) });
    case 'doc_suggest_fixes':
      return docSuggestFixes({ document: a['document'] as PortableDoc });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
