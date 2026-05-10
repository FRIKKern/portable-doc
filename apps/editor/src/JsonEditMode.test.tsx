// @vitest-environment jsdom
/**
 * Specs for the hidden JSON-edit-mode overlay (A7).
 *
 * Coverage:
 *   1. Cmd+Shift+J opens the overlay (mounted via App so the global keybind
 *      fires).
 *   2. Esc closes without saving — confirm()=true path; onSave never called.
 *   3. Valid edit + Cmd+S saves cleanly — onSave receives the parsed doc.
 *   4. Parse-error blocks save — onSave NOT called; "Parse error" visible.
 *   5. validateDoc issues block save — onSave NOT called; validation message
 *      visible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PortableDoc } from '@portable-doc/core';
import { App } from './App.js';
import { JsonEditMode } from './JsonEditMode.js';

afterEach(() => {
  cleanup();
});

const baseDoc: PortableDoc = {
  version: 1,
  title: 'Hello',
  blocks: [{ id: 'h1', type: 'heading', level: 1, text: 'Original' }],
};

function fireCmdShiftJ() {
  fireEvent.keyDown(window, { key: 'j', metaKey: true, shiftKey: true });
}

describe('JsonEditMode', () => {
  it('Cmd+Shift+J opens the overlay (rendered through App)', () => {
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'JSON edit mode' })).toBeNull();
    act(() => {
      fireCmdShiftJ();
    });
    expect(screen.getByRole('dialog', { name: 'JSON edit mode' })).toBeTruthy();
  });

  it('Esc closes without saving (confirm path skipped because draft is unchanged)', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<JsonEditMode doc={baseDoc} open onClose={onClose} onSave={onSave} />);
    // No edit → not dirty → Esc closes without prompting.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Esc with unsaved edits prompts confirm; on confirm=true closes without saving', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<JsonEditMode doc={baseDoc} open onClose={onClose} onSave={onSave} />);
    const ta = screen.getByLabelText('JSON document') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: ta.value.replace('Original', 'Edited') } });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('valid edit + Cmd+S saves cleanly', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<JsonEditMode doc={baseDoc} open onClose={onClose} onSave={onSave} />);
    const ta = screen.getByLabelText('JSON document') as HTMLTextAreaElement;
    const next = JSON.parse(ta.value) as PortableDoc;
    (next.blocks[0] as { text: string }).text = 'Renamed';
    fireEvent.change(ta, { target: { value: JSON.stringify(next, null, 2) } });
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as PortableDoc;
    expect((saved.blocks[0] as { text: string }).text).toBe('Renamed');
  });

  it('invalid JSON blocks save and shows a Parse error', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<JsonEditMode doc={baseDoc} open onClose={onClose} onSave={onSave} />);
    const ta = screen.getByLabelText('JSON document') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{not json' } });
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/Parse error/)).toBeTruthy();
    });
  });

  it('validateDoc issues block save (invalid callout tone)', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const docWithCallout: PortableDoc = {
      version: 1,
      title: 't',
      blocks: [
        {
          id: 'c1',
          type: 'callout',
          tone: 'info',
          title: 'Note',
          content: [{ type: 'text', value: 'body' }],
        },
      ],
    };
    render(<JsonEditMode doc={docWithCallout} open onClose={onClose} onSave={onSave} />);
    const ta = screen.getByLabelText('JSON document') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: ta.value.replace('"info"', '"rainbow"') } });
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true });
    });
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/validation issue/i)).toBeTruthy();
    });
  });
});
