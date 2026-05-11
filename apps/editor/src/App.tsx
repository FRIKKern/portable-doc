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
import { useEffect, useState } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import welcomeJson from '../../../examples/welcome.json';
import { Editor } from './Editor.js';
import { FooterStatus } from './FooterStatus.js';
import { JsonEditMode } from './JsonEditMode.js';
import { McpProvider } from './McpProvider.js';
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

  return (
    <div className="paper-app" data-testid="paper-app">
      <main className="paper-column" data-testid="paper-column">
        <Editor doc={doc} />
      </main>
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
    </div>
  );
}
