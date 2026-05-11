/**
 * @vitest-environment happy-dom
 *
 * A2 — block-chrome via TipTap NodeView. Replaces the v0.3 BlockTile specs
 * (T4 test-triage: `BlockTile.test.tsx` → disposition `rewrite`).
 *
 * Coverage matrix
 * ---------------
 *   1. `withBlockChrome(Paragraph)` returns an extension whose NodeView
 *      hook (`addNodeView`) is defined.
 *   2. `renderChromeDom('paragraph')` builds the toolbar with drag handle,
 *      label "Paragraph", delete button, variant slot, and the "+" insert.
 *   3. `updateChromeForSelection` toggles `.is-selecting` on the wrapper.
 *   4. Block-chrome CSS reads the motion-fade-in token (animation hook).
 *   5. `prefers-reduced-motion` collapses chrome-fade-in to 0ms via the
 *      same global override the motion stylesheet declares.
 *   6. Block-chrome `--paper-block-chrome-z` < `--paper-bubble-menu-z`
 *      (stacking; grill Q3).
 *   7. Editor.tsx renders the welcome doc with each top-level node wrapped
 *      in `.paper-block`.
 *   8. Drag-handle aria-label is parametrized over block types.
 *   9. Delete-button click removes the block (editor.getJSON shrinks by 1).
 *  10. `+` insert button inserts a paragraph below the current block.
 *  11. Selection-non-empty hides chrome via `.is-selecting`.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import {
  humanLabelFor,
  renderChromeDom,
  updateChromeForSelection,
} from '../BlockChrome.js';
import { withBlockChrome } from './withBlockChrome.js';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { BulletList } from '@tiptap/extension-list';
import Blockquote from '@tiptap/extension-blockquote';
import { Editor } from '../Editor.js';

beforeAll(() => {
  // happy-dom is the configured env; add the ProseMirror selection-rect
  // shim that the A1 specs already inject — node-view selection updates
  // call into Range.getClientRects.
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

// ---------------------------------------------------------------------------
// 1. withBlockChrome shape
// ---------------------------------------------------------------------------

describe('withBlockChrome — factory shape', () => {
  it('returns an extension whose addNodeView hook is defined', () => {
    const Wrapped = withBlockChrome(Paragraph);
    // The wrapped Node retains the original name + has an addNodeView config.
    expect(Wrapped.name).toBe('paragraph');
    const hook = (Wrapped.config as { addNodeView?: unknown }).addNodeView;
    expect(typeof hook).toBe('function');
  });

  it('preserves the base node name across diverse block types', () => {
    expect(withBlockChrome(Paragraph).name).toBe('paragraph');
    expect(withBlockChrome(Heading).name).toBe('heading');
    expect(withBlockChrome(BulletList).name).toBe('bulletList');
    expect(withBlockChrome(Blockquote).name).toBe('blockquote');
  });
});

// ---------------------------------------------------------------------------
// 2. renderChromeDom + humanLabelFor
// ---------------------------------------------------------------------------

describe('renderChromeDom — DOM scaffold', () => {
  it('builds drag handle + label + variant slot + delete + insert (paragraph)', () => {
    const parts = renderChromeDom('paragraph');
    expect(parts.toolbar.classList.contains('paper-block__chrome')).toBe(true);
    expect(parts.dragBtn.textContent).toBe('⋮⋮');
    expect(parts.labelEl.textContent).toBe('Paragraph');
    expect(parts.deleteBtn.textContent).toBe('×');
    expect(parts.variantSlot.classList.contains('paper-block__variant-slot')).toBe(true);
    expect(parts.insertBtn.classList.contains('paper-block__insert')).toBe(true);
    expect(parts.insertBtn.textContent).toBe('+');
  });

  // (8) drag-handle aria-label parametrized
  it.each([
    ['paragraph', 'Paragraph', 'Drag paragraph'],
    ['heading', 'Heading', 'Drag heading'],
    ['bulletList', 'List', 'Drag list'],
    ['blockquote', 'Callout', 'Drag callout'],
    ['codeBlock', 'Code', 'Drag code'],
  ])('drag handle for %s has aria-label "%s"', (blockType, label, ariaDrag) => {
    const parts = renderChromeDom(blockType);
    expect(humanLabelFor(blockType)).toBe(label);
    expect(parts.dragBtn.getAttribute('aria-label')).toBe(ariaDrag);
    expect(parts.deleteBtn.getAttribute('aria-label')).toBe(`Delete ${label.toLowerCase()}`);
  });

  it('insert button carries the correct aria-label', () => {
    const parts = renderChromeDom('paragraph');
    expect(parts.insertBtn.getAttribute('aria-label')).toBe('Insert block below');
  });
});

// ---------------------------------------------------------------------------
// 3. Selection-driven visibility
// ---------------------------------------------------------------------------

describe('updateChromeForSelection — .is-selecting toggle', () => {
  it('adds .is-selecting when selection is non-empty', () => {
    const el = document.createElement('div');
    el.className = 'paper-block';
    updateChromeForSelection(el, /* selectionEmpty */ false);
    expect(el.classList.contains('is-selecting')).toBe(true);
  });

  it('removes .is-selecting when selection is empty', () => {
    const el = document.createElement('div');
    el.className = 'paper-block is-selecting';
    updateChromeForSelection(el, /* selectionEmpty */ true);
    expect(el.classList.contains('is-selecting')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4 + 5. Motion / reduced-motion via paper.css
// ---------------------------------------------------------------------------

describe('paper.css — motion + reduced-motion + z-index', () => {
  function loadPaperCss(): string {
    // The CSS file is loaded from disk so we test the source-of-truth, not
    // a copy. happy-dom doesn't apply external CSS by itself; we only need
    // text inspection here — the integration test below uses live styles
    // via a <style> tag.
    return require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../styles/paper.css'),
      'utf-8',
    );
  }

  it('block chrome transitions reference --motion-chrome-fade-in', () => {
    const css = loadPaperCss();
    expect(css).toMatch(/\.paper-block:hover\s*>\s*\.paper-block__chrome/);
    expect(css).toMatch(/var\(--motion-chrome-fade-in\)/);
  });

  it('@media (prefers-reduced-motion: reduce) collapses --motion-chrome-fade-in to 0ms', () => {
    const css = loadPaperCss();
    const reducedBlock = css.split('@media (prefers-reduced-motion: reduce)')[1];
    expect(reducedBlock).toBeTruthy();
    expect(reducedBlock).toMatch(/--motion-chrome-fade-in:\s*0ms/);
  });

  it('z-stack: block chrome (10) lives below bubble menu (20) — grill Q3', () => {
    const css = loadPaperCss();
    const blockZ = css.match(/--paper-block-chrome-z:\s*(\d+)/);
    const bubbleZ = css.match(/--paper-bubble-menu-z:\s*(\d+)/);
    expect(blockZ).toBeTruthy();
    expect(bubbleZ).toBeTruthy();
    const blockNum = Number(blockZ?.[1] ?? '0');
    const bubbleNum = Number(bubbleZ?.[1] ?? '0');
    expect(blockNum).toBe(10);
    expect(bubbleNum).toBe(20);
    expect(blockNum).toBeLessThan(bubbleNum);
  });
});

// ---------------------------------------------------------------------------
// 6 + 7 + 9 + 10 + 11. Editor integration — mount + delete + insert + selection
// ---------------------------------------------------------------------------

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

describe('Editor integration — paper-block chrome on every top-level node', () => {
  it('renders one .paper-block per top-level block in the welcome doc', () => {
    render(<Editor doc={welcomeFixture} />);
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    expect(surface).toBeTruthy();
    const blocks = surface!.querySelectorAll('.paper-block');
    // welcome doc: heading + paragraph + callout + list = 4 top-level blocks.
    expect(blocks.length).toBe(4);
  });

  it('every paper-block carries a drag handle, label, and delete button', () => {
    render(<Editor doc={welcomeFixture} />);
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    const blocks = surface!.querySelectorAll('.paper-block');
    for (const b of Array.from(blocks)) {
      expect(b.querySelector('.paper-block-drag-handle')).toBeTruthy();
      expect(b.querySelector('.paper-block__label')).toBeTruthy();
      expect(b.querySelector('.paper-block-delete')).toBeTruthy();
    }
  });

  it('every paper-block-outer carries a .paper-block__insert button', () => {
    render(<Editor doc={welcomeFixture} />);
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    const inserts = surface!.querySelectorAll('.paper-block__insert');
    // welcome doc: 4 top-level blocks → 4 insert buttons.
    expect(inserts.length).toBe(4);
  });

  it('delete button removes the targeted block (heading goes away)', async () => {
    let captured: import('@tiptap/react').Editor | null = null;
    render(
      <Editor
        doc={welcomeFixture}
        onEditorReady={(e) => {
          captured = e;
        }}
      />,
    );
    // Editor mounts on the next effect tick.
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(captured).toBeTruthy();
    const editor = captured!;
    const beforeTypes = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(beforeTypes).toContain('heading');

    // Click the first delete button — it targets the heading (the first
    // top-level block in the welcome fixture).
    const firstDelete = editor.view.dom.querySelector(
      '.paper-block-delete',
    ) as HTMLButtonElement | null;
    expect(firstDelete).toBeTruthy();
    expect(firstDelete!.getAttribute('aria-label')).toBe('Delete heading');
    firstDelete!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );

    const afterTypes = (editor.getJSON().content ?? []).map((n) => n.type);
    // The heading is gone — that's the contract the chrome delete promises.
    // StarterKit's TrailingNode extension may insert an empty paragraph at
    // the end of the doc as a side effect, so we assert structural absence
    // of the heading rather than a length delta.
    expect(afterTypes).not.toContain('heading');
  });

  it('+ insert button inserts a paragraph immediately after the current block', async () => {
    let captured: import('@tiptap/react').Editor | null = null;
    render(
      <Editor
        doc={welcomeFixture}
        onEditorReady={(e) => {
          captured = e;
        }}
      />,
    );
    await new Promise<void>((r) => setTimeout(r, 0));
    const editor = captured!;
    const beforeTypes = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(beforeTypes[0]).toBe('heading');
    expect(beforeTypes[1]).toBe('paragraph');

    const firstInsert = editor.view.dom.querySelector(
      '.paper-block__insert',
    ) as HTMLButtonElement | null;
    expect(firstInsert).toBeTruthy();
    expect(firstInsert!.getAttribute('aria-label')).toBe('Insert block below');
    firstInsert!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );

    const afterTypes = (editor.getJSON().content ?? []).map((n) => n.type);
    // The inserted paragraph sits between the heading and the original
    // intro paragraph — heading at index 0, NEW paragraph at index 1.
    expect(afterTypes[0]).toBe('heading');
    expect(afterTypes[1]).toBe('paragraph');
    // The original intro paragraph has been displaced by one index — and
    // the new paragraph is empty whereas the intro held inline text.
    const inserted = editor.getJSON().content?.[1];
    expect(inserted?.content ?? []).toEqual([]);
  });

  it('non-empty selection adds .is-selecting to every paper-block (grill Q3)', async () => {
    let captured: import('@tiptap/react').Editor | null = null;
    render(
      <Editor
        doc={welcomeFixture}
        onEditorReady={(e) => {
          captured = e;
        }}
      />,
    );
    await new Promise<void>((r) => setTimeout(r, 0));
    const editor = captured!;
    // Select the whole doc.
    editor.commands.selectAll();
    // selectionUpdate is sync on the next microtask.
    await new Promise<void>((r) => setTimeout(r, 0));
    const blocks = editor.view.dom.querySelectorAll('.paper-block');
    const selectingCount = Array.from(blocks).filter((b) =>
      b.classList.contains('is-selecting'),
    ).length;
    expect(selectingCount).toBe(blocks.length);
    expect(selectingCount).toBeGreaterThan(0);
  });
});
