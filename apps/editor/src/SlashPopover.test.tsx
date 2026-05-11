/**
 * @vitest-environment happy-dom
 *
 * A3 — SlashPopover (rewritten per v0.4 plan T4 CSV).
 *
 * The popover is now a forwardRef ReactRenderer-mounted component with two
 * call paths:
 *   1. Standalone (this test) — renders its own input + filter state.
 *   2. SlashCommand extension — props.items drive it, no input.
 *
 * The extension's wiring (allow predicate, command catalog dispatch,
 * Suggestion plugin shape) is covered in extensions/SlashCommand.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { SlashPopover } from './SlashPopover.js';
import type { SlashCommand } from './lib/slash-filter.js';

afterEach(() => cleanup());

function Harness({
  initialOpen = true,
  onSelect,
  onClose,
}: {
  initialOpen?: boolean;
  onSelect: (cmd: SlashCommand) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <SlashPopover
      open={open}
      onSelect={(c) => {
        onSelect(c);
        setOpen(false);
      }}
      onClose={() => {
        onClose?.();
        setOpen(false);
      }}
    />
  );
}

describe('SlashPopover — standalone', () => {
  it('renders 10 commands when open with empty filter', () => {
    render(<Harness onSelect={() => {}} />);
    expect(screen.getByTestId('slash-popover')).toBeTruthy();
    const items = screen.getAllByRole('option');
    expect(items.length).toBe(10);
  });

  it('returns null (not in DOM) when open is false', () => {
    render(<SlashPopover open={false} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId('slash-popover')).toBeNull();
  });

  it('typing in the input filters by substring', () => {
    render(<Harness onSelect={() => {}} />);
    const input = screen.getByTestId('slash-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'head' } });
    const items = screen.getAllByRole('option');
    expect(items.length).toBe(1);
    expect(screen.getByTestId('slash-item-heading')).toBeTruthy();
  });

  it('Levenshtein typo "calout" still finds callout (≤ 2 hit)', () => {
    render(<Harness onSelect={() => {}} />);
    const input = screen.getByTestId('slash-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'calout' } });
    expect(screen.getByTestId('slash-item-callout')).toBeTruthy();
  });

  it('ArrowDown moves selection, Enter inserts the active command', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByTestId('slash-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.type).toBe('paragraph');
  });

  it('ArrowUp clamps to 0 (cannot go above the first item)', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByTestId('slash-input');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect.mock.calls[0]?.[0]?.type).toBe('heading');
  });

  it('Tab inserts the active command (same as Enter)', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByTestId('slash-input');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.type).toBe('heading');
  });

  it('Esc fires onClose without inserting', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<Harness onSelect={onSelect} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('slash-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicking an item inserts that command (mousedown path)', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.mouseDown(screen.getByTestId('slash-item-divider'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.type).toBe('divider');
  });

  it('garbage filter shows the empty-state row', () => {
    render(<Harness onSelect={() => {}} />);
    fireEvent.change(screen.getByTestId('slash-input'), { target: { value: 'xxxxxxxx' } });
    expect(screen.queryAllByRole('option').length).toBe(0);
    expect(screen.getByTestId('slash-empty')).toBeTruthy();
  });

  it('a11y: outer container has role="listbox" and aria-label set', () => {
    render(<Harness onSelect={() => {}} />);
    const popover = screen.getByTestId('slash-popover');
    expect(popover.getAttribute('role')).toBe('listbox');
    expect(popover.getAttribute('aria-label')).toBe('Insert block');
    const input = screen.getByTestId('slash-input');
    expect(input.getAttribute('aria-label')).toBe('Filter blocks');
  });

  it('a11y: each row carries role="option" and aria-selected reflects activeIdx', () => {
    render(<Harness onSelect={() => {}} />);
    const rows = screen.getAllByRole('option');
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]?.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(screen.getByTestId('slash-input'), { key: 'ArrowDown' });
    const after = screen.getAllByRole('option');
    expect(after[0]?.getAttribute('aria-selected')).toBe('false');
    expect(after[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('passing items prop short-circuits the filter input (controlled-by-extension path)', () => {
    const onSelect = vi.fn();
    const items: SlashCommand[] = [
      { type: 'callout', label: 'Callout', hint: 'warn or info card' },
    ];
    render(
      <SlashPopover
        open
        items={items}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId('slash-input')).toBeNull();
    expect(screen.getAllByRole('option').length).toBe(1);
    expect(screen.getByTestId('slash-item-callout')).toBeTruthy();
  });
});
