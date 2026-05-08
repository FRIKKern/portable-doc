/**
 * Dark-mode head fragment.
 *
 * Three layers because no single email client honours all of them:
 *   1. `<meta name="color-scheme">` — Apple Mail / iOS hint.
 *   2. `prefers-color-scheme: dark` media query — Apple Mail, iOS, some others.
 *   3. `[data-ogsc]` selector — Outlook.com / Windows Mail dark-mode (uses an
 *      ancestor attribute to scope its rewrites; we override with !important).
 *
 * Gmail strips <style> in <head>, so this is best-effort. The body still has
 * sensible default colours via inline styles.
 *
 * `.pd-bg` lives on <Body>; `.pd-card` on every callout. They're the only
 * class hooks we use — everything else is inline.
 */

import { Head } from '@react-email/components';

const css = `
  @media (prefers-color-scheme: dark) {
    .pd-bg { background: #111827 !important; color: #f9fafb !important; }
    .pd-card { background: #1f2937 !important; }
  }
  [data-ogsc] .pd-bg { background: #111827 !important; color: #f9fafb !important; }
  [data-ogsc] .pd-card { background: #1f2937 !important; }
`;

export function DarkModeHead() {
  return (
    <Head>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </Head>
  );
}
