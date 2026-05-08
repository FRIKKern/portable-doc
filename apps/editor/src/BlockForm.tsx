/**
 * Per-block edit form. Each field dispatches an `update` patch on change so
 * the validation panel re-runs every keystroke (live-feedback per spec §11).
 */
import type { Block, InlineNode, Tone } from '@portable-doc/core';
import type { Action } from './store.js';

interface Props {
  block: Block;
  dispatch: (a: Action) => void;
}

const TONES: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

function inlineFromString(s: string): InlineNode[] {
  return [{ type: 'text', value: s }];
}

function flattenInline(nodes: InlineNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text' || n.type === 'code') out += n.value;
    else if (n.type === 'strong' || n.type === 'em' || n.type === 'link')
      out += flattenInline(n.children);
  }
  return out;
}

export function BlockForm({ block, dispatch }: Props) {
  const patch = (p: Partial<Block>) =>
    dispatch({ kind: 'update', blockId: block.id, patch: p });

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
          <textarea
            rows={6}
            value={flattenInline(block.content)}
            onChange={(e) => patch({ content: inlineFromString(e.target.value) })}
          />
        </div>
      );

    case 'list': {
      const itemsText = block.items.map((i) => flattenInline(i)).join('\n');
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
            <label>Items (one per line)</label>
            <textarea
              rows={6}
              value={itemsText}
              onChange={(e) => {
                const lines = e.target.value.split('\n').filter((l) => l.length > 0);
                patch({ items: lines.length ? lines.map((l) => inlineFromString(l)) : [[{ type: 'text', value: '' }]] });
              }}
            />
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
            <textarea
              rows={4}
              value={flattenInline(block.content)}
              onChange={(e) => patch({ content: inlineFromString(e.target.value) })}
            />
          </div>
        </div>
      );

    case 'action':
      return (
        <div>
          <div className="field">
            <label>Label</label>
            <input value={block.label} onChange={(e) => patch({ label: e.target.value })} />
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
