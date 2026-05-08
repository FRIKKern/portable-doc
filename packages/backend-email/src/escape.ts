/**
 * HTML + URL escaping helpers for the email backend — defense-in-depth against
 * XSS even if the validator misses one (spec §7 / grill Q10). Mirrors the
 * allowlist in `@portable-doc/backend-web-server/src/escape.ts`.
 *
 * `safeUrl` is a scheme allowlist: only `http | https | mailto | tel` survive.
 * Anything else (`javascript:`, `data:`, `file:`, fragments, weird whitespace)
 * collapses to `#`.
 *
 * These are used directly by the VML/MSO conditional comment string emitters,
 * which bypass React's auto-escaping via `dangerouslySetInnerHTML`.
 */

const ALLOWED_SCHEMES = /^(?:https?|mailto|tel):/i;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export function safeUrl(href: string): string {
  // eslint-disable-next-line no-control-regex
  const trimmed = href.replace(/^[\x00-\x20]+/, '');
  if (!ALLOWED_SCHEMES.test(trimmed)) return '#';
  return escapeAttr(trimmed);
}
