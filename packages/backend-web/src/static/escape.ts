/**
 * HTML + URL escaping helpers — defense-in-depth against XSS even if the
 * validator misses one (spec §7 / grill Q10).
 *
 * `safeUrl` is a scheme allowlist: only `http | https | mailto | tel` survive.
 * Anything else (`javascript:`, `data:`, `file:`, fragments, weird whitespace)
 * collapses to `#` so we can never emit an executable URL.
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

/** Stricter escape for attribute values: same as text + already-encoded quotes. */
export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/**
 * Returns the URL attribute-escaped if scheme-allowlisted, else `#`.
 *
 * Browsers tolerate leading whitespace and ASCII control characters before a
 * scheme (e.g. `\tjavascript:alert(1)`), so we strip them before matching.
 */
export function safeUrl(href: string): string {
  // eslint-disable-next-line no-control-regex
  const trimmed = href.replace(/^[\x00-\x20]+/, '');
  if (!ALLOWED_SCHEMES.test(trimmed)) return '#';
  return escapeAttr(trimmed);
}
