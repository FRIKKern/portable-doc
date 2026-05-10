/**
 * Four rule classes per spec §7 + §T2 (variant catalog):
 *
 *   1. prop-allowlist     — reject any free-form style prop the weakest
 *                            backend can't honor (borderRadius, opacity,
 *                            boxShadow, transform, animation, gradient,
 *                            flex, flexWrap, justifyContent space-between,
 *                            alignSelf). Allow only the intersection-safe
 *                            shape.
 *   2. content-constraint — code line ≤ 60 cols, callout tone ∈ 16-safe,
 *                            list item ≤ 200 chars, heading.text ≤ 80,
 *                            unique non-empty ids, action.label 1–48,
 *                            image/table surfaces fixed to ['web','native'].
 *   3. url-safety         — every href-bearing field accepts only
 *                            http / https / mailto / tel.
 *   4. variant-allowlist  — block.variant axes/values must match
 *                            VARIANT_CATALOG[block.type]; blocks without a
 *                            catalog entry (heading/paragraph/list/divider/
 *                            image/table) may not declare variants at all.
 *
 * `validateDoc` never throws. It returns a (possibly empty) array.
 */

import type { Block, InlineNode, PortableDoc, Surface } from './ast.js';
import { toneNames } from './tokens.js';
import { portableDocSchema } from './schemas.js';
import { VARIANT_CATALOG } from '@portable-doc/variants';

export type RuleId =
  | 'prop-allowlist'
  | 'content-constraint'
  | 'url-safety'
  | 'variant-allowlist';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  blockId?: string;
  surface?: Surface;
  rule: RuleId;
  message: string;
}

// ---------------------------------------------------------------------------
// Rule 1: prop allowlist
// ---------------------------------------------------------------------------

const FORBIDDEN_PROPS: ReadonlySet<string> = new Set([
  'borderRadius',
  'opacity',
  'boxShadow',
  'shadow',
  'transform',
  'animation',
  'transition',
  'gradient',
  'background', // CSS shorthand permits gradients — only `backgroundColor` is allowed
  'flex',
  'flexWrap',
  'flexBasis',
  'flexGrow',
  'flexShrink',
  'alignSelf',
  'order',
  'gridArea',
  'gridTemplate',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gap',
  'rowGap',
  'columnGap',
  'filter',
  'backdropFilter',
  'mixBlendMode',
  'clipPath',
  'mask',
]);

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_BORDER_STYLES = new Set(['single', 'double', 'bold']);
const ALLOWED_FLEX_DIRECTION = new Set(['row', 'column']);
const ALLOWED_VERTICAL_ALIGN = new Set(['top', 'middle', 'bottom']);
const ALLOWED_JUSTIFY_CONTENT = new Set(['flex-start', 'flex-end', 'center']); // explicitly NOT 'space-between'

interface PropCheck {
  prop: string;
  value: unknown;
  ok: boolean;
  reason?: string;
}

function checkAllowedProp(prop: string, value: unknown): PropCheck {
  if (FORBIDDEN_PROPS.has(prop)) {
    return { prop, value, ok: false, reason: `prop "${prop}" is not in the intersection-safe allowlist` };
  }
  switch (prop) {
    case 'flexDirection':
      return typeof value === 'string' && ALLOWED_FLEX_DIRECTION.has(value)
        ? { prop, value, ok: true }
        : { prop, value, ok: false, reason: `flexDirection must be 'row' or 'column'` };
    case 'borderStyle':
      return typeof value === 'string' && ALLOWED_BORDER_STYLES.has(value)
        ? { prop, value, ok: true }
        : { prop, value, ok: false, reason: `borderStyle must be 'single', 'double', or 'bold'` };
    case 'verticalAlign':
      return typeof value === 'string' && ALLOWED_VERTICAL_ALIGN.has(value)
        ? { prop, value, ok: true }
        : { prop, value, ok: false, reason: `verticalAlign must be 'top', 'middle', or 'bottom'` };
    case 'justifyContent':
      if (typeof value !== 'string') {
        return { prop, value, ok: false, reason: `justifyContent must be a string` };
      }
      if (value === 'space-between') {
        return { prop, value, ok: false, reason: `justifyContent: 'space-between' is not supported (TUI/email cannot honor)` };
      }
      return ALLOWED_JUSTIFY_CONTENT.has(value)
        ? { prop, value, ok: true }
        : { prop, value, ok: false, reason: `justifyContent must be 'flex-start', 'flex-end', or 'center'` };
    case 'backgroundColor':
    case 'borderColor':
    case 'color':
      return typeof value === 'string' && HEX6.test(value)
        ? { prop, value, ok: true }
        : { prop, value, ok: false, reason: `${prop} must be a #rrggbb hex value` };
    case 'width':
    case 'height':
    case 'padding':
    case 'paddingTop':
    case 'paddingRight':
    case 'paddingBottom':
    case 'paddingLeft':
    case 'margin':
    case 'marginTop':
    case 'marginRight':
    case 'marginBottom':
    case 'marginLeft':
    case 'borderWidth':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? { prop, value, ok: true }
        : { prop, value, ok: false, reason: `${prop} must be a non-negative finite number` };
    default:
      // Unknown prop on a block — treat as a leak, reject.
      return { prop, value, ok: false, reason: `unknown style prop "${prop}"` };
  }
}

/**
 * Recognised AST keys per block type. Anything outside this set is treated as
 * a leaked free-form style prop and run through the prop allowlist.
 */
const KNOWN_BLOCK_KEYS: Record<string, ReadonlySet<string>> = {
  heading: new Set(['id', 'type', 'surfaces', 'variant', 'level', 'text']),
  paragraph: new Set(['id', 'type', 'surfaces', 'variant', 'content']),
  list: new Set(['id', 'type', 'surfaces', 'variant', 'ordered', 'items']),
  callout: new Set(['id', 'type', 'surfaces', 'variant', 'tone', 'title', 'content']),
  action: new Set(['id', 'type', 'surfaces', 'variant', 'label', 'href', 'priority']),
  section: new Set(['id', 'type', 'surfaces', 'variant', 'title', 'blocks']),
  divider: new Set(['id', 'type', 'surfaces', 'variant']),
  code: new Set(['id', 'type', 'surfaces', 'variant', 'lang', 'value']),
  image: new Set(['id', 'type', 'surfaces', 'variant', 'src', 'alt', 'width', 'height']),
  table: new Set(['id', 'type', 'surfaces', 'variant', 'rows']),
};

function walkBlockForPropLeaks(block: Block, issues: ValidationIssue[]): void {
  const known = KNOWN_BLOCK_KEYS[block.type];
  if (!known) return;
  for (const key of Object.keys(block)) {
    if (known.has(key)) continue;
    // Special-case image's optional width/height which already live in known set.
    const check = checkAllowedProp(key, (block as unknown as Record<string, unknown>)[key]);
    if (!check.ok) {
      issues.push({
        severity: 'error',
        blockId: block.id,
        rule: 'prop-allowlist',
        message: check.reason ?? `prop "${key}" is not allowed`,
      });
    }
  }
  if (block.type === 'section') {
    for (const child of block.blocks) {
      walkBlockForPropLeaks(child, issues);
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 2: content constraints
// ---------------------------------------------------------------------------

const MAX_CODE_LINE = 60;
const MAX_HEADING_LEN = 80;
const MAX_LIST_ITEM_LEN = 200;
const MAX_ACTION_LABEL_LEN = 48;

function flattenInline(nodes: InlineNode[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += n.value;
        break;
      case 'code':
        out += n.value;
        break;
      case 'strong':
      case 'em':
      case 'link':
        out += flattenInline(n.children);
        break;
    }
  }
  return out;
}

function checkBlockContent(block: Block, issues: ValidationIssue[]): void {
  // id presence
  if (typeof block.id !== 'string' || block.id.length === 0) {
    issues.push({
      severity: 'error',
      blockId: typeof block.id === 'string' ? block.id : undefined,
      rule: 'content-constraint',
      message: `block id must be a non-empty string`,
    });
  }

  switch (block.type) {
    case 'heading':
      if (block.text.length > MAX_HEADING_LEN) {
        issues.push({
          severity: 'error',
          blockId: block.id,
          rule: 'content-constraint',
          message: `heading.text is ${block.text.length} chars (max ${MAX_HEADING_LEN})`,
        });
      }
      break;

    case 'list':
      block.items.forEach((item, idx) => {
        const flat = flattenInline(item);
        if (flat.length > MAX_LIST_ITEM_LEN) {
          issues.push({
            severity: 'error',
            blockId: block.id,
            rule: 'content-constraint',
            message: `list item ${idx} is ${flat.length} chars (max ${MAX_LIST_ITEM_LEN})`,
          });
        }
      });
      break;

    case 'callout':
      if (!(toneNames as readonly string[]).includes(block.tone)) {
        issues.push({
          severity: 'error',
          blockId: block.id,
          rule: 'content-constraint',
          message: `callout.tone "${String(block.tone)}" is not in the 16-safe palette (success|warning|danger|info|neutral)`,
        });
      }
      break;

    case 'action':
      if (block.label.length === 0 || block.label.length > MAX_ACTION_LABEL_LEN) {
        issues.push({
          severity: 'error',
          blockId: block.id,
          rule: 'content-constraint',
          message: `action.label must be 1-${MAX_ACTION_LABEL_LEN} chars (got ${block.label.length})`,
        });
      }
      break;

    case 'code': {
      const lines = block.value.split('\n');
      lines.forEach((line, idx) => {
        if (line.length > MAX_CODE_LINE) {
          issues.push({
            severity: 'error',
            blockId: block.id,
            rule: 'content-constraint',
            message: `code line ${idx + 1} is ${line.length} cols (max ${MAX_CODE_LINE})`,
          });
        }
      });
      break;
    }

    case 'image':
    case 'table':
      if (
        !Array.isArray(block.surfaces) ||
        block.surfaces.length !== 2 ||
        block.surfaces[0] !== 'web' ||
        block.surfaces[1] !== 'native'
      ) {
        issues.push({
          severity: 'error',
          blockId: block.id,
          rule: 'content-constraint',
          message: `${block.type} must declare surfaces: ['web','native']`,
        });
      }
      break;

    case 'section':
      for (const child of block.blocks) {
        checkBlockContent(child, issues);
      }
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Rule 3: URL safety
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

function checkUrl(href: string, blockId: string, issues: ValidationIssue[], context: string): void {
  if (typeof href !== 'string' || href.length === 0) {
    issues.push({
      severity: 'error',
      blockId,
      rule: 'url-safety',
      message: `${context} must be a non-empty string`,
    });
    return;
  }
  const m = href.match(SCHEME_RE);
  if (!m) {
    issues.push({
      severity: 'error',
      blockId,
      rule: 'url-safety',
      message: `${context} "${href}" has no scheme — must be http / https / mailto / tel`,
    });
    return;
  }
  const scheme = m[1]!.toLowerCase();
  if (!ALLOWED_SCHEMES.has(scheme)) {
    issues.push({
      severity: 'error',
      blockId,
      rule: 'url-safety',
      message: `${context} "${href}" uses scheme "${scheme}" — only http / https / mailto / tel allowed`,
    });
  }
}

function walkInlineForUrls(nodes: InlineNode[], blockId: string, issues: ValidationIssue[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'link':
        checkUrl(n.href, blockId, issues, 'link.href');
        walkInlineForUrls(n.children, blockId, issues);
        break;
      case 'strong':
      case 'em':
        walkInlineForUrls(n.children, blockId, issues);
        break;
      case 'text':
      case 'code':
        break;
    }
  }
}

function walkBlockForUrls(block: Block, issues: ValidationIssue[]): void {
  switch (block.type) {
    case 'paragraph':
      walkInlineForUrls(block.content, block.id, issues);
      break;
    case 'list':
      for (const item of block.items) walkInlineForUrls(item, block.id, issues);
      break;
    case 'callout':
      walkInlineForUrls(block.content, block.id, issues);
      break;
    case 'action':
      checkUrl(block.href, block.id, issues, 'action.href');
      break;
    case 'image':
      checkUrl(block.src, block.id, issues, 'image.src');
      break;
    case 'table':
      for (const row of block.rows) {
        for (const cell of row) {
          walkInlineForUrls(cell, block.id, issues);
        }
      }
      break;
    case 'section':
      for (const child of block.blocks) walkBlockForUrls(child, issues);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Rule 4: variant allowlist
// ---------------------------------------------------------------------------

function checkVariants(block: Block, issues: ValidationIssue[]): void {
  const variant = block.variant;
  // Recurse into sections regardless — children may carry their own variants.
  if (block.type === 'section') {
    for (const child of block.blocks) checkVariants(child, issues);
  }
  if (variant === undefined) return;
  if (typeof variant !== 'object' || variant === null) return;

  const keys = Object.keys(variant);
  if (keys.length === 0) return; // empty {} — no axes asserted, nothing to check.

  const schema = VARIANT_CATALOG[block.type];
  if (schema === undefined) {
    issues.push({
      severity: 'error',
      blockId: block.id,
      rule: 'variant-allowlist',
      message: `block type '${block.type}' does not accept variants`,
    });
    return;
  }

  for (const axis of keys) {
    const allowed = schema.axes[axis];
    if (allowed === undefined) {
      issues.push({
        severity: 'error',
        blockId: block.id,
        rule: 'variant-allowlist',
        message: `unknown variant axis '${axis}' on '${block.type}'`,
      });
      continue;
    }
    const value = variant[axis];
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      issues.push({
        severity: 'error',
        blockId: block.id,
        rule: 'variant-allowlist',
        message: `unknown variant value '${String(value)}' for axis '${axis}' on '${block.type}'`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Unique-id pass
// ---------------------------------------------------------------------------

function collectIds(block: Block, seen: Map<string, number>, issues: ValidationIssue[]): void {
  const id = block.id;
  if (typeof id === 'string' && id.length > 0) {
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count === 2) {
      // First time we see the duplicate — emit once, with the duplicated id.
      issues.push({
        severity: 'error',
        blockId: id,
        rule: 'content-constraint',
        message: `duplicate block id "${id}"`,
      });
    }
  }
  if (block.type === 'section') {
    for (const child of block.blocks) collectIds(child, seen, issues);
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function validateDoc(doc: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const parsed = portableDocSchema.safeParse(doc);
  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push({
        severity: 'error',
        rule: 'content-constraint',
        message: `${err.path.join('.') || '<root>'}: ${err.message}`,
      });
    }
    return issues;
  }

  const typedDoc = parsed.data as unknown as PortableDoc;

  const seenIds = new Map<string, number>();
  for (const block of typedDoc.blocks) {
    collectIds(block, seenIds, issues);
    walkBlockForPropLeaks(block, issues);
    checkBlockContent(block, issues);
    walkBlockForUrls(block, issues);
    checkVariants(block, issues);
  }

  return issues;
}
