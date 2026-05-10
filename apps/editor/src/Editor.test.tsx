/**
 * @vitest-environment happy-dom
 *
 * A3 — slash-command insertion: the Editor mounts a SlashPopover that
 * opens on `/` keypress, anywhere on the page (focus or no focus). These
 * specs render the Editor in isolation (no PreviewStrip, no React.lazy
 * Web chunk) so they don't share fate with the lazy-loading flakes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useReducer, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { Editor } from './Editor.js';
import { reducer } from './store.js';

afterEach(() => {
  cleanup();
});

const fixture: PortableDoc = {
  version: 1,
  title: 'A3 fixture',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Alpha' },
    { id: 'p1', type: 'paragraph', content: [{ type: 'text', value: 'Beta' }] },
  ],
};

function Harness({ initialSelected = null }: { initialSelected?: string | null }) {
  const [doc, dispatch] = useReducer(reducer, fixture);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  return (
    <Editor
      doc={doc}
      selectedId={selectedId}
      onSelect={setSelectedId}
      dispatch={dispatch}
    />
  );
}

describe('Editor — slash-command insertion (A3)', () => {
  it('pressing "/" anywhere opens the SlashPopover', () => {
    render(<Harness />);
    expect(screen.queryByTestId('slash-popover')).toBeNull();
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByTestId('slash-popover')).toBeTruthy();
  });

  it('"/" then Enter inserts a heading after the selected block', () => {
    render(<Harness initialSelected="h1" />);
    fireEvent.keyDown(window, { key: '/' });
    // First filter result is "heading" — Enter inserts it.
    fireEvent.keyDown(screen.getByTestId('slash-input'), { key: 'Enter' });
    // Block count grows from 2 → 3.
    expect(screen.getByText(/Blocks \(3\)/)).toBeTruthy();
  });

  it('"/" with no selection appends the new block at the end', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '/' });
    fireEvent.keyDown(screen.getByTestId('slash-input'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('slash-input'), { key: 'Enter' });
    expect(screen.getByText(/Blocks \(3\)/)).toBeTruthy();
  });

  it('typing "calout" then Enter inserts a callout (Levenshtein typo recovery)', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '/' });
    const input = screen.getByTestId('slash-input');
    fireEvent.change(input, { target: { value: 'calout' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/Blocks \(3\)/)).toBeTruthy();
  });

  it('clicking a popover item inserts that block type', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '/' });
    fireEvent.click(screen.getByTestId('slash-item-divider'));
    expect(screen.getByText(/Blocks \(3\)/)).toBeTruthy();
  });

  it('Esc closes the popover without inserting', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByTestId('slash-popover')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('slash-input'), { key: 'Escape' });
    expect(screen.queryByTestId('slash-popover')).toBeNull();
    expect(screen.getByText(/Blocks \(2\)/)).toBeTruthy();
  });

  it('"/" with Cmd / Ctrl held does NOT open the popover (modifier guard)', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(screen.queryByTestId('slash-popover')).toBeNull();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(screen.queryByTestId('slash-popover')).toBeNull();
  });
});
