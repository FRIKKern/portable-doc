/**
 * @vitest-environment jsdom
 *
 * A4 — FormatBubble (inline-format BubbleMenu UI). Covers the paperflow-owned
 * toolbar shape; the @tiptap/react BubbleMenu substrate around it is covered
 * separately by the Editor.tsx mount tests + the live editor selection
 * sketches in Editor.test.tsx.
 *
 * Coverage matrix
 * ---------------
 *   1. Renders 4 buttons with correct aria-labels (B / I / </> / Link).
 *   2. Clicking each button invokes the matching editor chain command.
 *   3. `aria-pressed` reflects `editor.isActive(<mark>)`.
 *   4. Clicking the link button opens the inline URL input.
 *   5. Enter on the link input applies the link via
 *      `editor.chain().focus().extendMarkRange('link').setLink({ href }).run()`.
 *   6. Escape on the link input cancels (no command issued, input closes).
 *   7. When `isActive('link')` is true, the link button surfaces a remove
 *      affordance; clicking it calls `unsetLink`.
 *   8. CSS resolves `--paper-bubble-menu-z` (= 20) > `--paper-block-chrome-z`
 *      (= 10) — direct CSS file inspection, the same shape as A2's spec.
 *   9. Touch sizing: at <768px the bubble's CSS rule references
 *      `var(--paper-bubble-menu-touch, 44px)`.
 *  10. `prefers-reduced-motion` collapses `--motion-bubble-menu-open` to 0ms
 *      (the bubble's open animation references this token).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FormatBubble } from './FormatBubble.js';

// ---------------------------------------------------------------------------
// Mock editor — exposes the bits FormatBubble reads (`isActive`,
// `getAttributes`, `on`/`off`, `chain`). Each chain method returns the chain,
// `run` finishes; we record which terminal commands fired.
// ---------------------------------------------------------------------------

interface FakeEditor {
  isActive: ReturnType<typeof vi.fn>;
  getAttributes: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  chain: ReturnType<typeof vi.fn>;
  /** Captured calls: ['toggleBold'], ['setLink', { href: '…' }], … */
  _calls: Array<[string, unknown?]>;
}

function makeEditor(opts?: {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: boolean;
  href?: string;
}): FakeEditor {
  const fake: FakeEditor = {
    isActive: vi.fn(),
    getAttributes: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    chain: vi.fn(),
    _calls: [],
  };
  fake.isActive.mockImplementation((mark: string) => {
    if (mark === 'bold') return !!opts?.bold;
    if (mark === 'italic') return !!opts?.italic;
    if (mark === 'code') return !!opts?.code;
    if (mark === 'link') return !!opts?.link;
    return false;
  });
  fake.getAttributes.mockImplementation((mark: string) => {
    if (mark === 'link') return { href: opts?.href ?? '' };
    return {};
  });
  // Build a chain that records the terminal mark-toggle / link command.
  function chain() {
    const c: Record<string, unknown> = {
      focus: () => c,
      toggleBold: () => {
        fake._calls.push(['toggleBold']);
        return c;
      },
      toggleItalic: () => {
        fake._calls.push(['toggleItalic']);
        return c;
      },
      toggleCode: () => {
        fake._calls.push(['toggleCode']);
        return c;
      },
      extendMarkRange: (mark: string) => {
        fake._calls.push(['extendMarkRange', mark]);
        return c;
      },
      setLink: (attrs: { href: string }) => {
        fake._calls.push(['setLink', attrs]);
        return c;
      },
      unsetLink: () => {
        fake._calls.push(['unsetLink']);
        return c;
      },
      run: () => true,
    };
    return c;
  }
  fake.chain.mockImplementation(chain);
  return fake;
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// 1. Renders four buttons with aria-labels
// ---------------------------------------------------------------------------

describe('FormatBubble — toolbar shape', () => {
  it('renders the four mark buttons with correct aria-labels', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inline code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Link' })).toBeTruthy();
  });

  it('exposes the toolbar landmark via role="toolbar" + aria-label', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Inline format' });
    expect(toolbar).toBeTruthy();
    expect(toolbar.classList.contains('paper-format-bubble')).toBe(true);
    expect(toolbar.getAttribute('data-testid')).toBe('bubble-menu');
  });
});

// ---------------------------------------------------------------------------
// 2. Button clicks invoke the matching chain command
// ---------------------------------------------------------------------------

describe('FormatBubble — chain command wiring', () => {
  it('Bold click runs editor.chain().focus().toggleBold().run()', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(editor._calls.some((c) => c[0] === 'toggleBold')).toBe(true);
  });

  it('Italic click runs toggleItalic', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(editor._calls.some((c) => c[0] === 'toggleItalic')).toBe(true);
  });

  it('Inline code click runs toggleCode', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inline code' }));
    expect(editor._calls.some((c) => c[0] === 'toggleCode')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. aria-pressed reflects isActive
// ---------------------------------------------------------------------------

describe('FormatBubble — aria-pressed mirrors editor.isActive', () => {
  it('Bold button is aria-pressed when isActive("bold") returns true', () => {
    const editor = makeEditor({ bold: true });
    render(<FormatBubble editor={editor as unknown as never} />);
    expect(
      screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('Bold button is NOT aria-pressed when isActive("bold") returns false', () => {
    const editor = makeEditor({ bold: false });
    render(<FormatBubble editor={editor as unknown as never} />);
    expect(
      screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('all three mark buttons mirror their isActive state in parallel', () => {
    const editor = makeEditor({ bold: true, italic: false, code: true });
    render(<FormatBubble editor={editor as unknown as never} />);
    expect(
      screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByRole('button', { name: 'Inline code' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 4–7. Link affordance
// ---------------------------------------------------------------------------

describe('FormatBubble — link affordance', () => {
  it('clicking the link button opens the inline URL input', async () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    expect(screen.queryByTestId('bubble-link-row')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByTestId('bubble-link-row')).toBeTruthy();
    expect(screen.getByLabelText('Link URL')).toBeTruthy();
  });

  it('Enter on the URL input applies the link via setLink', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByLabelText('Link URL') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Chain should include extendMarkRange('link') + setLink({ href }).
    expect(editor._calls.some((c) => c[0] === 'extendMarkRange' && c[1] === 'link')).toBe(true);
    const setLink = editor._calls.find((c) => c[0] === 'setLink');
    expect(setLink).toBeTruthy();
    expect((setLink?.[1] as { href: string }).href).toBe('https://example.com');
    // Input closes after Enter.
    expect(screen.queryByTestId('bubble-link-row')).toBeNull();
  });

  it('Escape on the URL input cancels without issuing a command', () => {
    const editor = makeEditor();
    render(<FormatBubble editor={editor as unknown as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const input = screen.getByLabelText('Link URL') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(editor._calls.some((c) => c[0] === 'setLink')).toBe(false);
    expect(screen.queryByTestId('bubble-link-row')).toBeNull();
  });

  it('when isActive("link") is true, the link button surfaces edit/remove + Remove triggers unsetLink', () => {
    const editor = makeEditor({ link: true, href: 'https://existing.test' });
    render(<FormatBubble editor={editor as unknown as never} />);
    // The accessible name switches when the selection already has a link.
    const linkBtn = screen.getByRole('button', { name: 'Edit or remove link' });
    expect(linkBtn.getAttribute('data-link-state')).toBe('linked');
    expect(linkBtn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(linkBtn);
    // Pre-seeded with the existing href.
    const input = screen.getByLabelText('Link URL') as HTMLInputElement;
    expect(input.value).toBe('https://existing.test');
    // A Remove button appears and unsetLink fires on click.
    const removeBtn = screen.getByRole('button', { name: 'Remove link' });
    fireEvent.click(removeBtn);
    expect(editor._calls.some((c) => c[0] === 'unsetLink')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8–10. CSS file invariants — z-stack, touch, reduced-motion
// ---------------------------------------------------------------------------

describe('paper.css — A4 invariants (z-stack, touch, reduced-motion)', () => {
  function loadPaperCss(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.resolve(__dirname, 'styles/paper.css'), 'utf-8');
  }

  it('z-stack: --paper-bubble-menu-z resolves to a value >= 20 + > --paper-block-chrome-z', () => {
    const css = loadPaperCss();
    const blockZ = Number(
      css.match(/--paper-block-chrome-z:\s*(\d+)/)?.[1] ?? '0',
    );
    const bubbleZ = Number(
      css.match(/--paper-bubble-menu-z:\s*(\d+)/)?.[1] ?? '0',
    );
    expect(bubbleZ).toBeGreaterThanOrEqual(20);
    expect(bubbleZ).toBeGreaterThan(blockZ);
    // .paper-format-bubble itself references the token (not a magic number).
    expect(css).toMatch(/\.paper-format-bubble\s*\{[^}]*z-index:\s*var\(--paper-bubble-menu-z[^)]*\)/);
  });

  it('touch sizing: at <768px the bubble button reads var(--paper-bubble-menu-touch)', () => {
    const css = loadPaperCss();
    // Walk every `@media (max-width: 767px)` block in the file (paper.css
    // has several — one for the column, one for the footer, one for the
    // bubble — and assert at least one scopes .paper-format-bubble__btn to
    // the touch-target var.
    const re = /@media \(max-width: 767px\) \{([\s\S]*?)\n\}\n/g;
    let m: RegExpExecArray | null;
    let foundBubbleBlock = false;
    while ((m = re.exec(css))) {
      const body = m[1] ?? '';
      if (
        body.includes('.paper-format-bubble__btn') &&
        /var\(--paper-bubble-menu-touch[^)]*\)/.test(body)
      ) {
        foundBubbleBlock = true;
        break;
      }
    }
    expect(foundBubbleBlock).toBe(true);
  });

  it('prefers-reduced-motion: --motion-bubble-menu-open collapses to 0ms', () => {
    const css = loadPaperCss();
    const reducedBlock = css.split('@media (prefers-reduced-motion: reduce)')[1];
    expect(reducedBlock).toBeTruthy();
    expect(reducedBlock).toMatch(/--motion-bubble-menu-open:\s*0ms/);
    // The bubble's open animation references the token, so when it collapses
    // to 0ms the fade-in disappears as the spec requires.
    expect(css).toMatch(/\.paper-format-bubble[^{]*\{[^}]*animation:[^;]*var\(--motion-bubble-menu-open/);
  });
});
