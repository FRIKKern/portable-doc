/**
 * @portable-doc/backend-email — public API.
 *
 * Async React Email adapter. `renderEmail(root, opts)` returns Promise<string>
 * containing email-client-safe HTML (Outlook VML buttons, MSO conditionals,
 * dark-mode meta + CSS, role="presentation" tables, alt text).
 */

export { renderEmail } from './render.js';
export type { EmailRenderOptions } from './render.js';
