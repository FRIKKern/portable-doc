/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

import { useState } from 'react';
import { SlashPopover } from './SlashPopover.js';
import type { SlashCommand } from './lib/slash-filter.js';

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

describe('SlashPopover', () => {
  it('renders 10 commands when open with empty filter', () => {
    render(<Harness onSelect={() => {}} />);
    expect(screen.getByTestId('slash-popover')).toBeTruthy();
    const items = screen.getAllByRole('option');
    expect(items.length).toBe(10);
  });

  it('returns null (not in DOM) when open is false', () => {
    render(
      <SlashPopover open={false} onSelect={() => {}} onClose={() => {}} />,
    );
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
    // First item (heading) is the default active. ArrowDown -> paragraph.
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

  it('clicking an item inserts that command', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('slash-item-divider'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.type).toBe('divider');
  });

  it('garbage filter shows the empty-state row', () => {
    render(<Harness onSelect={() => {}} />);
    fireEvent.change(screen.getByTestId('slash-input'), { target: { value: 'xxxxxxxx' } });
    expect(screen.queryAllByRole('option').length).toBe(0);
    expect(screen.getByTestId('slash-empty')).toBeTruthy();
  });
});
