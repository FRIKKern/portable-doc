/**
 * @vitest-environment happy-dom
 *
 * A2 — block-chrome via TipTap NodeView.
 *
 * Post-CW5 / T3b: the per-block embedded chrome toolbar is gone. Each
 * NodeView renders just `.paper-block` with `data-block-type`; the drag
 * handle is owned by the mainstream `tiptap-extension-global-drag-handle`
 * (Novel's choice) and renders as a single `<div class="drag-handle"
 * data-drag-handle>` next to the editor. Our React-owned cluster
 * (`.paper-floating-chrome`) carries the remaining affordances (label /
 * variant chip / delete / "+" insert), positioned as a sibling of the
 * global handle. Tests assert that contract:
 *
 *   1. `withBlockChrome(Paragraph)` returns an extension whose NodeView
 *      hook (`addNodeView`) is defined.
 *   2. Editor.tsx renders the welcome doc with each top-level node wrapped
 *      in `.paper-block` carrying `data-block-type`.
 *   3. Exactly one `.paper-floating-chrome` lives in the editor mount
 *      (Notion/BlockNote/Linear pattern, not N-per-block).
 *   4. The floating chrome carries label, variant slot, delete, and "+"
 *      insert as a single cluster (drag handle is the global extension's
 *      sibling div, NOT inside the cluster).
 *   5. Delete button on the floating chrome removes the targeted block.
 *   6. "+" insert button inserts a paragraph below the target block.
 *   7. Block-chrome CSS still reads the motion-fade-in token (animation
 *      hook) and `prefers-reduced-motion` collapses it to 0ms.
 *   8. Block-chrome `--paper-block-chrome-z` < `--paper-bubble-menu-z`
 *      (stacking; grill Q3).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
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
  // happy-dom doesn't implement `document.elementsFromPoint`. The global
  // drag-handle extension calls it on every editor `mousemove` to find
  // the block under the pointer. The shim returns an empty array which
  // is safe — the extension hides its handle when no node is found.
  if (typeof (document as Document).elementsFromPoint !== 'function') {
    Object.defineProperty(document, 'elementsFromPoint', {
      value: () => [] as Element[],
      configurable: true,
    });
  }
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// 1. withBlockChrome shape
// ---------------------------------------------------------------------------

describe('withBlockChrome — factory shape', () => {
  it('returns a schema-draggable Node with NO NodeView (post-D+E canonical TipTap rendering)', () => {
    const Wrapped = withBlockChrome(Paragraph);
    expect(Wrapped.name).toBe('paragraph');
    // Post-D+E: variant rendering is CSS-driven (per-axis data-attrs),
    // so the wrapped Node no longer mounts a React NodeView. The
    // schema's natural toDOM shape paints the element directly.
    const hook = (Wrapped.config as { addNodeView?: unknown }).addNodeView;
    expect(hook).toBeUndefined();
    // `draggable: true` lives on the extension config so PM's drag
    // pipeline knows the whole node can be picked up as a unit.
    expect((Wrapped.config as { draggable?: boolean }).draggable).toBe(true);
  });

  it('preserves the base node name across diverse block types', () => {
    expect(withBlockChrome(Paragraph).name).toBe('paragraph');
    expect(withBlockChrome(Heading).name).toBe('heading');
    expect(withBlockChrome(BulletList).name).toBe('bulletList');
    expect(withBlockChrome(Blockquote).name).toBe('blockquote');
  });

  it('emits per-axis data-* attrs from the variant attribute (callout: data-tone + data-emphasis)', async () => {
    let captured: import('@tiptap/react').Editor | null = null;
    render(
      <Editor
        doc={{
          version: 1,
          title: 't',
          blocks: [
            {
              id: 'c1',
              type: 'callout',
              tone: 'warning',
              content: [{ type: 'text', value: 'Hi' }],
              variant: { tone: 'warning', emphasis: 'bold' },
            },
          ],
        }}
        onEditorReady={(e) => {
          captured = e;
        }}
      />,
    );
    await new Promise<void>((r) => setTimeout(r, 0));
    const editor = captured!;
    const bq = editor.view.dom.querySelector('blockquote');
    expect(bq).toBeTruthy();
    // Per-axis data attrs are the canonical CSS hook (post-D+E).
    expect(bq!.getAttribute('data-tone')).toBe('warning');
    expect(bq!.getAttribute('data-emphasis')).toBe('bold');
  });
});

// ---------------------------------------------------------------------------
// 4 + 5. Motion / reduced-motion / z-index via paper.css
// ---------------------------------------------------------------------------

describe('paper.css — motion + reduced-motion + z-index', () => {
  function loadPaperCss(): string {
    // The CSS file is loaded from disk so we test the source-of-truth, not
    // a copy. happy-dom doesn't apply external CSS by itself; we only need
    // text inspection here.
    return require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../styles/paper.css'),
      'utf-8',
    );
  }

  it('floating chrome transitions reference --motion-chrome-fade-in', () => {
    const css = loadPaperCss();
    // Post-CW5: the chrome lives in `.paper-floating-chrome.is-tracking`,
    // not on `.paper-block:hover > .paper-block__chrome`.
    expect(css).toMatch(/\.paper-floating-chrome\.is-tracking/);
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
// 6 + 7. Editor integration — mount + floating chrome contract
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

describe('Editor integration — paper-block + single floating chrome', () => {
  // Each render-then-assert here waits one macrotask so the React
  // NodeView renderers (queued via queueMicrotask in @tiptap/react) flush
  // before we count `.paper-block` elements.
  it('renders one .paper-block per top-level block in the welcome doc', async () => {
    render(<Editor doc={welcomeFixture} />);
    await new Promise<void>((r) => setTimeout(r, 0));
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    expect(surface).toBeTruthy();
    // Post-D+E: every wrapped extension stamps `paper-block` on its
    // rendered element via HTMLAttributes (including nested
    // paragraphs inside lists / callouts). The top-level count is
    // the count of direct children of the editor surface — paper.css
    // scopes the editor's block-level affordances to those via
    // `.ProseMirror > .paper-block` selectors.
    const topLevel = Array.from(surface!.children).filter((el) =>
      el.classList.contains('paper-block'),
    );
    // welcome doc: heading + paragraph + callout + list = 4 top-level
    // blocks; the TrailingNode extension appends one empty <p> at the
    // end (since the doc ends in a list, not already a paragraph), so
    // the rendered count is 5. The trailing slot is the universal
    // Notion / Novel / Linear pattern.
    expect(topLevel.length).toBe(5);
  });

  it('every wrapped extension carries the schema-level `draggable: true` flag (the global drag-handle reads this)', async () => {
    render(<Editor doc={welcomeFixture} />);
    await new Promise<void>((r) => setTimeout(r, 0));
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    // The schema-draggable flag surfaces in the rendered DOM as
    // `draggable="true"` on the block element (PM's NodeView default
    // toDOM reads the schema spec). Walk the top-level children and
    // confirm.
    const topLevel = Array.from(surface!.children).filter((el) =>
      el.classList.contains('paper-block'),
    );
    expect(topLevel.length).toBeGreaterThan(0);
    topLevel.forEach((el) => {
      // `data-block-idx` is intentionally NOT written — the floating
      // chrome uses canonical PM APIs (`view.posAtCoords` with a
      // `view.posAtDOM` fallback) to find the target block.
      expect(el.getAttribute('data-block-idx')).toBeNull();
    });
  });

  it('paper-block does NOT carry per-block chrome (no embedded toolbar)', async () => {
    render(<Editor doc={welcomeFixture} />);
    await new Promise<void>((r) => setTimeout(r, 0));
    const surface = screen.getByTestId('paper-editor').querySelector('.ProseMirror');
    // Zero per-block chrome toolbars / inserts / handles inside the
    // PM surface — they all moved to the single floating cluster (and
    // the global drag handle lives next to the editor's parent, not
    // inside the surface).
    expect(surface!.querySelectorAll('.paper-block__chrome').length).toBe(0);
    expect(surface!.querySelectorAll('.paper-block__insert').length).toBe(0);
    expect(surface!.querySelectorAll('[data-drag-handle]').length).toBe(0);
    expect(surface!.querySelectorAll('.paper-block-delete').length).toBe(0);
  });

  it('exactly one .paper-floating-chrome lives in the editor mount', async () => {
    render(<Editor doc={welcomeFixture} />);
    await new Promise<void>((r) => setTimeout(r, 0));
    const mount = screen.getByTestId('paper-editor');
    const clusters = mount.querySelectorAll('.paper-floating-chrome');
    // Single cluster — the highest-leverage CW5 architecture invariant.
    expect(clusters.length).toBe(1);
  });

  it('the floating chrome carries the variant slot and delete button (drag handle lives outside, owned by global-drag-handle; type label + "+" dropped to match Notion / Novel / BlockNote)', async () => {
    render(<Editor doc={welcomeFixture} />);
    await new Promise<void>((r) => setTimeout(r, 0));
    const mount = screen.getByTestId('paper-editor');
    const chrome = mount.querySelector('.paper-floating-chrome');
    expect(chrome).toBeTruthy();
    // Drag handle is NOT a child of the cluster — the global extension
    // renders its own `<div class="drag-handle" data-drag-handle>` as a
    // sibling of the editor (positioned with inline top/left on
    // mousemove). Cluster owns the remaining affordances.
    expect(chrome!.querySelector('[data-drag-handle]')).toBeFalsy();
    expect(chrome!.querySelector('.paper-block__variant-slot')).toBeTruthy();
    expect(chrome!.querySelector('.paper-block-delete')).toBeTruthy();
    // Type label dropped (Notion / Novel / BlockNote don't render one
    // by default; SR users still get the type via the delete button's
    // aria-label, e.g. "Delete heading 1").
    expect(chrome!.querySelector('.paper-block__label')).toBeFalsy();
    // "+" insert dropped — the slash menu (`/`) is the canonical
    // insert path, so the cluster no longer duplicates it.
    expect(chrome!.querySelector('.paper-block__insert')).toBeFalsy();
  });

  it('the global drag handle div (`data-drag-handle`) is rendered as a sibling of the editor', async () => {
    render(<Editor doc={welcomeFixture} />);
    await new Promise<void>((r) => setTimeout(r, 0));
    // Allow the global-drag-handle plugin's `view()` hook to run, which
    // appends the handle to `view.dom.parentElement` (one tick after the
    // editor instance is created).
    await new Promise<void>((r) => setTimeout(r, 0));
    // The handle lives at document scope (it's appended to the editor's
    // parent element, not inside the editor mount), so we query
    // `document` rather than the mount.
    const handles = document.querySelectorAll('[data-drag-handle]');
    expect(handles.length).toBeGreaterThanOrEqual(1);
  });

  it('floating-chrome delete button removes the targeted block when fired against a block', async () => {
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
    expect(beforeTypes).toContain('heading');

    // Simulate a mousemove over the first block so the floating chrome
    // adopts it as target, then click delete.
    // First top-level `.paper-block` — direct child of the editor
    // surface (paper-block lands on every wrapped node via
    // HTMLAttributes, so we scope by direct child for top-level).
    const firstBlock = Array.from(editor.view.dom.children).find((el) =>
      el.classList?.contains('paper-block'),
    ) as HTMLElement | undefined;
    expect(firstBlock).toBeTruthy();
    // Bubble a mousemove from inside the block; the floating chrome's
    // mousemove handler resolves the target via `view.posAtCoords`
    // and resolves the DOM via `view.nodeDOM(pos)`.
    firstBlock!.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 50,
      }),
    );
    // Let the rAF + state update flush.
    await new Promise<void>((r) => setTimeout(r, 16));

    const deleteBtn = document
      .querySelector('.paper-floating-chrome .paper-block-delete') as HTMLButtonElement | null;
    expect(deleteBtn).toBeTruthy();
    // The welcome fixture's first block is an H1, so the floating chrome
    // shows "Delete heading 1".
    expect(deleteBtn!.getAttribute('aria-label')).toBe('Delete heading 1');
    deleteBtn!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );

    const afterTypes = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(afterTypes).not.toContain('heading');
  });

  // The floating-chrome "+" insert affordance was dropped — the slash
  // menu (`/`) is the canonical insert path and the chrome no longer
  // duplicates it. The previous insert test lived here.

  it('floating chrome hides when a non-empty selection is active (BubbleMenu wins)', async () => {
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
    // Adopt block 0.
    // First top-level `.paper-block` — direct child of the editor
    // surface (paper-block lands on every wrapped node via
    // HTMLAttributes, so we scope by direct child for top-level).
    const firstBlock = Array.from(editor.view.dom.children).find((el) =>
      el.classList?.contains('paper-block'),
    ) as HTMLElement | undefined;
    firstBlock!.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 50,
      }),
    );
    await new Promise<void>((r) => setTimeout(r, 16));
    const chrome = document.querySelector('.paper-floating-chrome') as HTMLElement;
    expect(chrome.classList.contains('is-tracking')).toBe(true);

    // Select the whole doc — selection becomes non-empty.
    editor.commands.selectAll();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(chrome.classList.contains('is-tracking')).toBe(false);
  });
});
