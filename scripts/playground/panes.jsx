// The playground's output tabs (the live render, then its HTML, Markdown and
// text) and the box that turns pasted Markdown into a doc.
import { useRef, useState } from 'react';

const TABS = [
  ['render', 'Render'],
  ['html', 'HTML'],
  ['markdown', 'Markdown'],
  ['text', 'Text'],
];

/** The live render and the doc's HTML, Markdown and text, one tab each. Arrow keys, Home and End move between tabs. */
export function Outputs({ view, onRenderClick }) {
  const [tab, setTab] = useState('render');
  const buttons = useRef({});
  const choose = (id) => {
    setTab(id);
    buttons.current[id]?.focus();
  };
  const onKeyDown = (event) => {
    const at = TABS.findIndex(([id]) => id === tab);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(TABS[(next + TABS.length) % TABS.length][0]);
  };
  const sources = { html: view.html, markdown: view.markdown, text: view.text };
  return (
    <section className="pg-pane" aria-label="Output">
      <div className="pg-tabbar">
        <div className="pg-tabs" role="tablist" aria-label="Output" onKeyDown={onKeyDown}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              ref={(node) => {
                buttons.current[id] = node;
              }}
              type="button"
              role="tab"
              id={`pg-tab-${id}`}
              aria-controls={`pg-panel-${id}`}
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {view.stale ? <span className="pg-stale">last good render</span> : null}
      </div>
      <div className="pg-render" role="tabpanel" id="pg-panel-render" aria-labelledby="pg-tab-render" hidden={tab !== 'render'} onClick={onRenderClick}>
        <div className="bp-paper-surface bp-paper-article" dangerouslySetInnerHTML={{ __html: view.html }} />
      </div>
      {Object.entries(sources).map(([id, source]) => (
        <div key={id} className="pg-source" role="tabpanel" id={`pg-panel-${id}`} aria-labelledby={`pg-tab-${id}`} hidden={tab !== id} tabIndex={0}>
          <pre>{source || '(nothing to show)'}</pre>
        </div>
      ))}
    </section>
  );
}

/** A box for Markdown; "Make a doc" hands its text to `onDoc`, which replaces the doc in the editor. */
export function MarkdownBox({ onDoc, onClose }) {
  const [markdown, setMarkdown] = useState('');
  return (
    <section className="pg-paste" aria-labelledby="pg-paste-title">
      <h2 id="pg-paste-title">Paste Markdown</h2>
      <textarea
        className="pg-editor pg-markdown"
        value={markdown}
        spellCheck={false}
        autoFocus
        aria-labelledby="pg-paste-title"
        aria-describedby="pg-paste-hint"
        placeholder={'# A heading\n\nSome **bold** text, a [link](https://example.com) and a list:\n\n- [x] done\n- [ ] next'}
        onChange={(event) => setMarkdown(event.target.value)}
      />
      <p id="pg-paste-hint" className="pg-hint">GitHub Markdown: headings, lists and task lists, tables, code fences, quotes and callouts. The new doc replaces the one in the editor.</p>
      <div className="pg-bar">
        <button type="button" disabled={markdown.trim() === ''} onClick={() => onDoc(markdown)}>Make a doc</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}
