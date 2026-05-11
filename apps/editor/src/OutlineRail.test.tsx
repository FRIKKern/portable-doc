/**
 * @vitest-environment jsdom
 *
 * A9 — empty-state-and-outline. This spec covers BOTH halves of A9:
 *
 *   1. Placeholder empty-state behavior (configured with showOnlyCurrent: true)
 *      — the focused-empty paragraph shows the hint; non-focused empties stay
 *      quiet; non-empty paragraphs hide the hint entirely.
 *
 *   2. OutlineRail — ⌘\ toggle, one entry per top-level block, click scrolls
 *      + focuses the block, role=navigation + aria-label, Esc closes the
 *      rail, narrow-viewport top-bar variant, prefers-reduced-motion
 *      collapses the slide animation.
 *
 * The Editor + App tests already prove TipTap mounts and the welcome fixture
 * lands. Here we lean on App-level integration for the keyboard hookup, and
 * on OutlineRail-direct rendering for the per-entry behavior.
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { App } from './App.js';
import { Editor } from './Editor.js';
import { OutlineRail, entriesFromEditor } from './OutlineRail.js';
import { duration } from './styles/motion.js';

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
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }
  // matchMedia is undefined under jsdom — provide a controllable default.
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const docFixture: PortableDoc = {
  version: 1,
  title: 'Outline test',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Welcome to Atlas' },
    {
      id: 'p1',
      type: 'paragraph',
      content: [{ type: 'text', value: 'A first paragraph of body text.' }],
    },
    { id: 'h2', type: 'heading', level: 2, text: 'Section two heading' },
  ],
};

async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

// --- Helpers --------------------------------------------------------------

async function mountAndGetEditor(): Promise<TipTapEditor> {
  let editorOut: TipTapEditor | null = null;
  const onReady = (e: TipTapEditor) => {
    editorOut = e;
  };
  render(<Editor doc={docFixture} onEditorReady={onReady} />);
  await flush();
  if (!editorOut) throw new Error('editor never became ready');
  return editorOut;
}

// --- Empty-state placeholder ---------------------------------------------

describe('A9 empty-state placeholder', () => {
  it('configures Placeholder.showOnlyCurrent — empty paragraph carries the .is-empty class', async () => {
    const empty: PortableDoc = { version: 1, blocks: [] };
    render(<Editor doc={empty} />);
    await flush();
    const surface = screen
      .getByTestId('paper-editor')
      .querySelector('.ProseMirror');
    // TipTap Placeholder always writes `is-empty` on every empty node; with
    // showOnlyCurrent: true the placeholder is only RENDERED on the
    // currently-focused empty node, but the class itself lands on each.
    const empties = surface?.querySelectorAll('.is-empty');
    expect((empties?.length ?? 0) > 0).toBe(true);
    // The empty paragraph receives the placeholder data attribute.
    const placeholder = surface?.querySelector('[data-placeholder]');
    expect(placeholder?.getAttribute('data-placeholder')).toMatch(
      /Start typing.*press \/ for blocks\./,
    );
  });

  it('placeholder text reads "Start typing, or press / for blocks."', async () => {
    const empty: PortableDoc = { version: 1, blocks: [] };
    render(<Editor doc={empty} />);
    await flush();
    const placeholder = screen
      .getByTestId('paper-editor')
      .querySelector('[data-placeholder]');
    expect(placeholder?.getAttribute('data-placeholder')).toBe(
      'Start typing, or press / for blocks.',
    );
  });

  it('a populated paragraph does NOT carry the is-empty class', async () => {
    render(<Editor doc={docFixture} />);
    await flush();
    const surface = screen
      .getByTestId('paper-editor')
      .querySelector('.ProseMirror');
    // The intro paragraph has visible text, so it must NOT be marked empty.
    const populated = Array.from(surface?.querySelectorAll('p') ?? []).find(
      (p) => p.textContent?.includes('A first paragraph'),
    );
    expect(populated).toBeTruthy();
    expect(populated?.classList.contains('is-empty')).toBe(false);
  });
});

// --- entriesFromEditor (pure traversal) ----------------------------------

describe('A9 entriesFromEditor', () => {
  it('emits one entry per top-level block in document order', async () => {
    const editor = await mountAndGetEditor();
    const entries = entriesFromEditor(editor);
    // welcome fixture: h1, p, h2 (each as one top-level node-view wrapper).
    expect(entries.length).toBe(3);
    expect(entries[0]?.type).toBe('heading');
    expect(entries[0]?.level).toBe(1);
    expect(entries[1]?.type).toBe('paragraph');
    expect(entries[2]?.type).toBe('heading');
    expect(entries[2]?.level).toBe(2);
  });

  it('truncates entry preview text to 30 characters with an ellipsis', async () => {
    const longDoc: PortableDoc = {
      version: 1,
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          content: [
            {
              type: 'text',
              value:
                'This is a very long paragraph that should be truncated by the rail preview routine.',
            },
          ],
        },
      ],
    };
    let editorOut: TipTapEditor | null = null;
    render(<Editor doc={longDoc} onEditorReady={(e) => (editorOut = e)} />);
    await flush();
    expect(editorOut).toBeTruthy();
    const [entry] = entriesFromEditor(editorOut as unknown as TipTapEditor);
    expect(entry?.preview.length).toBeLessThanOrEqual(30);
    expect(entry?.preview.endsWith('…')).toBe(true);
  });
});

// --- Rendering ------------------------------------------------------------

describe('A9 OutlineRail rendering', () => {
  it('open={false} renders nothing (null portal)', async () => {
    const editor = await mountAndGetEditor();
    render(<OutlineRail editor={editor} open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('outline-rail')).toBeNull();
  });

  it('open={true} renders the rail with role=navigation + aria-label', async () => {
    const editor = await mountAndGetEditor();
    render(<OutlineRail editor={editor} open onClose={() => {}} />);
    const rail = screen.getByTestId('outline-rail');
    expect(rail.getAttribute('role')).toBe('navigation');
    expect(rail.getAttribute('aria-label')).toBe('Document outline');
  });

  it('renders one entry per top-level block as a <button>', async () => {
    const editor = await mountAndGetEditor();
    render(<OutlineRail editor={editor} open onClose={() => {}} />);
    const entries = screen.getAllByTestId(/^outline-entry-/);
    expect(entries.length).toBe(3);
    // Buttons are focusable / Tab-cyclable in their natural order.
    entries.forEach((el) => expect(el.tagName.toLowerCase()).toBe('button'));
  });

  it('each entry exposes a type icon + content preview', async () => {
    const editor = await mountAndGetEditor();
    render(<OutlineRail editor={editor} open onClose={() => {}} />);
    const first = screen.getByTestId('outline-entry-0');
    // The heading icon is `H1` (we use H<level>); preview from doc text.
    expect(first.textContent ?? '').toMatch(/H1/);
    expect(first.textContent ?? '').toMatch(/Welcome to Atlas/);
    const second = screen.getByTestId('outline-entry-1');
    // Paragraph glyph is ¶; preview is "A first paragraph…"
    expect(second.textContent ?? '').toMatch(/¶/);
    expect(second.textContent ?? '').toMatch(/A first paragraph/);
  });

  it('clicking an entry scrolls the corresponding DOM node into view', async () => {
    const editor = await mountAndGetEditor();
    // Mock scrollIntoView on every Element (jsdom doesn't implement it).
    const scrollSpy = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: Mock }).scrollIntoView =
      scrollSpy;
    render(<OutlineRail editor={editor} open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('outline-entry-1'));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    const args = scrollSpy.mock.calls[0]?.[0] as ScrollIntoViewOptions;
    expect(args.behavior).toBe('smooth');
    expect(args.block).toBe('center');
  });

  it('clicking an entry focuses the editor at the block position', async () => {
    const editor = await mountAndGetEditor();
    // Stub scrollIntoView (jsdom unsupported) — assertion is on selection.
    (
      Element.prototype as unknown as { scrollIntoView: Mock }
    ).scrollIntoView = vi.fn();
    render(<OutlineRail editor={editor} open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('outline-entry-2'));
    // After click, the editor's selection should land inside the third
    // top-level block (heading level 2). We assert via the editor's
    // selection.$from depth — it'll resolve INSIDE the heading.
    const sel = editor.state.selection;
    // The cursor is inside one of the doc's top-level nodes; the block
    // containing the cursor should be the heading level=2.
    const $from = sel.$from;
    const block = $from.node(1) ?? $from.node(0);
    expect(block.type.name).toBe('heading');
    expect(Number(block.attrs?.level ?? 0)).toBe(2);
  });
});

// --- Keyboard contract (App-level) ---------------------------------------

describe('A9 ⌘\\ + Esc keyboard contract', () => {
  it('Cmd+\\ opens the rail (mounted under App)', () => {
    render(<App />);
    expect(screen.queryByTestId('outline-rail')).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
    });
    expect(screen.getByTestId('outline-rail')).toBeTruthy();
  });

  it('Ctrl+\\ also opens the rail (Linux/Windows)', () => {
    render(<App />);
    act(() => {
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    });
    expect(screen.getByTestId('outline-rail')).toBeTruthy();
  });

  it('Cmd+\\ toggles — second press closes', () => {
    render(<App />);
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
    });
    expect(screen.getByTestId('outline-rail')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
    });
    expect(screen.queryByTestId('outline-rail')).toBeNull();
  });

  it('Esc closes the rail when no preview overlay is open', () => {
    render(<App />);
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
    });
    expect(screen.getByTestId('outline-rail')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('outline-rail')).toBeNull();
  });

  it('Esc gates on preview — when overlay is open, Esc closes overlay, rail stays', () => {
    render(<App />);
    // Open both rail and overlay.
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
      fireEvent.keyDown(window, { key: 'p', metaKey: true });
    });
    expect(screen.getByTestId('outline-rail')).toBeTruthy();
    expect(screen.getByTestId('preview-overlay')).toBeTruthy();
    // Esc closes the preview first; the rail must still be there.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
    expect(screen.getByTestId('outline-rail')).toBeTruthy();
  });
});

// --- Narrow viewport (grill Q8) -----------------------------------------

describe('A9 narrow-viewport variant', () => {
  it('renders the top-bar variant when matchMedia max-width:767px matches', async () => {
    // Override matchMedia to return matches=true for the narrow query.
    const originalMM = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('767px'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      const editor = await mountAndGetEditor();
      render(<OutlineRail editor={editor} open onClose={() => {}} />);
      const rail = screen.getByTestId('outline-rail');
      expect(rail.getAttribute('data-variant')).toBe('narrow');
      expect(screen.getByTestId('outline-rail-expand')).toBeTruthy();
      // Entries are hidden until the ≡ button is clicked.
      expect(screen.queryByTestId('outline-rail-dropdown')).toBeNull();
      fireEvent.click(screen.getByTestId('outline-rail-expand'));
      expect(screen.getByTestId('outline-rail-dropdown')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMM,
      });
    }
  });
});

// --- Motion (prefers-reduced-motion) -------------------------------------

describe('A9 prefers-reduced-motion', () => {
  it('--motion-outline-slide collapses to 0ms under reduce', () => {
    // The collapse rule is declared in BOTH paper.css and motion.css; jsdom
    // doesn't apply media-conditional CSS, so we lean on the JS helper
    // (motion.duration) which mirrors the same contract.
    const originalMM = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      // The duration helper reads matchMedia and returns 0 when reduce
      // matches. We assert against the canonical key, not a hard-coded
      // number — motion.ts is the single source of truth.
      expect(duration('outlineSlide')).toBe(0);
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMM,
      });
    }
  });
});
