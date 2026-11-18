import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePlayground } from './build.mjs';
import { playgroundExamples } from './examples.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const style = `<style>
  :root { --pg-line: #bcd0cb; --pg-field: #fff; --pg-ink: #18302a; --pg-muted: #536b65; --pg-ok: #0f6b4f; --pg-ok-bg: #e3f5ee; --pg-bad: #a3261b; --pg-bad-bg: #fdecea; --pg-chip: #eef4f2; }
  @media (prefers-color-scheme: dark) { :root { --pg-line: #38534c; --pg-field: #17211f; --pg-ink: #e7f2ef; --pg-muted: #a8bdb7; --pg-ok: #7fe0bd; --pg-ok-bg: #11302a; --pg-bad: #ffb4a8; --pg-bad-bg: #3a1714; --pg-chip: #1f2c29; } }
  body > header, body > main { width: min(1440px, calc(100% - 32px)); }
  main > h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 8px 0 4px; } main > .lede { margin: 0 0 8px; font-size: 1rem; }
  .pg-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
  .pg-bar select, .pg-bar button, .pg-link { font: inherit; font-size: .92rem; padding: 7px 12px; border: 1px solid var(--pg-line); border-radius: 8px; background: var(--pg-field); color: var(--pg-ink); }
  .pg-bar button { cursor: pointer; } .pg-bar button:hover, .pg-bar select:hover { border-color: var(--pg-muted); }
  .pg-pick { display: flex; gap: 8px; align-items: center; } .pg-pick select { max-width: min(320px, 70vw); }
  .pg-status { font-size: .88rem; color: var(--pg-muted); overflow-wrap: anywhere; }
  .pg-link { display: block; width: 100%; margin: 0 0 12px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .8rem; }
  .pg-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 880px) { .pg-grid { grid-template-columns: minmax(0, 1fr); } }
  .pg-column { display: grid; gap: 16px; min-width: 0; } .pg-pane { min-width: 0; }
  .pg-pane h2 { margin: 0 0 8px; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; color: var(--pg-muted); display: flex; gap: 8px; align-items: center; }
  .pg-stale { text-transform: none; letter-spacing: 0; font-weight: 600; padding: 1px 8px; border-radius: 99px; background: var(--pg-bad-bg); color: var(--pg-bad); }
  .pg-editor { display: block; width: 100%; height: 62vh; min-height: 320px; resize: vertical; padding: 12px 14px; border: 1px solid var(--pg-line); border-radius: 12px; background: var(--pg-field); color: var(--pg-ink); font: .84rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; white-space: pre; overflow: auto; }
  .pg-hint { margin: 6px 0 0; font-size: .8rem; color: var(--pg-muted); }
  .pg-banner { padding: 10px 14px; border-radius: 10px; line-height: 1.45; overflow-wrap: anywhere; }
  .pg-ok { background: var(--pg-ok-bg); color: var(--pg-ok); } .pg-bad { background: var(--pg-bad-bg); color: var(--pg-bad); }
  .pg-banner + .pg-banner { margin-top: 8px; }
  .pg-errors { margin: 10px 0 0; padding-left: 22px; line-height: 1.45; } .pg-errors li + li { margin-top: 10px; } .pg-errors p { margin: 4px 0 0; overflow-wrap: anywhere; }
  .pg-error-code, .pg-error-path { font-size: .82rem; padding: 1px 6px; border-radius: 6px; background: var(--pg-chip); overflow-wrap: anywhere; } .pg-error-code { font-weight: 700; color: var(--pg-bad); }
  .pg-render { border: 1px solid var(--pg-line); border-radius: 12px; overflow: auto; max-height: 82vh; }
  .pg-render > .bp-paper-surface { padding: 20px 24px; min-height: 200px; }
  @media (max-width: 880px) { .pg-editor { height: 46vh; } .pg-render { max-height: none; } .pg-render > .bp-paper-surface { padding: 16px; } }
</style>`;

const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

// Write playground.html and its files into the staging folder; return the build-manifest entry.
export function writePlayground(staging, { page, stamp }) {
  const bundle = bundlePlayground();
  const css = fs.readFileSync(path.join(root, 'packages', 'react', 'paper-surface.css'));
  const examples = playgroundExamples();
  fs.mkdirSync(path.join(staging, 'playground'));
  fs.writeFileSync(path.join(staging, 'playground', 'playground.js'), bundle);
  fs.writeFileSync(path.join(staging, 'playground', 'paper-surface.css'), css);
  const head = `<link rel="stylesheet" href="playground/paper-surface.css">${style}<script src="playground/playground.js" defer></script>`;
  const body = `<h1>Playground</h1><p class="lede">Write a PortableDoc document as JSON. It renders with <code>@portable-doc/react</code> and is checked with <code>@portable-doc/validate</code> as you type. Nothing leaves this page.</p><div id="playground"><p>Loading the playground…</p></div><noscript><p>The playground needs JavaScript.</p></noscript><script type="application/json" id="pd-examples">${json(examples)}</script>`;
  const html = page('Playground', stamp, body, { head });
  fs.writeFileSync(path.join(staging, 'playground.html'), html);
  return {
    page: { file: 'playground.html', sha256: sha256(html) },
    bundle: { file: 'playground/playground.js', sha256: sha256(bundle), bytes: bundle.length },
    css: { file: 'playground/paper-surface.css', source: 'packages/react/paper-surface.css', sha256: sha256(css) },
    examples: examples.map((example) => example.id),
  };
}
