/**
 * Per-block edit form. Each field dispatches an `update` patch on change so
 * the validation panel re-runs every keystroke (live-feedback per spec §11).
 *
 * Variant section (A4): for blocks whose type appears in VARIANT_CATALOG
 * (callout / action / section / code), render the VariantPicker thumbnail
 * grid in place of the v0.2 dropdowns. Blocks without a catalog entry
 * (heading / paragraph / list / divider / image / table) get nothing.
 */
import type { Block, Tone } from '@portable-doc/core';
import { VARIANT_CATALOG } from '@portable-doc/variants';
import type { Action } from './store.js';
import { RichTextField } from './RichTextField.js';
import { RichTextLabel } from './RichTextLabel.js';
import { VariantPicker } from './VariantPicker.js';

interface Props {
  block: Block;
  dispatch: (a: Action) => void;
}

const TONES: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

export function BlockForm({ block, dispatch }: Props) {
  const patch = (p: Partial<Block>) =>
    dispatch({ kind: 'update', blockId: block.id, patch: p });

  return (
    <>
      {renderTypeFields(block, patch)}
      {VARIANT_CATALOG[block.type] !== undefined && (
        <details className="variant-section" data-testid="variant-section" open>
          <summary>Variant</summary>
          <VariantPicker block={block} dispatch={dispatch} />
        </details>
      )}
    </>
  );
}

function renderTypeFields(block: Block, patch: (p: Partial<Block>) => void) {
  switch (block.type) {
    case 'heading':
      return (
        <div>
          <div className="field">
            <label>Level</label>
            <select
              value={block.level}
              onChange={(e) => patch({ level: Number(e.target.value) as 1 | 2 | 3 })}
            >
              <option value={1}>H1</option>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </div>
          <div className="field">
            <label>Text</label>
            <input value={block.text} onChange={(e) => patch({ text: e.target.value })} />
          </div>
        </div>
      );

    case 'paragraph':
      return (
        <div className="field">
          <label>Text</label>
          <RichTextField
            value={block.content}
            onChange={(content) => patch({ content })}
            ariaLabel="Paragraph body"
            dataTestId="paragraph-body"
          />
        </div>
      );

    case 'list': {
      const items = block.items;
      return (
        <div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={block.ordered === true}
                onChange={(e) => patch({ ordered: e.target.checked })}
              />{' '}
              Ordered
            </label>
          </div>
          <div className="field">
            <label>Items</label>
            {items.map((item, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <RichTextField
                  value={item}
                  onChange={(next) => {
                    const updated = items.slice();
                    updated[i] = next;
                    patch({ items: updated });
                  }}
                  ariaLabel={`List item ${i + 1}`}
                  dataTestId={`list-item-${i}`}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({ items: [...items, [{ type: 'text', value: '' }]] })
              }
            >
              + Add item
            </button>
          </div>
        </div>
      );
    }

    case 'callout':
      return (
        <div>
          <div className="field">
            <label>Tone</label>
            <select value={block.tone} onChange={(e) => patch({ tone: e.target.value as Tone })}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Title</label>
            <input
              value={block.title ?? ''}
              onChange={(e) => patch({ title: e.target.value || undefined })}
            />
          </div>
          <div className="field">
            <label>Body</label>
            <RichTextField
              value={block.content}
              onChange={(content) => patch({ content })}
              ariaLabel="Callout body"
              dataTestId="callout-body"
            />
          </div>
        </div>
      );

    case 'action':
      return (
        <div>
          <div className="field">
            <label>Label</label>
            <RichTextLabel
              value={block.label}
              onChange={(label) => patch({ label })}
              ariaLabel="Action label"
              dataTestId="action-label"
            />
          </div>
          <div className="field">
            <label>Href</label>
            <input value={block.href} onChange={(e) => patch({ href: e.target.value })} />
          </div>
          <div className="field">
            <label>Priority</label>
            <select
              value={block.priority}
              onChange={(e) => patch({ priority: e.target.value as 'primary' | 'secondary' })}
            >
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
          </div>
        </div>
      );

    case 'section':
      return (
        <div>
          <div className="field">
            <label>Title</label>
            <input
              value={block.title ?? ''}
              onChange={(e) => patch({ title: e.target.value || undefined })}
            />
          </div>
          <p style={{ color: '#666' }}>Child blocks: {block.blocks.length} (edit via JSON for v2)</p>
        </div>
      );

    case 'divider':
      return <p>Divider block — no fields.</p>;

    case 'code': {
      const lines = block.value.split('\n');
      const long = lines.filter((l) => l.length > 60).length;
      return (
        <div>
          <div className="field">
            <label>Lang</label>
            <input
              value={block.lang ?? ''}
              onChange={(e) => patch({ lang: e.target.value || undefined })}
            />
          </div>
          <div className="field">
            <label>Code</label>
            <textarea
              rows={10}
              value={block.value}
              onChange={(e) => patch({ value: e.target.value })}
            />
            <small style={{ color: long ? '#b91c1c' : '#666' }}>
              {long} lines &gt; 60 cols
            </small>
          </div>
        </div>
      );
    }

    case 'image':
      return (
        <div>
          <div className="field">
            <label>Src</label>
            <input value={block.src} onChange={(e) => patch({ src: e.target.value })} />
          </div>
          <div className="field">
            <label>Alt</label>
            <input value={block.alt} onChange={(e) => patch({ alt: e.target.value })} />
          </div>
          <div className="field">
            <label>Width</label>
            <input
              type="number"
              value={block.width ?? ''}
              onChange={(e) => patch({ width: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="field">
            <label>Height</label>
            <input
              type="number"
              value={block.height ?? ''}
              onChange={(e) => patch({ height: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        </div>
      );

    case 'table': {
      const rows = block.rows.length;
      const cols = block.rows[0]?.length ?? 0;
      return (
        <p style={{ color: '#666' }}>
          Table {rows}×{cols}. Edit JSON tab to modify cells.
        </p>
      );
    }
  }
}

