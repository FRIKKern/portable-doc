/**
 * A5 — inline variant chip (replaces v0.3's VariantPicker grid).
 *
 * Rendered inside the single FloatingBlockChrome cluster — no DOM
 * bridge, no `createRoot` indirection. Variant-axis math (which
 * options exist, what the current selection resolves to, how attrs
 * map back) comes from `@portable-doc/variants` via VARIANT_CATALOG.
 * Click an option → `onChange(newAttrs)` fires; the floating chrome
 * translates that into a setNodeMarkup transaction at the target
 * block's pos.
 *
 * paperflow-owned. No Tailwind, no class-string shims. Hand-rolled inline
 * style + the .paper-variant-chip CSS section in paper.css.
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockType } from '@portable-doc/core';
import { tonePalette } from '@portable-doc/core';
import { VARIANT_CATALOG, resolveVariant } from '@portable-doc/variants';
import { composeDocument } from '@portable-doc/primitives';
import type { PdStyle } from '@portable-doc/primitives';
import { renderHtml } from '@portable-doc/backend-web/static';

/** Block types A5 paints a chip for. Anything else → renders null. */
type VariantBlockType = 'callout' | 'action' | 'section' | 'code';
const VARIANT_TYPES: ReadonlySet<string> = new Set<VariantBlockType>([
  'callout',
  'action',
  'section',
  'code',
]);

export interface VariantChipProps {
  blockType: BlockType | string;
  attrs: Record<string, unknown>;
  /** Called with the merged variant axes — caller folds these into the
   *  block's attribute set (typically via editor.commands.updateAttributes). */
  onChange: (next: Record<string, string>) => void;
}

export function VariantChip({ blockType, attrs, onChange }: VariantChipProps) {
  if (!VARIANT_TYPES.has(blockType)) return null;
  if (VARIANT_CATALOG[blockType as BlockType] === undefined) return null;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const current = (attrs.variant as Record<string, string> | undefined) ?? {};
  const schema = VARIANT_CATALOG[blockType as BlockType]!;
  const combos = useMemo(() => cartesian(schema.axes), [schema]);

  // Esc closes the palette (grill Q12 a11y). Listener lives on the wrapper
  // so it only fires when keyboard focus is inside the chip's subtree.
  useEffect(() => {
    if (!open) return;
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onDocKey);
    return () => document.removeEventListener('keydown', onDocKey);
  }, [open]);

  const apply = (axes: Record<string, string>) => {
    onChange(axes);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="paper-variant-chip" data-testid={`variant-chip-${blockType}`}>
      <button
        type="button"
        className="paper-variant-chip__current"
        aria-label={`Block variant: ${chipSummary(blockType as VariantBlockType, current)}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={`variant-chip-current-${blockType}`}
        onClick={() => setOpen((o) => !o)}
      >
        <ChipSummary blockType={blockType as VariantBlockType} current={current} />
      </button>
      {open && (
        <ChipPalette
          blockType={blockType as VariantBlockType}
          combos={combos}
          current={current}
          apply={apply}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------- summary (closed state) */

function ChipSummary({
  blockType,
  current,
}: {
  blockType: VariantBlockType;
  current: Record<string, string>;
}) {
  if (blockType === 'callout') {
    const tone = (current.tone as keyof typeof tonePalette | undefined) ?? 'info';
    const emphasis = current.emphasis ?? 'subtle';
    return (
      <>
        <span
          aria-hidden
          className="paper-variant-chip__tone-dot"
          data-tone={tone}
          style={{ backgroundColor: tonePalette[tone].fg }}
        />
        <span className="paper-variant-chip__summary-label">
          {tone} · {emphasis}
        </span>
      </>
    );
  }
  if (blockType === 'action') {
    return (
      <span className="paper-variant-chip__summary-label">
        {(current.priority ?? 'primary')} · {(current.size ?? 'medium')}
      </span>
    );
  }
  if (blockType === 'section') {
    return (
      <span className="paper-variant-chip__summary-label">
        {current.density ?? 'comfortable'}
      </span>
    );
  }
  // code
  return (
    <span className="paper-variant-chip__summary-label">
      {(current.theme ?? 'light')} · {(current.density ?? 'normal')}
    </span>
  );
}

function chipSummary(
  blockType: VariantBlockType,
  current: Record<string, string>,
): string {
  if (blockType === 'callout') {
    return `${current.tone ?? 'info'} ${current.emphasis ?? 'subtle'}`;
  }
  if (blockType === 'action') {
    return `${current.priority ?? 'primary'} ${current.size ?? 'medium'}`;
  }
  if (blockType === 'section') return current.density ?? 'comfortable';
  return `${current.theme ?? 'light'} ${current.density ?? 'normal'}`;
}

/* ------------------------------------------------------ palette (open state) */

function ChipPalette({
  blockType,
  combos,
  current,
  apply,
}: {
  blockType: VariantBlockType;
  combos: Record<string, string>[];
  current: Record<string, string>;
  apply: (axes: Record<string, string>) => void;
}) {
  // Hybrid: action goes through backend-web; everything else uses CSS-direct.
  const htmls = useMemo(() => {
    if (blockType !== 'action') return null;
    return combos.map((axes) => renderActionFragment(axes));
  }, [blockType, combos]);

  return (
    <div
      className="paper-variant-chip__palette"
      role="listbox"
      aria-label={`${blockType} variants`}
      data-testid={`variant-chip-palette-${blockType}`}
    >
      {combos.map((axes, i) => {
        const id = comboId(axes);
        const active = equal(axes, current);
        const inner =
          blockType === 'action' ? (
            <ActionPreview html={htmls?.[i] ?? ''} id={id} />
          ) : (
            <CssDirectPreview blockType={blockType} axes={axes} />
          );
        return (
          <Option
            key={id}
            testId={`variant-chip-option-${blockType}-${id}`}
            active={active}
            label={prettyLabel(axes)}
            onApply={() => apply(axes)}
          >
            {inner}
          </Option>
        );
      })}
    </div>
  );
}

function Option({
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
      className={
        active
          ? 'paper-variant-chip__option paper-variant-chip__option--active'
          : 'paper-variant-chip__option'
      }
      onClick={onApply}
      onKeyDown={onKey}
    >
      {children}
      <span className="paper-variant-chip__option-label">{label}</span>
    </button>
  );
}

/* ----------------------------------------------- direct PdStyle → CSS preview */

/** Hand-rolled PdStyle → CSSProperties projection — identical contract to
 *  v0.3 VariantPicker's `pdStyleToCss`. Callouts use border-left only. */
export function pdStyleToCss(
  s: PdStyle,
  opts: { borderLeftOnly?: boolean } = {},
): CSSProperties {
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

function CssDirectPreview({
  blockType,
  axes,
}: {
  blockType: VariantBlockType;
  axes: Record<string, string>;
}) {
  const style = resolveVariant(blockType, axes);
  const borderLeftOnly = blockType === 'callout';
  const css = pdStyleToCss(style, { borderLeftOnly });

  if (blockType === 'section') {
    return (
      <div className="paper-variant-chip__preview" style={{ ...css, minHeight: 28 }}>
        <div style={{ height: 3, background: '#9ca3af', marginBottom: 2 }} />
        <div style={{ height: 3, background: '#9ca3af', marginBottom: 2 }} />
        <div style={{ height: 3, background: '#9ca3af' }} />
      </div>
    );
  }
  if (blockType === 'code') {
    const compact = (style.padding ?? 16) <= 8;
    const dark =
      style.backgroundColor !== undefined &&
      style.backgroundColor.toLowerCase() !== '#f3f4f6';
    return (
      <pre
        className="paper-variant-chip__preview"
        style={{
          ...css,
          margin: 0,
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: compact ? 8 : 10,
          color: dark ? '#e5e7eb' : '#111827',
          minHeight: 28,
        }}
      >
        {`x = 1\ny = 2`}
      </pre>
    );
  }
  // callout — render a tone-swatch + a single representative text
  // line. The colored border-left + bg ARE the variant; the label
  // below the cell names it. No "preview" placeholder text — every
  // cell looked identical with that.
  return (
    <div
      className="paper-variant-chip__preview paper-variant-chip__preview--callout"
      style={{ ...css }}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------- action via backend-web */

function ActionPreview({ html, id }: { html: string; id: string }) {
  return (
    <div
      className="paper-variant-chip__preview"
      data-testid={`variant-chip-action-preview-${id}`}
      // eslint-disable-next-line react/no-danger -- backend-web HTML is paperflow-owned.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderActionFragment(axes: Record<string, string>): string {
  // Minimal action block — only the variant axes drive button shape; the
  // label/href are placeholders for thumbnail rendering.
  const preview = {
    id: 'preview',
    type: 'action' as const,
    label: 'Open',
    href: 'https://example.com',
    priority: (axes.priority as 'primary' | 'secondary') ?? 'primary',
    variant: axes,
  };
  return renderHtml(composeDocument({ version: 1, blocks: [preview] }), {
    doctype: false,
  });
}

/* ---------------------------------------------------------------- utilities */

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

/** Human-readable label for an axes combo. `{tone:'success', emphasis:
 *  'subtle'}` → `'Success · Subtle'`. Title-cases each value and joins
 *  with a middot for visual rhythm — much easier to scan than the
 *  internal kebab-id ('success-subtle') the variant catalog uses. */
function prettyLabel(a: Record<string, string>): string {
  return Object.values(a)
    .map((v) => v.charAt(0).toUpperCase() + v.slice(1))
    .join(' · ');
}

function equal(a: Record<string, string>, b: Record<string, string>): boolean {
  const ks = Object.keys(a);
  if (ks.length !== Object.keys(b).length) return false;
  for (const k of ks) if (a[k] !== b[k]) return false;
  return true;
}
