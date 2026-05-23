/**
 * fixtures — resolve which PortableDoc the editor app boots with.
 *
 * The app used to hardcode the `welcome` fixture (see App.tsx). The
 * universal-PDF funnel verifier (Goal pdoc-r9p) needs to drive the LIVE
 * editor against an ARBITRARY fixture so the editor render leg is the real
 * TipTap DOM+CSS, not a hand-lifted `paper.css` approximation. This module
 * resolves the boot doc from three sources, highest priority first:
 *
 *   1. window.__PAPERFLOW_FIXTURE_DOC__  — a full PortableDoc injected before
 *      React mounts (Playwright `addInitScript`). This is how
 *      `render-to-pdf.ts` feeds an in-memory doc that may not exist on disk.
 *   2. ?fixture=<name>  — a URL param naming a fixture under examples/*.json
 *      (e.g. `?fixture=funnel-hard`). The human-facing path: open the editor
 *      on any shipped fixture without rebuilding.
 *   3. welcome  — the default when neither is present, so the normal app is
 *      unchanged.
 *
 * Fixtures are inlined at build time via `import.meta.glob(..., eager)` so the
 * `vite preview` build the verifier serves carries every fixture without any
 * server-side file route. happy-dom/jsdom test envs have no `import.meta.glob`
 * shimming concern here because the map is read lazily and the default branch
 * never touches a missing key.
 */
import type { PortableDoc } from '@portable-doc/core';
import welcomeJson from '../../../../examples/welcome.json';

declare global {
  interface Window {
    /** Full PortableDoc injected by the funnel renderer before React mounts. */
    __PAPERFLOW_FIXTURE_DOC__?: PortableDoc;
  }
}

const DEFAULT_FIXTURE = 'welcome';

// `welcome` is statically imported so the DEFAULT path is identical to the
// pre-pdoc-4pz behaviour and works in EVERY environment (Vite build, dev
// server, and the happy-dom/jsdom test envs where `import.meta.glob`'s eager
// map can come back empty). It seeds the map so the default never depends on
// the glob resolving.
const FIXTURES: Record<string, PortableDoc> = {
  [DEFAULT_FIXTURE]: welcomeJson as PortableDoc,
};

// Eager glob → every examples/*.json inlined into the bundle, keyed by path.
// `import: 'default'` unwraps the JSON module's default export. This powers the
// human-facing `?fixture=<name>` path for the non-welcome fixtures. Under test
// runners that don't populate the eager map this is simply a no-op; the static
// welcome import above keeps the default path alive regardless.
const fixtureModules = import.meta.glob<PortableDoc>('../../../../examples/*.json', {
  eager: true,
  import: 'default',
});
for (const [path, doc] of Object.entries(fixtureModules)) {
  if (!doc) continue;
  const name = path.replace(/^.*\//, '').replace(/\.json$/, '');
  FIXTURES[name] = doc;
}

/** Names of all fixtures the build inlined (sorted). Handy for debugging. */
export function fixtureNames(): string[] {
  return Object.keys(FIXTURES).sort();
}

/** Look up a fixture by name; undefined if the build didn't inline it. */
export function fixtureByName(name: string): PortableDoc | undefined {
  return FIXTURES[name];
}

/**
 * Resolve the boot doc for the current page load. Reads the injected window
 * doc first (verifier path), then the `?fixture=` URL param, then falls back
 * to the welcome fixture. Never throws — an unknown `?fixture=` name falls
 * through to welcome so a typo in the URL degrades gracefully.
 */
export function resolveFixtureFromUrl(): PortableDoc {
  if (typeof window !== 'undefined' && window.__PAPERFLOW_FIXTURE_DOC__) {
    return window.__PAPERFLOW_FIXTURE_DOC__;
  }
  let name = DEFAULT_FIXTURE;
  if (typeof window !== 'undefined' && window.location?.search) {
    const param = new URLSearchParams(window.location.search).get('fixture');
    if (param && FIXTURES[param]) name = param;
  }
  return FIXTURES[name] ?? FIXTURES[DEFAULT_FIXTURE]!;
}
