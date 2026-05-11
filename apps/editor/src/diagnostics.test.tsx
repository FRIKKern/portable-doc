/**
 * @vitest-environment jsdom
 *
 * v0.3 inline-diagnostics specs — disposition `rewrite` per the v0.4
 * test-triage CSV (A10 ships MarginDiagnostics in v0.4). The contents below
 * pin the v0.3 behavior; A10 will replace them with MarginDiagnostics.test.tsx.
 *
 * Skipped at the describe.skip layer for A1 — the props they pass to <Editor>
 * (selectedId / onSelect / dispatch) belong to the v0.3 three-panel composite
 * that A1 retired. Keeping the file so the historical contract is preserved
 * in source control until A10 rewrites it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FC } from 'react';
import { useReducer, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { Editor } from './Editor.js';
import { reducer } from './store.js';

beforeAll(() => {
  // jsdom defines scrollIntoView on Element but make it a vi.fn we can spy on.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => cleanup());

function Harness({ initial }: { initial: PortableDoc }) {
  const [doc, dispatch] = useReducer(reducer, initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The cast is intentional: this harness uses the v0.3 Editor signature
  // that A1 retired. A10 will rewrite this file with the v0.4 surface.
  const LegacyEditor = Editor as unknown as FC<{
    doc: PortableDoc;
    selectedId: string | null;
    onSelect: (id: string) => void;
    dispatch: typeof dispatch;
  }>;
  return (
    <>
      <LegacyEditor doc={doc} selectedId={selectedId} onSelect={setSelectedId} dispatch={dispatch} />
      <div data-testid="selected-id">{selectedId ?? ''}</div>
    </>
  );
}

// Code block with a single line over the 60-col limit → one issue on 'c1'.
const longCodeLine = 'x'.repeat(70);
const docOneIssue: PortableDoc = {
  version: 1,
  title: 'one-issue',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Title' },
    { id: 'c1', type: 'code', lang: 'js', value: longCodeLine },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'clean' }] },
  ],
};

describe.skip('A5 inline diagnostics (pinned to v0.3; A10 rewrites)', () => {
  it('renders a red dot only on the offending tile (one issue → one dot)', () => {
    render(<Harness initial={docOneIssue} />);
    expect(screen.getByTestId('diagnostics-dot-c1')).toBeTruthy();
    expect(screen.queryByTestId('diagnostics-dot-h1')).toBeNull();
    expect(screen.queryByTestId('diagnostics-dot-p1')).toBeNull();
  });

  it('tile without issues renders no dot', () => {
    const clean: PortableDoc = {
      version: 1,
      title: 'clean',
      blocks: [{ id: 'h1', type: 'heading', level: 1, text: 'ok' }],
    };
    render(<Harness initial={clean} />);
    expect(screen.queryByTestId('diagnostics-dot-h1')).toBeNull();
  });

  it('clicking the dot selects the block and calls scrollIntoView', () => {
    render(<Harness initial={docOneIssue} />);
    const dot = screen.getByTestId('diagnostics-dot-c1');
    const tile = screen.getByTestId('tile-c1');
    const spy = vi.spyOn(tile, 'scrollIntoView');
    fireEvent.click(dot);
    expect(screen.getByTestId('selected-id').textContent).toBe('c1');
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it("title attribute on the dot lists each issue's rule + message", () => {
    render(<Harness initial={docOneIssue} />);
    const dot = screen.getByTestId('diagnostics-dot-c1');
    const title = dot.getAttribute('title') ?? '';
    expect(title).toContain('content-constraint');
    expect(title).toContain('60');
  });

  it('multiple issues on same block aggregate into one dot with a count', () => {
    // Two oversize code lines on the same block.
    const docTwoIssues: PortableDoc = {
      version: 1,
      title: 'two-issues',
      blocks: [
        {
          id: 'c1',
          type: 'code',
          lang: 'js',
          value: `${'a'.repeat(70)}\n${'b'.repeat(80)}`,
        },
      ],
    };
    render(<Harness initial={docTwoIssues} />);
    const dot = screen.getByTestId('diagnostics-dot-c1');
    expect(dot.getAttribute('aria-label')).toBe('2 validation issues');
    expect(dot.getAttribute('data-count')).toBe('2');
    // Exactly one dot for the block, regardless of issue count.
    expect(screen.getAllByTestId('diagnostics-dot-c1')).toHaveLength(1);
  });

  it('doc-level issue (no blockId) renders top banner instead of any tile dot', () => {
    // Invalid version → schema failure → no blockId on the issue.
    const badDoc = {
      version: 999,
      title: 'bad',
      blocks: [],
    } as unknown as PortableDoc;
    render(<Harness initial={badDoc} />);
    const banner = screen.getByTestId('doc-level-diagnostics');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Doc-level issues');
  });

  it('banner is hidden when there are no doc-level issues', () => {
    render(<Harness initial={docOneIssue} />);
    expect(screen.queryByTestId('doc-level-diagnostics')).toBeNull();
  });
});
