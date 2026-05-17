/**
 * @vitest-environment happy-dom
 *
 * A6 — MoveBlock TipTap extension specs.
 *
 * Coverage matrix
 * ---------------
 *   1. moveBlock(0, 2) reorders forward — assert via getJSON.
 *   2. moveBlock(2, 0) reorders backward.
 *   3. moveBlock(0, 0) no-ops (returns false, no transaction).
 *   4. moveBlock(N, doc.childCount) lands at the end.
 *   5. Out-of-range fromIdx returns false.
 *   6. Out-of-range toIdx returns false.
 *   7. Cmd+Shift+ArrowUp keybinding maps to moveBlock(idx, idx-1).
 *   8. Cmd+Shift+ArrowDown keybinding maps to moveBlock(idx, idx+2)
 *      (slot semantics: insert AFTER the next sibling).
 *   9. currentBlockIdx returns the correct top-level index from the
 *      selection.
 *  10. The reorder is a single transaction — observable via the editor's
 *      transaction count over moveBlock + no `setContent` flash.
 *
 * Drag is now canonical TipTap node-drag (schema `draggable: true` +
 * `data-drag-handle` on the chrome button + StarterKit's dropcursor for
 * the visual indicator). The drop-side → slot math is exercised through
 * the moveBlock command directly here — testing the unit, not the
 * synthetic DOM event sequence that used to wrap it. The live
 * editor-DOM contract (`draggable="true"` on the button, etc.) is
 * covered by `withBlockChrome.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { MoveBlock, currentBlockIdx } from './MoveBlock.js';

// ---------------------------------------------------------------------------
// Headless TipTap helper — three paragraphs labelled A / B / C so getJSON
// inspections show the order plainly.
// ---------------------------------------------------------------------------

function mountThreeBlocks(): Editor {
  return new Editor({
    extensions: [StarterKit, MoveBlock],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'C' }] },
      ],
    },
  });
}

function textOrder(editor: Editor): string[] {
  const blocks = (editor.getJSON().content ?? []) as Array<{
    content?: Array<{ text?: string }>;
  }>;
  return blocks.map((n) => n.content?.[0]?.text ?? '');
}

const editorsToDestroy: Editor[] = [];
function track(editor: Editor): Editor {
  editorsToDestroy.push(editor);
  return editor;
}

afterEach(() => {
  while (editorsToDestroy.length > 0) {
    editorsToDestroy.pop()?.destroy();
  }
});

// ---------------------------------------------------------------------------
// 1–6. moveBlock command — the reorder math
// ---------------------------------------------------------------------------

describe('moveBlock(fromIdx, toIdx) — the command', () => {
  it('moves block 0 forward to slot 2 (A,B,C → B,A,C)', () => {
    const editor = track(mountThreeBlocks());
    expect(textOrder(editor)).toEqual(['A', 'B', 'C']);
    const ok = editor.commands.moveBlock(0, 2);
    expect(ok).toBe(true);
    expect(textOrder(editor)).toEqual(['B', 'A', 'C']);
  });

  it('moves block 2 backward to slot 0 (A,B,C → C,A,B)', () => {
    const editor = track(mountThreeBlocks());
    const ok = editor.commands.moveBlock(2, 0);
    expect(ok).toBe(true);
    expect(textOrder(editor)).toEqual(['C', 'A', 'B']);
  });

  it('moveBlock(0, 0) returns false (no-op, no transaction)', () => {
    const editor = track(mountThreeBlocks());
    const ok = editor.commands.moveBlock(0, 0);
    expect(ok).toBe(false);
    expect(textOrder(editor)).toEqual(['A', 'B', 'C']);
  });

  it('moveBlock(0, doc.childCount) lands at the end (A,B,C → B,C,A)', () => {
    const editor = track(mountThreeBlocks());
    const ok = editor.commands.moveBlock(0, editor.state.doc.childCount);
    expect(ok).toBe(true);
    expect(textOrder(editor)).toEqual(['B', 'C', 'A']);
  });

  it('out-of-range fromIdx returns false', () => {
    const editor = track(mountThreeBlocks());
    expect(editor.commands.moveBlock(-1, 1)).toBe(false);
    expect(editor.commands.moveBlock(99, 1)).toBe(false);
    expect(textOrder(editor)).toEqual(['A', 'B', 'C']);
  });

  it('out-of-range toIdx returns false', () => {
    const editor = track(mountThreeBlocks());
    expect(editor.commands.moveBlock(0, -1)).toBe(false);
    expect(editor.commands.moveBlock(0, 99)).toBe(false);
    expect(textOrder(editor)).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// 9. currentBlockIdx helper
// ---------------------------------------------------------------------------

describe('currentBlockIdx — selection → top-level idx', () => {
  it('returns 0 when the cursor sits inside the first paragraph', () => {
    const editor = track(mountThreeBlocks());
    editor.commands.setTextSelection(2); // somewhere inside "A"
    expect(currentBlockIdx(editor)).toBe(0);
  });

  it('returns 1 when the cursor sits inside the second paragraph', () => {
    const editor = track(mountThreeBlocks());
    // child 0 ("A") is nodeSize 3 (open + 1 text + close); child 1's
    // interior starts at pos 4. setTextSelection(5) lands inside "B".
    editor.commands.setTextSelection(5);
    expect(currentBlockIdx(editor)).toBe(1);
  });

  it('returns 2 when the cursor sits inside the third paragraph', () => {
    const editor = track(mountThreeBlocks());
    editor.commands.setTextSelection(8);
    expect(currentBlockIdx(editor)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7–8. Keyboard shortcut → moveBlock
// ---------------------------------------------------------------------------

type Bindings = Record<string, (ctx: { editor: Editor }) => boolean>;
function getBindings(): Bindings {
  const cfg = (MoveBlock as unknown as {
    config: { addKeyboardShortcuts?: () => Bindings };
  }).config;
  if (!cfg.addKeyboardShortcuts) {
    throw new Error('MoveBlock.addKeyboardShortcuts missing');
  }
  return cfg.addKeyboardShortcuts.call({} as never);
}

describe('addKeyboardShortcuts — Cmd+Shift+Arrow{Up,Down}', () => {
  it('exposes Mod-Shift-ArrowUp and Mod-Shift-ArrowDown handlers', () => {
    const bindings = getBindings();
    expect(typeof bindings['Mod-Shift-ArrowUp']).toBe('function');
    expect(typeof bindings['Mod-Shift-ArrowDown']).toBe('function');
  });

  it('Mod-Shift-ArrowUp moves the current block up one slot', () => {
    const editor = track(mountThreeBlocks());
    editor.commands.setTextSelection(5); // inside "B" (idx 1)
    expect(currentBlockIdx(editor)).toBe(1);
    const ok = getBindings()['Mod-Shift-ArrowUp']!({ editor });
    expect(ok).toBe(true);
    expect(textOrder(editor)).toEqual(['B', 'A', 'C']);
  });

  it('Mod-Shift-ArrowUp on the first block returns false (no-op)', () => {
    const editor = track(mountThreeBlocks());
    editor.commands.setTextSelection(2); // inside "A" (idx 0)
    const ok = getBindings()['Mod-Shift-ArrowUp']!({ editor });
    expect(ok).toBe(false);
    expect(textOrder(editor)).toEqual(['A', 'B', 'C']);
  });

  it('Mod-Shift-ArrowDown moves the current block down one slot', () => {
    const editor = track(mountThreeBlocks());
    editor.commands.setTextSelection(2); // inside "A" (idx 0)
    const ok = getBindings()['Mod-Shift-ArrowDown']!({ editor });
    expect(ok).toBe(true);
    expect(textOrder(editor)).toEqual(['B', 'A', 'C']);
  });

  it('Mod-Shift-ArrowDown on the last block returns false (no-op)', () => {
    const editor = track(mountThreeBlocks());
    editor.commands.setTextSelection(8); // inside "C" (idx 2)
    const ok = getBindings()['Mod-Shift-ArrowDown']!({ editor });
    expect(ok).toBe(false);
    expect(textOrder(editor)).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// 10. Single-transaction guarantee — no setContent flash
// ---------------------------------------------------------------------------

describe('moveBlock — single transaction', () => {
  it('fires exactly one transaction per reorder (no setContent re-sync)', () => {
    const editor = track(mountThreeBlocks());
    let txCount = 0;
    editor.on('transaction', () => {
      txCount++;
    });
    editor.commands.moveBlock(0, 2);
    expect(txCount).toBe(1);
    expect(textOrder(editor)).toEqual(['B', 'A', 'C']);
  });
});

// ---------------------------------------------------------------------------
// paper.css — A6 drag-indicator + dragging-source rules. The visual
// indicator's exact owner changed (StarterKit's dropcursor now paints
// during drag), but the warm-rust accent rules and the
// prefers-reduced-motion fallback still live in paper.css.
// ---------------------------------------------------------------------------

describe('paper.css — A6 drag indicator rules', () => {
  function loadPaperCss(): string {
    return require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../styles/paper.css'),
      'utf-8',
    );
  }

  it('declares .paper-drop-indicator with the warm-rust accent', () => {
    const css = loadPaperCss();
    // Locate the actual rule block (not the doc comment) by matching
    // `.paper-drop-indicator {` followed by the next closing brace.
    const ruleMatch = css.match(/\.paper-drop-indicator\s*\{([^}]+)\}/);
    expect(ruleMatch).toBeTruthy();
    const body = ruleMatch?.[1] ?? '';
    // The indicator references the warm-rust accent variable, not a
    // hard-coded color — keeps the design token discipline intact.
    expect(body).toMatch(/var\(--paper-accent-warm-rust\)/);
  });

  it('drop-indicator fade animation references --motion-drop-indicator', () => {
    const css = loadPaperCss();
    expect(css).toMatch(/animation:\s*paper-drop-indicator-fade\s+var\(--motion-drop-indicator\)/);
  });

  it('@media (prefers-reduced-motion: reduce) collapses --motion-drop-indicator to 0ms', () => {
    const css = loadPaperCss();
    const reducedBlock = css.split('@media (prefers-reduced-motion: reduce)')[1];
    expect(reducedBlock).toBeTruthy();
    expect(reducedBlock).toMatch(/--motion-drop-indicator:\s*0ms/);
  });

  it('declares .paper-block.is-dragging dimming rule', () => {
    const css = loadPaperCss();
    expect(css).toMatch(/\.paper-block\.is-dragging/);
  });
});
