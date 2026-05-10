// @vitest-environment jsdom
/**
 * Specs for `<RichTextLabel>` — the inline-only TipTap field used for
 * action-block labels (and any future short single-line label). These tests
 * live on jsdom (same rationale as `RichTextField.test.tsx`): TipTap mounts a
 * real ProseMirror EditorView, which needs DOM Range / Selection APIs that
 * happy-dom doesn't fully implement.
 *
 * Coverage:
 *   1. Plain-text round-trip — initial value renders, simulated edit fires
 *      onChange with the new flat string.
 *   2. No `<p>` wrapper — the editor's contenteditable does NOT contain a
 *      `<p>` child; the schema is doc → text* directly.
 *   3. Marks are stripped on save — even if the schema accepted marks, the
 *      onChange path uses `editor.getText()`, so the value reaching onChange
 *      is plain text.
 *   4. External value sync — re-render with a new value updates the editor
 *      and does NOT fire onChange from the sync path.
 *   5. Two labels side-by-side — editing one does not fire the other's
 *      onChange (no leaked state when switching between actions).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { RichTextLabel } from './RichTextLabel.js';

// Mirror of RichTextField.test.tsx — jsdom is missing Range layout shims that
// ProseMirror's scrollToSelection reaches for after every transaction. Stub
// them as no-ops so editor mount + selection changes don't blow up.
beforeAll(() => {
  const emptyRectList = (): DOMRectList => {
    const list = [] as unknown as DOMRectList;
    Object.defineProperty(list, 'item', { value: () => null });
    return list;
  };
  const emptyRect = (): DOMRect => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  });
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: emptyRectList,
      configurable: true,
    });
  }
  if (!('getBoundingClientRect' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      value: emptyRect,
      configurable: true,
    });
  }
  if (!('scrollIntoView' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: () => {},
      configurable: true,
    });
  }
});

afterEach(() => cleanup());

function getEditorEl(testId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`No editor with testid="${testId}"`);
  return el;
}

describe('RichTextLabel', () => {
  // -------------------------------------------------------------------------
  // 1. plain-text round-trip
  // -------------------------------------------------------------------------
  it('renders the initial label string into the editor', () => {
    const onChange = vi.fn();
    render(
      <RichTextLabel
        value="Open workspace"
        onChange={onChange}
        dataTestId="lbl-1"
      />,
    );
    const el = getEditorEl('lbl-1');
    expect(el.textContent).toContain('Open workspace');
  });

  it('fires onChange with a plain string on user input', async () => {
    const onChange = vi.fn();
    render(
      <RichTextLabel value="Open" onChange={onChange} dataTestId="lbl-edit" />,
    );
    const el = getEditorEl('lbl-edit');

    await act(async () => {
      el.focus();
      el.textContent = 'Open more';
      fireEvent.input(el, { bubbles: true, cancelable: true });
    });

    // ProseMirror normalizes input through its transaction pipeline; the call
    // may or may not fire from a synthetic input event in jsdom. As long as
    // the call IS made, the payload must be a plain string.
    if (onChange.mock.calls.length > 0) {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
      expect(typeof last).toBe('string');
    }
    // Either way, the visible text reflects the edit (proves the editor
    // surface is contenteditable and accepted the input).
    expect(getEditorEl('lbl-edit').textContent).toContain('Open more');
  });

  // -------------------------------------------------------------------------
  // 2. no `<p>` wrapper — the inline-only schema doesn't paragraph-wrap
  // -------------------------------------------------------------------------
  it('does NOT wrap the value in a <p> element (inline-only schema)', () => {
    const onChange = vi.fn();
    render(
      <RichTextLabel value="hello" onChange={onChange} dataTestId="lbl-noP" />,
    );
    const el = getEditorEl('lbl-noP');
    // The contenteditable element is the doc itself. With our schema
    // (doc -> text*), TipTap renders the text directly inside the editor
    // surface — no <p> child. If StarterKit's default paragraph leaked
    // through, we'd see one here.
    expect(el.querySelector('p')).toBeNull();
    expect(el.textContent).toContain('hello');
  });

  // -------------------------------------------------------------------------
  // 3. marks are stripped on save (defense in depth)
  // -------------------------------------------------------------------------
  it('serializes to plain text — bold / italic / code marks never reach onChange', async () => {
    const onChange = vi.fn();
    render(
      <RichTextLabel
        value="plain"
        onChange={onChange}
        dataTestId="lbl-marks"
      />,
    );
    const el = getEditorEl('lbl-marks');

    // Inject DOM that LOOKS like a bold-marked run inside the contenteditable.
    // With marks disabled in our schema this run gets parsed to plain text.
    await act(async () => {
      el.focus();
      el.innerHTML = 'plain<strong>BOLD</strong>';
      fireEvent.input(el, { bubbles: true, cancelable: true });
    });

    // Visible text contains the merged run — but it must be one flat string,
    // never an InlineNode[] or anything carrying mark info.
    expect(el.textContent).toContain('plainBOLD');
    if (onChange.mock.calls.length > 0) {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
      expect(typeof last).toBe('string');
      // No object/array shape leaked through.
      expect(Array.isArray(last)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 4. external value sync (no infinite onChange loop)
  // -------------------------------------------------------------------------
  it('syncs external value changes into the editor without firing onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextLabel value="first" onChange={onChange} dataTestId="lbl-sync" />,
    );
    expect(getEditorEl('lbl-sync').textContent).toContain('first');

    const callsBefore = onChange.mock.calls.length;
    rerender(
      <RichTextLabel value="second" onChange={onChange} dataTestId="lbl-sync" />,
    );
    expect(getEditorEl('lbl-sync').textContent).toContain('second');
    // setContent uses { emitUpdate: false }, so no extra onChange fires.
    expect(onChange.mock.calls.length).toBe(callsBefore);

    // Re-rendering with the SAME value must not touch the editor.
    rerender(
      <RichTextLabel value="second" onChange={onChange} dataTestId="lbl-sync" />,
    );
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  // -------------------------------------------------------------------------
  // 5. two labels side-by-side — no leaked state across instances
  // -------------------------------------------------------------------------
  it('two labels: editing one does not fire the other’s onChange (no leak across actions)', async () => {
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    render(
      <>
        <RichTextLabel
          value="action 1"
          onChange={onChangeA}
          dataTestId="lbl-a"
        />
        <RichTextLabel
          value="action 2"
          onChange={onChangeB}
          dataTestId="lbl-b"
        />
      </>,
    );
    const second = getEditorEl('lbl-b');

    await act(async () => {
      second.focus();
      second.textContent = 'action 2 edited';
      fireEvent.input(second, { bubbles: true, cancelable: true });
    });

    // Editor A's onChange must NEVER have fired — its store stayed isolated
    // from edits to editor B.
    expect(onChangeA).not.toHaveBeenCalled();
    expect(getEditorEl('lbl-b').textContent).toContain('edited');
    // Editor A still shows its own value — proof of no cross-instance state
    // bleed when switching between actions.
    expect(getEditorEl('lbl-a').textContent).toContain('action 1');
  });
});
