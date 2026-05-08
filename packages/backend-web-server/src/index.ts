/**
 * @portable-doc/backend-web-server — Pd-tree → inline-styled HTML string.
 *
 * Hand-written adapter used by the MCP server's `doc_render({surface:'web'})`.
 * NOT react-native-web (that's the editor's job per spec §6 / grill Q5).
 */

export { renderHtml } from './render.js';
export type { HtmlRenderOptions } from './render.js';
