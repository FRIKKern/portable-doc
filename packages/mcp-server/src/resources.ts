/**
 * Resource handlers for the five spec-mandated URIs.
 *
 * Each entry returns the MCP `ReadResourceResult` content shape:
 *   { contents: [{ uri, mimeType: 'application/json', text: <stringified JSON> }] }
 *
 * Read-only — these are informational artifacts the client uses to learn the
 * AST shape, surface support matrix, default tokens, and canonical examples.
 *
 * Examples are loaded from `examples/*.json` at the repo root (the canonical
 * data location after the v0.2.1 fixtures-package collapse). The files are
 * resolved relative to this source so the MCP binary works from any cwd.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockContracts, defaultTokens } from '@portable-doc/core';

const here = dirname(fileURLToPath(import.meta.url));
// packages/mcp-server/src/resources.ts → repo root is ../../..
const repoRoot = resolve(here, '../../..');

function loadExampleJson(name: 'welcome' | 'incident'): string {
  return readFileSync(resolve(repoRoot, 'examples', `${name}.json`), 'utf8');
}

export const RESOURCE_URIS = [
  'portable-doc://schema/v1',
  'portable-doc://surface-contracts',
  'portable-doc://tokens/default',
  'portable-doc://examples/welcome',
  'portable-doc://examples/incident',
] as const;

export type ResourceUri = (typeof RESOURCE_URIS)[number];

export interface ResourceListEntry {
  uri: ResourceUri;
  name: string;
  description: string;
  mimeType: 'application/json';
}

export const RESOURCE_LIST: ResourceListEntry[] = [
  {
    uri: 'portable-doc://schema/v1',
    name: 'PortableDoc schema (v1)',
    description: 'Hand-written shape description naming every block type and its required fields.',
    mimeType: 'application/json',
  },
  {
    uri: 'portable-doc://surface-contracts',
    name: 'Block × Surface support matrix',
    description: 'Binary native|unsupported map per spec §9 — image and table are native+web only.',
    mimeType: 'application/json',
  },
  {
    uri: 'portable-doc://tokens/default',
    name: 'Default design tokens',
    description: 'Color, space, borderStyle, typography — the intersection-safe palette.',
    mimeType: 'application/json',
  },
  {
    uri: 'portable-doc://examples/welcome',
    name: 'Example: welcome',
    description: 'Polished onboarding fixture covering 7 of the 10 block types.',
    mimeType: 'application/json',
  },
  {
    uri: 'portable-doc://examples/incident',
    name: 'Example: incident',
    description: 'Incident-report fixture covering all 10 block types including image + table.',
    mimeType: 'application/json',
  },
];

/**
 * Hand-written shape description for the AST. The resource is informational
 * (clients don't validate against it — that's `doc_validate`'s job), so it
 * stays simple: block-type list, inline-mark list, per-block field shape.
 */
const schemaV1 = {
  version: 1,
  description:
    'PortableDoc — one-AST, many-surfaces. Validate via doc_validate; render via doc_render.',
  blockTypes: [
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
  inlineMarks: ['text', 'strong', 'em', 'code', 'link'],
  surfaces: ['web', 'native', 'email', 'tui', 'text'],
  tones: ['success', 'warning', 'danger', 'info', 'neutral'],
  shapes: {
    document: {
      version: '1',
      title: 'string?',
      preview: 'string?',
      blocks: 'Block[]',
    },
    blockBase: { id: 'string (non-empty, unique)', type: 'BlockType', surfaces: 'Surface[]?' },
    heading: { level: '1 | 2 | 3', text: 'string (≤ 80 chars)' },
    paragraph: { content: 'InlineNode[]' },
    list: { ordered: 'boolean?', items: 'InlineNode[][] (each ≤ 200 chars)' },
    callout: { tone: 'Tone', title: 'string?', content: 'InlineNode[]' },
    action: { label: 'string (1–48 chars)', href: 'http|https|mailto|tel', priority: "'primary'|'secondary'" },
    section: { title: 'string?', blocks: 'Block[]' },
    divider: {},
    code: { lang: 'string?', value: 'string (each line ≤ 60 cols)' },
    image: { src: 'http|https|mailto|tel', alt: 'string', width: 'number?', height: 'number?', surfaces: "['web','native']" },
    table: { rows: 'InlineNode[][][]', surfaces: "['web','native']" },
    inlineNode: {
      text: { type: "'text'", value: 'string' },
      strong: { type: "'strong'", children: 'InlineNode[]' },
      em: { type: "'em'", children: 'InlineNode[]' },
      code: { type: "'code'", value: 'string' },
      link: { type: "'link'", href: 'http|https|mailto|tel', children: 'InlineNode[]' },
    },
  },
};

/** Read a resource by URI. Throws on unknown URI. */
export function readResource(uri: string): {
  contents: Array<{ uri: string; mimeType: 'application/json'; text: string }>;
} {
  const text = resourceJsonByUri(uri);
  return {
    contents: [{ uri, mimeType: 'application/json', text }],
  };
}

function resourceJsonByUri(uri: string): string {
  switch (uri) {
    case 'portable-doc://schema/v1':
      return JSON.stringify(schemaV1, null, 2);
    case 'portable-doc://surface-contracts':
      return JSON.stringify(blockContracts, null, 2);
    case 'portable-doc://tokens/default':
      return JSON.stringify(defaultTokens, null, 2);
    case 'portable-doc://examples/welcome':
      return JSON.stringify(JSON.parse(loadExampleJson('welcome')), null, 2);
    case 'portable-doc://examples/incident':
      return JSON.stringify(JSON.parse(loadExampleJson('incident')), null, 2);
    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
}
