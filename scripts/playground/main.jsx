// The docs-site playground: a JSON editor, a live render with @portable-doc/react
// beside its HTML, Markdown and text, live checks with @portable-doc/validate,
// and Markdown pasted in as a new doc. Bundled into one file by build.mjs.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { validate } from '@portable-doc/validate';
import { renderPortableDocument } from '../../packages/react/src/index.ts';
import { fieldBlocks } from '../../packages/react/src/field-blocks.ts';
import { embedBlocks } from '../../packages/react/src/embed.ts';
import { explainWith, readCodes } from '../../packages/mcp/explain-words.js';
import codesMarkdown from '../../packages/validate/CODES.md';
import { blocksOf, parseJson } from './parse.js';
import { encodeShare } from './share.js';
import { copyText, shiftLines } from './editing.js';
import { outputsOf } from './outputs.js';
import { opening, useEditorDoc } from './ways-in.js';
import { MarkdownBox, Outputs } from './panes.jsx';

const explain = explainWith(readCodes(codesMarkdown));
const renderOptions = { blocks: { ...fieldBlocks, ...embedBlocks() } };
const LONG_LINK = 8000;
const pretty = (value) => JSON.stringify(value, null, 2);
// Engine messages for a blown stack differ by browser and mean nothing to a reader.
const plainWords = (error) => (error instanceof RangeError && /call stack|recursion/i.test(error.message) ? 'the doc nests too deep to draw' : error.message);

// Everything the page shows for one text. `previous` supplies the last good render.
function viewOf(text, previous) {
  const parsed = parseJson(text);
  if (!parsed.ok) return { ...previous, parseError: parsed.error, stale: true };
  const blocks = blocksOf(parsed.value);
  const result = validate(parsed.value);
  const checks = result.ok ? [] : explain(result.errors, parsed.value);
  try {
    return { html: renderPortableDocument(blocks, renderOptions), ...outputsOf(parsed.value), blocks: blocks.length, checks, parseError: null, renderError: null, stale: false };
  } catch (error) {
    return { ...previous, checks, parseError: null, renderError: plainWords(error), stale: true };
  }
}

function dropHash() {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    // Some file:// setups refuse history changes; the old hash then stays.
  }
}

function Checks({ view }) {
  if (view.parseError) {
    const { line, column, message } = view.parseError;
    return (
      <div className="pg-banner pg-bad" data-state="json-error">
        <strong>Not valid JSON.</strong> {line ? `Line ${line}, column ${column}: ` : ''}{message}. The render shows the last good JSON.
      </div>
    );
  }
  const notice = view.renderError ? <div className="pg-banner pg-bad" data-state="render-error"><strong>The renderer failed:</strong> {view.renderError}</div> : null;
  if (view.checks.length === 0) {
    return <>{notice}<div className="pg-banner pg-ok" data-state="valid"><strong>Valid.</strong> {view.blocks} {view.blocks === 1 ? 'block' : 'blocks'}, no errors.</div></>;
  }
  return (
    <>
      {notice}
      <div className="pg-banner pg-bad" data-state="invalid"><strong>{view.checks.length} {view.checks.length === 1 ? 'error' : 'errors'}.</strong> The renderer still draws what it can.</div>
      <ol className="pg-errors">
        {view.checks.map((check, index) => (
          <li key={`${index}:${check.path}`}>
            <code className="pg-error-code">{check.code}</code> <code className="pg-error-path">{check.path || '(the doc)'}</code>
            <p>{check.text}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

function App({ examples, initial }) {
  const { text, settled, status, take, say: setStatus } = useEditorDoc(initial);
  const [view, setView] = useState(() => viewOf(initial.text, { html: '', markdown: '', text: '', blocks: 0, checks: [] }));
  const [exampleId, setExampleId] = useState(initial.exampleId);
  const [link, setLink] = useState('');
  const [pasting, setPasting] = useState(false);
  const tabOut = useRef(false);

  useEffect(() => setView((previous) => viewOf(settled, previous)), [settled]);

  useEffect(() => {
    const onHash = () => take('link', location.hash).then((entered) => entered && setExampleId(''));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const pick = (event) => {
    const example = examples.find((candidate) => candidate.id === event.target.value);
    if (!example || !take('example', example)) return;
    setExampleId(example.id);
    setLink('');
    dropHash();
  };
  const fromMarkdown = (markdown) => {
    if (!take('markdown', markdown)) return;
    setExampleId('');
    setLink('');
    setPasting(false);
    dropHash();
  };
  const format = () => {
    const parsed = parseJson(text);
    if (!parsed.ok) return setStatus(`Cannot format: line ${parsed.error.line}, column ${parsed.error.column}: ${parsed.error.message}.`);
    if (take('typed', pretty(parsed.value))) setStatus('Formatted.');
  };
  const share = async () => {
    const parsed = parseJson(text);
    let hash;
    try {
      hash = await encodeShare(parsed.ok ? JSON.stringify(parsed.value) : text);
    } catch (error) {
      return setStatus(`${error.message}.`);
    }
    try {
      history.replaceState(null, '', hash);
    } catch {
      location.hash = hash;
    }
    const url = location.href;
    setLink(url);
    const copied = await copyText(url);
    const long = url.length > LONG_LINK ? ' It is long; some apps cut links this long.' : '';
    setStatus(`${copied ? 'Link copied' : 'Link ready below (copy it by hand)'}: ${url.length} characters.${long}`);
  };
  const copyHtml = async () => {
    setStatus((await copyText(view.html)) ? `Copied ${view.html.length} characters of HTML.` : 'The browser refused to copy.');
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      tabOut.current = true;
      return;
    }
    if (event.key === 'Shift') return;
    const plainTab = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!plainTab || tabOut.current) {
      tabOut.current = false;
      return;
    }
    event.preventDefault();
    shiftLines(event.currentTarget, event.shiftKey);
  };
  // Links in the render open in a new tab, a `#doc=` link too, so a doc cannot swap
  // out the editor. Only plain in-page anchors stay here.
  const openLinksElsewhere = (event) => {
    const anchor = event.target.closest?.('a[href]');
    const href = anchor?.getAttribute('href');
    if (!anchor || (href.startsWith('#') && !href.startsWith('#doc='))) return;
    event.preventDefault();
    window.open(anchor.href, '_blank', 'noopener');
  };
  const groups = [...new Set(examples.map((example) => example.group))];

  return (
    <>
      <div className="pg-bar" role="toolbar" aria-label="Playground">
        <label className="pg-pick">
          <span>Example</span>
          <select value={exampleId} onChange={pick}>
            {exampleId === '' ? <option value="">Your doc</option> : null}
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {examples.filter((example) => example.group === group).map((example) => <option key={example.id} value={example.id}>{example.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" onClick={format}>Format JSON</button>
        <button type="button" onClick={share}>Share link</button>
        <button type="button" onClick={copyHtml}>Copy HTML</button>
        <button type="button" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>Paste Markdown</button>
        <span className="pg-status" role="status">{status}</span>
      </div>
      {link ? <input className="pg-link" readOnly value={link} aria-label="Share link" onFocus={(event) => event.target.select()} /> : null}
      {pasting ? <MarkdownBox onDoc={fromMarkdown} onClose={() => setPasting(false)} /> : null}
      <div className="pg-grid">
        <div className="pg-column">
          <section className="pg-pane" aria-labelledby="pg-json">
            <h2 id="pg-json">JSON</h2>
            <textarea
              className="pg-editor"
              value={text}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-label="PortableDoc JSON"
              aria-describedby="pg-keys"
              onChange={(event) => {
                if (take('typed', event.target.value, false)) setExampleId('');
              }}
              onKeyDown={onKeyDown}
            />
            <p id="pg-keys" className="pg-hint">Tab indents, Shift+Tab outdents. Press Escape, then Tab, to leave the editor.</p>
          </section>
          <section className="pg-pane pg-checks" aria-labelledby="pg-check" aria-live="polite">
            <h2 id="pg-check">Check</h2>
            <Checks view={view} />
          </section>
        </div>
        <Outputs view={view} onRenderClick={openLinksElsewhere} />
      </div>
    </>
  );
}

function followTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light';
  };
  apply();
  dark.addEventListener('change', apply);
}

async function start() {
  followTheme();
  const examples = JSON.parse(document.getElementById('pd-examples').textContent);
  const initial = await opening(examples, location.hash);
  if (initial.broken) dropHash(); // a reload then opens the page, not the same broken link
  createRoot(document.getElementById('playground')).render(<App examples={examples} initial={initial} />);
}

start();
