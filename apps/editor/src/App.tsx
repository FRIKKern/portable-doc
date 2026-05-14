/**
 * v0.4 — single centered column on warm cream paper.
 *
 * Replaces v0.3's three-panel grid (BlockList sidebar | center | PreviewStrip
 * sidebar) with one column, one editor, one footer. Block chrome, slash menu,
 * BubbleMenu, variant chip, drag-and-drop, ⌘P overlay, outline rail, and
 * diagnostics ALL land in A2–A10.
 *
 * Layout primitives:
 *   <div class="paper-app">                // full-height warm cream surface
 *     <main class="paper-column">          // 680px centered column
 *       <Editor />                         // ONE TipTap instance
 *     </main>
 *     <FooterStatus />                     // 36px fixed status strip (A8)
 *
 * Carryovers from v0.3:
 *   - McpProvider — state contract identical (A8 dissolved the v0.3 banner
 *     UI into the FooterStatus dot; the provider stays a pure state source).
 *   - JsonEditMode (Cmd+Shift+J power-user overlay) — kept verbatim per
 *     T4 disposition `keep`.
 */
import { useEffect, useRef, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import type { Editor as TipTapEditor } from '@tiptap/react';
import welcomeJson from '../../../examples/welcome.json';
import { Editor } from './Editor.js';
import { FooterStatus } from './FooterStatus.js';
import { JsonEditMode } from './JsonEditMode.js';
import { McpProvider } from './McpProvider.js';
import { OutlineRail } from './OutlineRail.js';
import { PreviewOverlay } from './PreviewOverlay.js';
import './styles/paper.css';

const welcome = welcomeJson as PortableDoc;

export function App(): JSX.Element {
  return (
    <McpProvider>
      <AppShell />
    </McpProvider>
  );
}

function AppShell(): JSX.Element {
  const [doc, setDoc] = useState<PortableDoc>(welcome);
  const [jsonModeOpen, setJsonModeOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // A9 — outline rail toggle + editor instance handed up from Editor.tsx
  // so the rail can read top-level blocks + drive scroll/focus.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [editor, setEditor] = useState<TipTapEditor | null>(null);

  // Reverse pipeline: the Editor converts TipTap state → PortableDoc on
  // every doc-affecting transaction and hands the AST to us via
  // `onChange`. We stash it in `doc` so the backends
  // (FooterStatus / PreviewOverlay / JsonEditMode) all see live edits.
  // Editor.tsx tracks its own emissions to avoid the setContent ↔
  // onUpdate loop — no debouncing needed at this layer.

  // Hidden Cmd+Shift+J / Ctrl+Shift+J shortcut toggles the JSON-edit-mode
  // overlay. Power-user escape hatch carried over from v0.3.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setJsonModeOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A7 — Cmd+P (Mac) / Ctrl+P (Linux/Windows) toggles the all-surfaces
  // preview overlay. Esc dismisses when open. We e.preventDefault() to
  // suppress the browser-print dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Shift+Cmd+P (Cmd+Shift+P) is reserved by browsers / not ours.
      // Plain ⌘P / Ctrl+P toggles; never fire if shift is held.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPreviewOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && previewOpen) {
        e.preventDefault();
        setPreviewOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  // A9 — ⌘\ / Ctrl+\ toggles the OutlineRail. Esc closes the rail, but only
  // if the ⌘P preview overlay isn't open (overlay's Esc handler takes
  // precedence — A7 contract preserved). Kept in a separate useEffect from
  // the ⌘P listener: different concern, different dependency set.
  //
  // The previewOpen reads through a ref because the A7 handler and the A9
  // handler both register window keydown listeners — when Esc fires with
  // both open, both callbacks run. The ref reads the latest state at the
  // moment of the keystroke, so the rail respects the overlay's claim.
  const previewOpenRef = useRef(previewOpen);
  previewOpenRef.current = previewOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '\\') {
        e.preventDefault();
        setOutlineOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && outlineOpen && !previewOpenRef.current) {
        e.preventDefault();
        setOutlineOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [outlineOpen]);

  return (
    <div className="paper-app" data-testid="paper-app">
      <main className="paper-column" data-testid="paper-column">
        <Editor doc={doc} onEditorReady={setEditor} onChange={setDoc} />
      </main>
      <OutlineRail
        editor={editor}
        open={outlineOpen}
        onClose={() => setOutlineOpen(false)}
      />
      <FooterStatus doc={doc} />
      <JsonEditMode
        doc={doc}
        open={jsonModeOpen}
        onClose={() => setJsonModeOpen(false)}
        onSave={(next) => {
          setDoc(next);
          setJsonModeOpen(false);
        }}
      />
      <PreviewOverlay
        doc={doc}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
