/**
 * @vitest-environment jsdom
 *
 * A10 — MarginDiagnostics: calm margin notes in the right gutter (≥768px)
 * or inline below the block (<768px). Replaces v0.3's red-dot inline
 * diagnostics per the v0.4 test-triage CSV (apps/editor/src/diagnostics.
 * test.tsx — disposition `rewrite`).
 *
 * The v0.3 specs were wrapped in `describe.skip` during A1 (the props they
 * passed to <Editor> belonged to the retired three-panel composite). A10
 * unwraps + rewrites for the new MarginDiagnostics surface.
 *
 * Coverage (≥8 specs per the A10 acceptance gate):
 *   1. one margin note per issue with a `blockId`.
 *   2. doc-level issues (no blockId) → no margin note.
 *   3. each note renders rule code + message.
 *   4. note's vertical position aligns with the offending block (mocked
 *      getBoundingClientRect).
 *   5. click on a note focuses + scrolls the offending block.
 *   6. narrow viewport (<768px) → notes render inline, not in the gutter.
 *   7. no red / alert / danger color classes anywhere.
 *   8. debounced: rapid prop changes do NOT re-validate every keystroke.
 *   9. each note exposes role=status + aria-live=polite + aria-label for
 *      the rule code (grill Q12 accessibility).
 *  10. clean doc renders no margin diagnostics container.
 *  11. multi-block issues each get their own margin note.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';

// Spy on validateDoc by wrapping the real module export. The wrapper lets
// us assert on call counts without breaking the validator's behavior.
const validateSpy = vi.fn();
vi.mock('@portable-doc/core', async () => {
  const actual = await vi.importActual<typeof import('@portable-doc/core')>(
    '@portable-doc/core',
  );
  return {
    ...actual,
    validateDoc: (doc: unknown) => {
      validateSpy(doc);
      return actual.validateDoc(doc);
    },
  };
});

import { Editor } from './Editor.js';

// jsdom doesn't implement Range.getClientRects on text nodes; ProseMirror
// calls it after every transaction. Stub so TipTap mount doesn't throw.
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
  // Element.scrollIntoView is undefined in jsdom; stub so click-to-scroll
  // doesn't blow up. Made a vi.fn so individual specs can spy on it.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// matchMedia helpers — drive the narrow-viewport branch deterministically.
// ---------------------------------------------------------------------------

function setMatchMedia(narrow: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width: 767px') ? narrow : !narrow,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  setMatchMedia(false);
});

// ---------------------------------------------------------------------------
// Fixtures — docs with shapes the validator surfaces as block-level issues.
// ---------------------------------------------------------------------------

const longCodeLine = 'x'.repeat(70);

/** Welcome-style doc with ONE block-level issue: code line > 60 cols. */
const docOneIssue: PortableDoc = {
  version: 1,
  title: 'one-issue',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Title' },
    { id: 'c1', type: 'code', lang: 'js', value: longCodeLine },
    {
      id: 'p1',
      type: 'paragraph',
      content: [{ type: 'text', value: 'clean paragraph' }],
    },
  ],
};

/** Two issues on two different blocks — code-line + heading-too-long. */
const docTwoBlockIssues: PortableDoc = {
  version: 1,
  title: 'two-issues',
  blocks: [
    {
      id: 'h1',
      type: 'heading',
      level: 1,
      text: 'x'.repeat(120), // > 80 char heading limit
    },
    { id: 'c1', type: 'code', lang: 'js', value: longCodeLine },
  ],
};

/** Clean doc — no issues anywhere. */
const cleanDoc: PortableDoc = {
  version: 1,
  title: 'clean',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'ok' },
    {
      id: 'p1',
      type: 'paragraph',
      content: [{ type: 'text', value: 'fine' }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('A10 MarginDiagnostics — calm margin notes', () => {
  it('renders one margin note per issue with a blockId', async () => {
    vi.useFakeTimers();
    render(<Editor doc={docOneIssue} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const note = screen.queryByTestId('margin-note-c1');
    expect(note).toBeTruthy();
    // No note for the clean heading or paragraph.
    expect(screen.queryByTestId('margin-note-h1')).toBeNull();
    expect(screen.queryByTestId('margin-note-p1')).toBeNull();
    vi.useRealTimers();
  });

  it('filters out doc-level issues (no blockId) from the margin notes', async () => {
    // Schema-level failure — `version: 999` is out of range → the issue
    // has no `blockId`, so MarginDiagnostics must NOT render a note for
    // it. The footer count (A8) handles doc-level issues elsewhere.
    const badDoc = {
      version: 999,
      title: 'bad',
      blocks: [],
    } as unknown as PortableDoc;
    vi.useFakeTimers();
    render(<Editor doc={badDoc} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // Container itself is absent because there are no block-level issues.
    expect(screen.queryByTestId('margin-diagnostics')).toBeNull();
    vi.useRealTimers();
  });

  it('each note renders both rule code and message', async () => {
    vi.useFakeTimers();
    render(<Editor doc={docOneIssue} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const note = screen.getByTestId('margin-note-c1');
    expect(note.querySelector('.paper-margin-diagnostics__rule')?.textContent)
      .toBe('content-constraint');
    const msg = note.querySelector('.paper-margin-diagnostics__message')
      ?.textContent ?? '';
    expect(msg).toContain('60'); // code line length constraint
    vi.useRealTimers();
  });

  it('positions the note vertically aligned with the offending block', async () => {
    // Mock getBoundingClientRect on .paper-block elements: first block at
    // y=0, second at y=120, third at y=240. Note for c1 (index 1) should
    // get top ~120 (relative to the diagnostics container, mocked to 0).
    vi.useFakeTimers();
    const { container } = render(<Editor doc={docOneIssue} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const blocks = container.querySelectorAll<HTMLElement>('.paper-block');
    blocks.forEach((el, idx) => {
      el.getBoundingClientRect = () => ({
        x: 0, y: idx * 120, width: 600, height: 80,
        top: idx * 120, left: 0, right: 600, bottom: idx * 120 + 80,
        toJSON: () => ({}),
      });
    });
    const diagContainer = container.querySelector<HTMLElement>(
      '.paper-margin-diagnostics',
    );
    if (diagContainer) {
      diagContainer.getBoundingClientRect = () => ({
        x: 700, y: 0, width: 240, height: 600,
        top: 0, left: 700, right: 940, bottom: 600,
        toJSON: () => ({}),
      });
    }
    // Force a re-layout by dispatching window.resize, which the
    // MarginDiagnostics effect listens for.
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(50);
    });
    const note = screen.getByTestId('margin-note-c1');
    // c1 is the second block (idx=1); top should be 120.
    expect(note.style.top).toBe('120px');
    vi.useRealTimers();
  });

  it('clicking a note focuses + scrolls the offending block', async () => {
    vi.useFakeTimers();
    const { container } = render(<Editor doc={docOneIssue} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const note = screen.getByTestId('margin-note-c1');
    const blocks = container.querySelectorAll<HTMLElement>('.paper-block');
    // c1 is at index 1; spy on that element's scrollIntoView.
    const targetBlock = blocks[1];
    expect(targetBlock).toBeTruthy();
    const spy = vi.spyOn(targetBlock!, 'scrollIntoView');
    await act(async () => {
      fireEvent.click(note);
      vi.advanceTimersByTime(50);
    });
    expect(spy).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'smooth',
    });
    vi.useRealTimers();
  });

  it('renders notes inline (not in the gutter) at <768px', async () => {
    setMatchMedia(true); // matchMedia('(max-width: 767px)') → matches
    vi.useFakeTimers();
    render(<Editor doc={docOneIssue} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const wrapper = screen.getByTestId('margin-diagnostics');
    expect(wrapper.classList.contains('paper-margin-diagnostics--inline'))
      .toBe(true);
    expect(wrapper.getAttribute('data-narrow')).toBe('true');
    // Inline notes do NOT carry absolute top positions.
    const note = screen.getByTestId('margin-note-c1');
    expect(note.style.top).toBe('');
    vi.useRealTimers();
  });

  it('uses no red / alert / danger color classes — calm tone only', async () => {
    vi.useFakeTimers();
    const { container } = render(<Editor doc={docTwoBlockIssues} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const root = container.querySelector('.paper-margin-diagnostics');
    expect(root).toBeTruthy();
    // No element under the diagnostics container should carry any
    // alarm-coded class name.
    const banned = root!.querySelectorAll(
      '.red, .alert, .danger, [data-tone="danger"]',
    );
    expect(banned.length).toBe(0);
    vi.useRealTimers();
  });

  it('debounces validateDoc on rapid prop changes (not every keystroke)', () => {
    vi.useFakeTimers();
    validateSpy.mockClear();
    const { rerender } = render(<Editor doc={docOneIssue} />);

    // The initial mount synchronously evaluates `validateDoc(debouncedDoc)`
    // (debouncedDoc seeded with the prop's value) — that's the one allowed
    // call BEFORE the debounce window. Clear it and assert that rapid
    // prop changes stay quiet.
    validateSpy.mockClear();

    // Rapid-fire five doc changes in <300ms — none should trigger a
    // validateDoc call until the debounce settles.
    for (let i = 0; i < 5; i++) {
      const next: PortableDoc = {
        ...docOneIssue,
        title: `iter-${i}`,
      };
      act(() => {
        rerender(<Editor doc={next} />);
      });
      act(() => {
        vi.advanceTimersByTime(50); // 5 × 50ms = 250ms inside the 300ms window
      });
    }
    // No call yet — debounce hasn't settled.
    expect(validateSpy).not.toHaveBeenCalled();

    // Settle the debounce.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Exactly one validateDoc fires for the final settled doc — proving
    // intermediate keystrokes were absorbed.
    expect(validateSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('exposes role=status + aria-live=polite + aria-label on the rule code', async () => {
    vi.useFakeTimers();
    render(<Editor doc={docOneIssue} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const note = screen.getByTestId('margin-note-c1');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.getAttribute('aria-live')).toBe('polite');
    // The rule code span carries its own aria-label so screen readers
    // announce "Rule: content-constraint" rather than the raw token.
    const ruleSpan = note.querySelector('.paper-margin-diagnostics__rule');
    expect(ruleSpan?.getAttribute('aria-label')).toBe(
      'Rule: content-constraint',
    );
    // Each note is a real <button> — Tab-reachable + keyboard activatable.
    expect(note.tagName.toLowerCase()).toBe('button');
    vi.useRealTimers();
  });

  it('renders no diagnostics container at all for a clean doc', async () => {
    vi.useFakeTimers();
    render(<Editor doc={cleanDoc} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId('margin-diagnostics')).toBeNull();
    vi.useRealTimers();
  });

  it('renders separate margin notes for multi-block issues', async () => {
    vi.useFakeTimers();
    render(<Editor doc={docTwoBlockIssues} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // Both blocks have issues; expect a note for each.
    expect(screen.getByTestId('margin-note-h1')).toBeTruthy();
    expect(screen.getByTestId('margin-note-c1')).toBeTruthy();
    vi.useRealTimers();
  });
});
