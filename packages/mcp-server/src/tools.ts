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
  Block,
  BlockType,
  DocPatchOp,
  PortableDoc,
  Surface,
  ValidationIssue,
} from '@portable-doc/core';
import { applyDocPatch, blockContracts, validateBlock, validateDoc } from '@portable-doc/core';
import { composeDocument } from '@portable-doc/primitives';
import { suggestFixes } from './suggestFixes.js';
import {
  forwardOp,
  resolveBarkparkTarget,
  type BarkparkForwardResult,
} from './barkpark.js';

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
// Tool: doc_append_block
// ---------------------------------------------------------------------------

/**
 * Thrown by `docAppendBlock` when the incoming block fails draft validation or
 * the append cannot be applied. The `message` is a JSON payload so the
 * structured issues survive the MCP server's `err.message` text channel
 * (server.ts forwards only the message string on `isError`).
 */
export class DocAppendBlockError extends Error {
  readonly issues: ValidationIssue[];
  readonly patchError?: string;

  constructor(message: string, issues: ValidationIssue[], patchError?: string) {
    super(
      JSON.stringify({
        error: message,
        ...(patchError ? { patchError } : {}),
        issues,
      }),
    );
    this.name = 'DocAppendBlockError';
    this.issues = issues;
    this.patchError = patchError;
  }
}

export interface DocAppendBlockInput {
  /** The current document the block is appended to. */
  document: PortableDoc;
  /** The block to append — MAY be a draft (partial) block. */
  block: Block;
  /**
   * Optional Barkpark paper slug. When set AND the `BARKPARK_INGEST_URL` /
   * `BARKPARK_INGEST_TOKEN` env vars are configured, the applied
   * `append-block` op is forwarded to that paper's Barkpark block-ops endpoint
   * so it streams into the live LiveView paper. Omit it (or leave the env
   * unset) for local-only behaviour — forwarding is purely additive.
   */
  barkparkSlug?: string;
  /**
   * Injectable `fetch` for tests so the network can be stubbed. Defaults to
   * the global `fetch`. Not exposed as an MCP tool input.
   */
  fetchImpl?: typeof fetch;
}

export interface DocAppendBlockResult {
  /** The document with `block` appended as the last top-level block. */
  document: PortableDoc;
  /**
   * Inline-styled HTML fragment for just the appended block (U3), or `null`
   * when the block is too incomplete to render (a draft missing a required
   * content field — e.g. `code.value`, `list.items`, `paragraph.content`,
   * `heading.text`). The append still succeeds and `document` is returned; the
   * caller can re-render once the draft fills in. The render path never throws
   * out of this tool.
   */
  fragment: string | null;
  /**
   * The outcome of forwarding the applied op to a live Barkpark paper. Present
   * only when forwarding was attempted or explicitly skipped:
   *   - omitted          → no Barkpark target was configured at all (slug
   *                        absent); pure local behaviour, no network.
   *   - `not-configured` → a slug was passed but the ingest URL/token env was
   *                        missing, so nothing was forwarded.
   *   - `forwarded:true` → the op streamed into the live paper.
   *   - `error`          → forwarding failed (network/non-2xx). The LOCAL
   *                        append still succeeded; this is informational only.
   */
  forward?: BarkparkForwardResult;
}

/**
 * Append a single block to the top of a PortableDoc's block list.
 *
 *   1. Validate the incoming block in DRAFT mode (U2 `validateBlock`). Only
 *      `severity:'error'` issues block the append — a half-finished draft block
 *      (missing required fields) is tolerated; allowlist / url-safety /
 *      content / variant violations are HARD and reject. On any error issue we
 *      throw {@link DocAppendBlockError} carrying the issues.
 *   2. Apply an `append-block` {@link DocPatchOp} via `applyDocPatch` (U1).
 *      `applyDocPatch` is pure and never throws; a failed apply (e.g. a
 *      duplicate id) surfaces as a structured error here.
 *   3. Render the appended block to an HTML fragment (U3 `renderBlockHtml`) so
 *      a caller can stream just the new block. A valid-but-incomplete draft
 *      block (missing a required content field) can't be rendered yet — the
 *      fragment degrades to `null` and the append still succeeds.
 *   4. OPTIONALLY forward the applied `append-block` op to a live Barkpark
 *      paper. This happens only after the local apply has succeeded AND a
 *      Barkpark target is fully configured (slug + ingest URL + token). With
 *      no target the tool behaves exactly as before — no network. A
 *      forwarding failure is logged and surfaced in `result.forward` but never
 *      fails the local append (see {@link forwardOp}).
 */
export async function docAppendBlock(
  input: DocAppendBlockInput,
): Promise<DocAppendBlockResult> {
  const issues = validateBlock(input.block, { mode: 'draft' });
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new DocAppendBlockError('block failed draft validation', errors);
  }

  const op: DocPatchOp = { op: 'append-block', block: input.block };
  const result = applyDocPatch(input.document, op);
  if (!result.applied) {
    throw new DocAppendBlockError(
      `append-block could not be applied: ${result.error ?? 'unknown'}`,
      [],
      result.error,
    );
  }

  const { renderBlockHtml } = await import('@portable-doc/backend-web/static');
  // A draft block can be valid (no error-severity issues) yet still be missing
  // a required content field the composer/renderer dereferences (code.value,
  // list.items, paragraph.content, heading.text, …). Rendering such a partial
  // block throws a raw TypeError out of the composer. The append has already
  // succeeded, so we keep the updated document and degrade the fragment to
  // `null` rather than letting an internal renderer crash escape the tool.
  let fragment: string | null;
  try {
    fragment = renderBlockHtml(input.block);
  } catch {
    fragment = null;
  }

  // Optional, additive, defensive: forward the applied op to a live Barkpark
  // paper only when a slug was given. With no slug at all we return exactly
  // what we always have (no `forward` field, no network). When a slug is given
  // but the ingest env is unset we report `not-configured` rather than guess.
  const out: DocAppendBlockResult = { document: result.doc, fragment };
  if (input.barkparkSlug !== undefined) {
    const target = resolveBarkparkTarget(input.barkparkSlug);
    out.forward = target
      ? await forwardOp(target, op, input.fetchImpl)
      : { forwarded: false, reason: 'not-configured' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tool registry — used by the MCP server to advertise tools + dispatch calls.
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  'doc_validate',
  'doc_render',
  'doc_explain_block',
  'doc_suggest_fixes',
  'doc_append_block',
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
  {
    name: 'doc_append_block',
    description:
      'Append a single block (may be a draft/partial block) to the end of a PortableDoc. Validates the block in draft mode; on an error-severity issue returns a structured error carrying the issues. Returns the updated document plus an inline-styled HTML fragment for just the appended block so callers can stream it. Optionally, when `barkpark_slug` is set and the BARKPARK_INGEST_URL / BARKPARK_INGEST_TOKEN env vars are configured, forwards the applied op to that live Barkpark paper so the block streams in with no reload; a forwarding failure is reported but never fails the local append.',
    inputSchema: {
      type: 'object',
      properties: {
        document: {
          type: 'object',
          description: 'Current PortableDoc AST the block is appended to.',
        },
        block: {
          type: 'object',
          description: 'The block to append. MAY be a draft (partial) block.',
        },
        barkpark_slug: {
          type: 'string',
          description:
            'Optional. Slug of a live Barkpark paper to stream the appended block into. Requires BARKPARK_INGEST_URL + BARKPARK_INGEST_TOKEN env to be set; otherwise forwarding is skipped (reported as not-configured). Omit for local-only behaviour.',
        },
      },
      required: ['document', 'block'],
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
    case 'doc_append_block':
      return docAppendBlock({
        document: a['document'] as PortableDoc,
        block: a['block'] as Block,
        barkparkSlug:
          a['barkpark_slug'] === undefined ? undefined : String(a['barkpark_slug']),
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
