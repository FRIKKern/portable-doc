/**
 * Top-level shell. Owns: doc state, selected block id, active preview tab.
 * Initial doc is the welcome fixture per the brief.
 */
import { useState } from 'react';
import { welcome, incident } from '@portable-doc/fixtures';
import { useDoc } from './store.js';
import { Editor } from './Editor.js';
import { PreviewTabs, DEFAULT_TAB } from './PreviewTabs.js';
import type { TabId } from './PreviewTabs.js';
import { ValidationPanel } from './ValidationPanel.js';

export function App() {
  const [doc, dispatch] = useDoc(welcome);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB);

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
        <PreviewTabs doc={doc} active={activeTab} onChange={setActiveTab} />
      </div>
      <ValidationPanel doc={doc} />
    </div>
  );
}
