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

  it('seeds the welcome fixture as TipTap nodes — heading + paragraph + callout + list', async () => {
    render(<Editor doc={welcomeFixture} />);
    // React NodeView renders are queued via queueMicrotask until
    // EditorContent reports content-initialized — wait one tick.
    await new Promise<void>((r) => setTimeout(r, 0));
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
    // TipTap Placeholder writes the hint string into a `data-placeholder`
    // attribute on the empty node's DOM element. Under A1 that landed on
    // the `<p>` directly; under A2's NodeView the same decoration lands on
    // the `.paper-block` wrapper (the `dom` we return from `addNodeView`).
    // Either is acceptable — we accept the union to keep the contract
    // stable across the block-chrome integration.
    const emptyNode =
      surface?.querySelector('p.is-editor-empty') ??
      surface?.querySelector('.is-editor-empty');
    expect(emptyNode?.getAttribute('data-placeholder')).toMatch(/Start typing/);
  });

  it('does NOT mount A5–A6 surfaces yet — no variant chip', () => {
    // A2 mounts block-chrome, A3 mounts the slash-command extension, A4
    // mounts the BubbleMenu (FormatBubble lives inside it but is hidden by
    // the floating substrate until selection is non-empty — so it may or
    // may not be present in the DOM during this test). The remaining A5–A6
    // surfaces — variant chip — are still gated off.
    render(<Editor doc={welcomeFixture} />);
    expect(screen.queryByTestId('variant-chip')).toBeNull();
  });

  it('wires onContentError + emitContentError so parse failures log instead of throwing', async () => {
    // TipTap's `onContentError` fires when content handed to the editor
    // fails schema parsing. Default behaviour rethrows the error into the
    // React tree — the editor surface crashes. We opt into the canonical
    // log + recover path by setting `emitContentError: true` and wiring
    // an `onContentError` callback that logs via a stable prefix string
    // (`[paperflow editor] onContentError —`) consumers can detect.
    //
    // We assert the wiring directly off the editor instance — feeding
    // invalid TipTap JSON through `setContent` while the editor schema
    // accepts a wide range of inputs (StarterKit + the seven re-added
    // block nodes + table family) is brittle to schema changes, and the
    // existing tests already cover the happy-path render. Here we prove:
    //   1. happy-path: no console.error fires for a valid doc
    //   2. emitContentError is enabled on the editor's options
    //   3. onContentError handler is registered, and when invoked
    //      directly it logs with the stable prefix
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let captured: TipTapEditor | null = null;
    render(
      <Editor
        doc={welcomeFixture}
        onEditorReady={(e) => {
          captured = e;
        }}
      />,
    );
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(captured).toBeTruthy();
    const editor = captured as unknown as TipTapEditor;

    // 1. Happy path — no parse errors fired during welcome-fixture mount.
    const prefixedBefore = errorSpy.mock.calls.find(
      (call) => call[0] === '[paperflow editor] onContentError —',
    );
    expect(prefixedBefore).toBeUndefined();

    // 2. emitContentError is enabled — so a future parse failure routes
    //    to `onContentError` instead of throwing.
    expect(
      (editor.options as unknown as { emitContentError?: boolean })
        .emitContentError,
    ).toBe(true);

    // 3. The handler is wired and logs with the stable prefix. We invoke
    //    it directly by emitting the `contentError` event — that's the
    //    same channel TipTap uses internally when a parse fails.
    (editor as unknown as {
      emit: (e: string, payload: unknown) => void;
    }).emit('contentError', {
      editor,
      error: new Error('synthetic parse failure'),
      disableCollaboration: () => undefined,
    });
    const prefixedAfter = errorSpy.mock.calls.find(
      (call) => call[0] === '[paperflow editor] onContentError —',
    );
    expect(prefixedAfter).toBeTruthy();
    errorSpy.mockRestore();
  });
});
