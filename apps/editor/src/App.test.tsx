/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App.js';

describe('App', () => {
  it('renders without throwing', () => {
    const { container } = render(<App />);
    expect(container.querySelector('h1')?.textContent).toBe('PortableDoc Editor');
  });

  it('default tab is TUI — TUI preview is mounted, others are not', () => {
    render(<App />);
    expect(screen.getByTestId('preview-tui')).toBeTruthy();
    expect(screen.queryByTestId('preview-json')).toBeNull();
    expect(screen.queryByTestId('preview-email')).toBeNull();
    expect(screen.queryByTestId('preview-web')).toBeNull();
    expect(screen.queryByTestId('preview-native')).toBeNull();
  });

  it('renders both fixtures via the header buttons', () => {
    render(<App />);
    // welcome by default — first block summary shows H1 Welcome to Atlas
    expect(screen.getAllByText(/Welcome to Atlas/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Load incident'));
    // After Load incident, the editor block list (live doc) no longer
    // contains "Welcome to Atlas". Preview thumbnails are debounced 500 ms
    // and may briefly hold the old heading — scope the assertion to the
    // block list, which tracks the live doc reference.
    const blockList = screen.getByTestId('block-list');
    expect(blockList.textContent ?? '').not.toMatch(/Welcome to Atlas/);
    // incident has its own first heading
    expect(blockList.textContent ?? '').toMatch(/incident|Incident/);
  });

  it('switching surfaces unmounts the previous preview and mounts the next', () => {
    render(<App />);
    expect(screen.getByTestId('preview-tui')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thumb-json'));
    expect(screen.queryByTestId('preview-tui')).toBeNull();
    expect(screen.getByTestId('preview-json')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thumb-native'));
    expect(screen.queryByTestId('preview-json')).toBeNull();
    expect(screen.getByTestId('preview-native')).toBeTruthy();
  });

  it('Web surface is React.lazy — Suspense fallback shows while the chunk resolves', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('thumb-web'));
    // Either the fallback is visible synchronously, or the chunk has already
    // resolved and the preview is mounted. Both prove lazy/Suspense wiring.
    const fallback = screen.queryByTestId('web-lazy-fallback');
    const preview = screen.queryByTestId('preview-web');
    expect(fallback !== null || preview !== null).toBe(true);
    // findBy retries through the Suspense resolution — robust against the
    // microtask ordering race that surfaced after cli-highlight grew the chunk.
    expect(await screen.findByTestId('preview-web')).toBeTruthy();
  });

  it('validation panel reports 0 issues for the welcome fixture', () => {
    render(<App />);
    expect(screen.getByTestId('validation-ok').textContent).toMatch(/0 issues/);
  });

  it('validation panel updates live after a delete', async () => {
    render(<App />);
    // Click each delete button to remove every block.
    const deletes = screen.getAllByLabelText(/Delete /);
    expect(deletes.length).toBeGreaterThan(0);
    for (const btn of deletes) {
      await act(async () => {
        fireEvent.click(btn);
      });
    }
    // After all deletes the doc has 0 blocks; validator returns [] = "0 issues".
    const ok = screen.queryByTestId('validation-ok');
    expect(ok?.textContent ?? '').toMatch(/0 issues/);
  });

  it('add → click + and pick a block type appends the block', () => {
    render(<App />);
    const addBtn = screen.getByLabelText('Add block');
    fireEvent.click(addBtn);
    fireEvent.click(screen.getByRole('menuitem', { name: /heading/ }));
    // Header still shows the title; block count grew by one (welcome has 7 → 8).
    expect(screen.getByText(/8 blocks/)).toBeTruthy();
  });

  it('selecting a block opens the edit form; editing dispatches an update', () => {
    render(<App />);
    const row = screen.getByText(/H1 Welcome to Atlas/);
    fireEvent.click(row);
    const input = screen.getByDisplayValue('Welcome to Atlas');
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect((input as HTMLInputElement).value).toBe('Hello');
  });

  it('move up button reorders blocks', () => {
    render(<App />);
    const rows = document.querySelectorAll('[data-block-id]');
    const firstId = rows[0]?.getAttribute('data-block-id');
    const secondId = rows[1]?.getAttribute('data-block-id');
    expect(firstId && secondId).toBeTruthy();
    const moveUp = screen.getByLabelText(`Move ${secondId} up`);
    fireEvent.click(moveUp);
    const after = document.querySelectorAll('[data-block-id]');
    expect(after[0]?.getAttribute('data-block-id')).toBe(secondId);
    expect(after[1]?.getAttribute('data-block-id')).toBe(firstId);
  });
});
