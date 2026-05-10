/**
 * VariantPicker — A4 thumbnail-grid replacement for the v0.2 dropdowns.
 *
 * Hybrid rendering per grill q4:
 *   - callout / section / code → direct PdStyle → CSS projection. The variant
 *     identity is tone + border + bg fill, all covered by PdStyle. No backend
 *     round-trip needed; round-tripping per tile would just be wasted bytes.
 *   - action  → backend-web/static `renderHtml` round-trip. Button shape
 *     differs materially across surfaces (filled vs outlined, padding by
 *     size), so we pay the cost for true visual fidelity.
 *
 * pdStyleToCss is hand-rolled, paperflow-owned (no Tailwind class strings).
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useMemo } from 'react';
import type { Block } from '@portable-doc/core';
import { VARIANT_CATALOG, resolveVariant } from '@portable-doc/variants';
import { composeDocument } from '@portable-doc/primitives';
import type { PdStyle } from '@portable-doc/primitives';
import { renderHtml } from '@portable-doc/backend-web/static';
import type { Action } from './store.js';

interface Props {
  block: Block;
  dispatch: (a: Action) => void;
}

export function VariantPicker({ block, dispatch }: Props) {
  if (VARIANT_CATALOG[block.type] === undefined) return null;

  const apply = (variant: Record<string, string>) => {
    // Mirror axes onto the matching top-level fields so backends (which read
    // block.tone / block.priority directly) reflect the picked variant.
    const patch: Record<string, unknown> = { variant };
    if (block.type === 'callout' && variant.tone) patch.tone = variant.tone;
    if (block.type === 'action' && variant.priority) patch.priority = variant.priority;
    dispatch({ kind: 'update', blockId: block.id, patch: patch as Partial<Block> });
  };

  if (block.type === 'action') return <ActionGrid block={block} apply={apply} />;
  return <CssDirectGrid block={block} apply={apply} />;
}

/* ---------------------------------------------------- direct PdStyle → CSS */

/**
 * Project a paperflow PdStyle to inline CSS. Hand-rolled, not a Tailwind-
 * class shim. Callouts pass borderLeftOnly so the tile reads as a callout
 * (matches what the v0.2 backend renders).
 */
export function pdStyleToCss(s: PdStyle, opts: { borderLeftOnly?: boolean } = {}): CSSProperties {
  const css: CSSProperties = {};
  if (s.padding !== undefined) css.padding = s.padding;
  if (s.backgroundColor) css.backgroundColor = s.backgroundColor;
  if (s.borderWidth !== undefined && s.borderColor) {
    if (opts.borderLeftOnly) {
      css.borderLeftStyle = 'solid';
      css.borderLeftWidth = s.borderWidth;
      css.borderLeftColor = s.borderColor;
    } else {
      css.borderStyle = 'solid';
      css.borderWidth = s.borderWidth;
      css.borderColor = s.borderColor;
    }
  }
  return css;
}

/* ------------------------------------------------------------- shared card */

function Card({
  testId,
  active,
  label,
  onApply,
  children,
}: {
  testId: string;
  active: boolean;
  label: string;
  onApply: () => void;
  children: ReactNode;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onApply();
    }
  };
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-testid={testId}
      onClick={onApply}
      onKeyDown={onKey}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        border: active ? '2px solid #4f46e5' : '1px solid #d1d5db',
        borderRadius: 6,
        background: active ? '#eef2ff' : '#fff',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {active && (
        <span aria-hidden style={{ position: 'absolute', top: 4, right: 6, fontSize: 11, color: '#4f46e5' }}>
          ✓
        </span>
      )}
      {children}
      <span style={{ fontSize: 10, color: '#374151' }}>{label}</span>
    </button>
  );
}

const cols = (type: Block['type']): number =>
  type === 'callout' ? 5 : type === 'code' ? 2 : 3;

const gridStyle = (n: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
  gap: 6,
  marginTop: 6,
});

/* ----------------------------------------------------- CSS-direct grid */

interface DirectProps {
  block: Block;
  apply: (variant: Record<string, string>) => void;
}

function CssDirectGrid({ block, apply }: DirectProps) {
  const schema = VARIANT_CATALOG[block.type]!;
  const combos = useMemo(() => cartesian(schema.axes), [schema]);
  const current = block.variant ?? {};
  const borderLeftOnly = block.type === 'callout';

  return (
    <div data-testid={`variant-grid-${block.type}`} role="listbox" style={gridStyle(cols(block.type))}>
      {combos.map((axes) => {
        const id = comboId(axes);
        const style = resolveVariant(block.type, axes);
        return (
          <Card
            key={id}
            testId={`variant-${block.type}-${id}`}
            active={equal(axes, current)}
            label={id}
            onApply={() => apply(axes)}
          >
            <Preview type={block.type} style={style} borderLeftOnly={borderLeftOnly} />
          </Card>
        );
      })}
    </div>
  );
}

function Preview({
  type,
  style,
  borderLeftOnly,
}: {
  type: Block['type'];
  style: PdStyle;
  borderLeftOnly: boolean;
}) {
  const css = pdStyleToCss(style, { borderLeftOnly });
  if (type === 'section') {
    return (
      <div style={{ ...css, minHeight: 44 }}>
        <div style={{ height: 4, background: '#9ca3af', marginBottom: 3 }} />
        <div style={{ height: 4, background: '#9ca3af', marginBottom: 3 }} />
        <div style={{ height: 4, background: '#9ca3af' }} />
      </div>
    );
  }
  if (type === 'code') {
    const compact = (style.padding ?? 16) <= 8;
    const dark = style.backgroundColor !== undefined && style.backgroundColor.toLowerCase() !== '#f3f4f6';
    return (
      <pre
        style={{
          ...css,
          margin: 0,
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: compact ? 9 : 11,
          color: dark ? '#e5e7eb' : '#111827',
          minHeight: 44,
        }}
      >
        {`x = 1\ny = 2\nz = 3`}
      </pre>
    );
  }
  return <div style={{ ...css, minHeight: 32, fontSize: 11, color: '#111827' }}>preview</div>;
}

/* --------------------------------------------------- action via backend */

function ActionGrid({ block, apply }: DirectProps) {
  const schema = VARIANT_CATALOG.action!;
  const combos = useMemo(() => cartesian(schema.axes), [schema]);
  // backend-web/static round-trip — true cross-surface fidelity for button
  // shape (filled primary vs outlined secondary differs materially between
  // web and email/native); CSS-direct would not capture that.
  const htmls = useMemo(
    () => combos.map((axes) => renderActionFragment(block, axes)),
    [block, combos],
  );
  const current = block.variant ?? {};

  return (
    <div data-testid="variant-grid-action" role="listbox" style={gridStyle(2)}>
      {combos.map((axes, i) => {
        const id = comboId(axes);
        const scale = axes.size === 'large' ? 1 : 0.85;
        return (
          <Card
            key={id}
            testId={`variant-action-${id}`}
            active={equal(axes, current)}
            label={id}
            onApply={() => apply(axes)}
          >
            <div
              data-testid={`variant-action-preview-${id}`}
              style={{ transform: `scale(${scale})`, transformOrigin: 'left center', minHeight: 36 }}
              dangerouslySetInnerHTML={{ __html: htmls[i] ?? '' }}
            />
          </Card>
        );
      })}
    </div>
  );
}

function renderActionFragment(block: Block, axes: Record<string, string>): string {
  if (block.type !== 'action') return '';
  const preview = {
    ...block,
    priority: (axes.priority as 'primary' | 'secondary') ?? block.priority,
    variant: axes,
  };
  return renderHtml(composeDocument({ version: 1, blocks: [preview] }), { doctype: false });
}

/* ----------------------------------------------------------------- utils */

function cartesian(axes: Record<string, readonly string[]>): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const name of Object.keys(axes)) {
    const next: Record<string, string>[] = [];
    for (const partial of out) for (const v of axes[name] ?? []) next.push({ ...partial, [name]: v });
    out = next;
  }
  return out;
}

const comboId = (a: Record<string, string>) => Object.values(a).join('-');

function equal(a: Record<string, string>, b: Record<string, string>): boolean {
  const ks = Object.keys(a);
  if (ks.length !== Object.keys(b).length) return false;
  for (const k of ks) if (a[k] !== b[k]) return false;
  return true;
}
