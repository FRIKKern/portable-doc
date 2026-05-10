/**
 * Top-level shell. Owns: doc state, selected block id, active preview tab.
 * Initial doc is the welcome fixture per the brief.
 */
import { useState, useEffect } from 'react';
import type { PortableDoc } from '@portable-doc/core';
import welcomeJson from '../../../examples/welcome.json';
import incidentJson from '../../../examples/incident.json';
import { useDoc } from './store.js';

const welcome = welcomeJson as PortableDoc;
const incident = incidentJson as PortableDoc;
import { Editor } from './Editor.js';
import { PreviewStrip } from './PreviewStrip.js';
import { ValidationPanel } from './ValidationPanel.js';
import { JsonEditMode } from './JsonEditMode.js';
import { McpProvider } from './McpProvider.js';

export function App() {
  return (
    <McpProvider>
      <AppShell />
    </McpProvider>
  );
}

function AppShell() {
  const [doc, dispatch] = useDoc(welcome);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jsonModeOpen, setJsonModeOpen] = useState(false);

  // Hidden Cmd+Shift+J / Ctrl+Shift+J shortcut toggles the JSON-edit-mode
  // overlay. Power-user escape hatch per A7 / build-phase grill q9.
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

  const copyJson = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>PortableDoc Editor</h1>
        <button onClick={() => dispatch({ kind: 'load', doc: welcome })}>Load welcome</button>
        <button onClick={() => dispatch({ kind: 'load', doc: incident })}>Load incident</button>
        <button onClick={copyJson}>Copy JSON</button>
        <span style={{ marginLeft: 'auto', color: '#888' }}>
          {doc.title ?? '(untitled)'} · {doc.blocks.length} blocks
        </span>
      </header>
      <div className="app-main">
        <Editor
          doc={doc}
          selectedId={selectedId}
          onSelect={setSelectedId}
          dispatch={dispatch}
        />
        <PreviewStrip doc={doc} />
      </div>
      <ValidationPanel doc={doc} />
      <JsonEditMode
        doc={doc}
        open={jsonModeOpen}
        onClose={() => setJsonModeOpen(false)}
        onSave={(next) => {
          dispatch({ kind: 'load', doc: next });
          setJsonModeOpen(false);
        }}
      />
    </div>
  );
}
