/**
 * @vitest-environment jsdom
 *
 * A1 — single document-level TipTap instance. Replaces the v0.3 three-panel
 * Editor composite (BlockList + BlockForm + SlashPopover wired together) per
 * the T4 test-triage CSV (apps/editor/src/Editor.test.tsx — disposition
 * `rewrite`).
 *
 * Coverage:
 *   1. ONE TipTap editor mounts (assert via the editor's contenteditable DOM).
 *   2. The welcome fixture content lands as TipTap nodes:
 *        - <h1> for the welcome heading
 *        - <p>  for the intro paragraph
 *        - <blockquote data-tone="success"> for the callout
 *        - <ul> with <li> for the next-steps list
 *   3. `onEditorReady` fires once with a TipTap Editor instance that exposes
 *      `view.dom` — the same node the assertions read from.
 *   4. Placeholder hint applies to an empty doc.
 *   5. Block chrome, slash menu, BubbleMenu, drag — NONE of these mount in A1.
 *      A2–A6 layer them on; this spec guards the "bare surface" contract.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { Editor } from './Editor.js';

beforeAll(() => {
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: () => {
        const list = [] as unknown as DOMRectList;
        Object.defineProperty(list, 'item', { value: () => null });
        return list;
      },
      configurable: true,
    });
  }
  if (!('getBoundingClientRect' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      value: () => ({
        x: 0, y: 0, width: 0, height: 0,
        top: 0, left: 0, right: 0, bottom: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }
});

afterEach(() => cleanup());

const welcomeFixture: PortableDoc = {
  version: 1,
  title: 'Welcome to Atlas',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Welcome to Atlas' },
    {
      id: 'p1',
      type: 'paragraph',
      content: [{ type: 'text', value: 'Your workspace is ready.' }],
    },
    {
      id: 'c1',
      type: 'callout',
      tone: 'success',
      title: 'Setup complete',
      content: [{ type: 'text', value: 'Invite your team.' }],
    },
    {
      id: 'l1',
      type: 'list',
      ordered: false,
      items: [
        [{ type: 'text', value: 'Invite your team' }],
        [{ type: 'text', value: 'Create your first project' }],
      ],
    },
  ],
};

describe('Editor — single document-level TipTap instance (A1)', () => {
  it('mounts exactly ONE TipTap editor (single doc model)', () => {
    render(<Editor doc={welcomeFixture} />);
    // The TipTap React wrapper renders a `.ProseMirror` contenteditable; we
    // assert exactly one such element under the editor mount.
    const mounts = screen.getAllByTestId('paper-editor');
    expect(mounts.length).toBe(1);
    const pms = mounts[0]?.querySelectorAll('.ProseMirror');
    expect(pms?.length).toBe(1);
    expect(pms?.[0]?.getAttribute('contenteditable')).toBe('true');
  });

  it('seeds the welcome fixture as TipTap nodes — heading + paragraph + callout + list', () => {
    render(<Editor doc={welcomeFixture} />);
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    expect(surface).toBeTruthy();

    // <h1> for the welcome heading.
    const h1 = surface?.querySelector('h1');
    expect(h1?.textContent).toBe('Welcome to Atlas');

    // <p> for the intro paragraph.
    const ps = surface?.querySelectorAll('p');
    const introP = Array.from(ps ?? []).find((p) =>
      p.textContent?.includes('Your workspace is ready'),
    );
    expect(introP).toBeTruthy();

    // <blockquote> for the callout. A2's NodeView swaps this for a chromed
    // surface that re-introduces the tone attribute; A1 ships the structural
    // placeholder, and TipTap's default schema strips unknown attrs.
    const callout = surface?.querySelector('blockquote');
    expect(callout).toBeTruthy();
    expect(callout?.textContent ?? '').toMatch(/Setup complete/);
    expect(callout?.textContent ?? '').toMatch(/Invite your team/);

    // <ul> for the unordered list, with two list items.
    const ul = surface?.querySelector('ul');
    expect(ul).toBeTruthy();
    expect(ul?.querySelectorAll('li').length).toBe(2);
  });

  it('surfaces the editor instance via onEditorReady exposing view.dom', async () => {
    const onReady = vi.fn<(editor: TipTapEditor) => void>();
    render(<Editor doc={welcomeFixture} onEditorReady={onReady} />);
    // useEditor mounts asynchronously on the next React effect tick; wait
    // until at least one call is recorded.
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(onReady).toHaveBeenCalled();
    const editor = onReady.mock.calls[0]?.[0];
    expect(editor).toBeTruthy();
    expect(editor?.view?.dom).toBeTruthy();
    // The same DOM node that the assertion reads from above.
    expect(editor?.view?.dom.classList.contains('ProseMirror')).toBe(true);
  });

  it('applies the placeholder hint when the doc is empty', () => {
    const empty: PortableDoc = { version: 1, blocks: [] };
    render(<Editor doc={empty} />);
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    // TipTap Placeholder writes the hint string into a data-placeholder attr
    // on the empty paragraph; the CSS rule projects it via ::before.
    const emptyP = surface?.querySelector('p.is-editor-empty');
    expect(emptyP?.getAttribute('data-placeholder')).toMatch(/Start typing/);
  });

  it('does NOT mount A2–A6 surfaces — no block chrome, no slash menu, no bubble menu', () => {
    render(<Editor doc={welcomeFixture} />);
    expect(screen.queryByTestId('slash-popover')).toBeNull();
    expect(screen.queryByTestId('bubble-menu')).toBeNull();
    expect(screen.queryByTestId('block-chrome')).toBeNull();
    expect(screen.queryByTestId('variant-chip')).toBeNull();
  });
});
