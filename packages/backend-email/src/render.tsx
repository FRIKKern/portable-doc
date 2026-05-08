/**
 * `renderEmail(root, opts?)` — async render of a Pd-tree to an email-client-safe
 * HTML string. Heaviest backend in the MVP: real Outlook survival demands VML
 * primary buttons, MSO conditional comments, dark-mode meta + CSS overrides,
 * `role="presentation"` layout tables, and a11y alt text. Per spec §6 / grill Q3
 * the LOC budget is ~600 across this package — the JSX walker keeps the
 * entry-point itself tiny because the heavy lifting lives in `components/`.
 *
 * `@react-email/render` is async (v2). It returns Promise<string>.
 *
 * URL allowlist + HTML escaping are applied defense-in-depth alongside the
 * server-adapter validator (spec §7 / grill Q10) — anything that bypasses the
 * validator still cannot emit `javascript:` URLs.
 */

import type { PdNode } from '@portable-doc/primitives';
import { render } from '@react-email/render';
import { EmailDocument } from './components/Document.js';

export interface EmailRenderOptions {
  /** Hidden preview text the email client shows next to the subject line. */
  preheader?: string;
  /** Container width in px. Default 600. */
  containerWidth?: number;
  /** Pretty-print output. Default false. */
  pretty?: boolean;
}

export async function renderEmail(
  root: PdNode,
  opts: EmailRenderOptions = {},
): Promise<string> {
  const props: {
    root: PdNode;
    containerWidth: number;
    preheader?: string;
  } = {
    root,
    containerWidth: opts.containerWidth ?? 600,
  };
  if (opts.preheader !== undefined) props.preheader = opts.preheader;
  return render(<EmailDocument {...props} />, { pretty: opts.pretty ?? false });
}
