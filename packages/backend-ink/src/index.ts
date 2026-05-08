/**
 * @portable-doc/backend-ink — Pd-tree → ANSI terminal text.
 *
 * Pure-string adapter. Despite the name, NOT a React/Ink runtime — it emits a
 * deterministic string of box-drawing chars + ANSI escapes + OSC-8 hyperlinks.
 */

export { renderInk } from './render.js';
export type { InkRenderOptions } from './render.js';
