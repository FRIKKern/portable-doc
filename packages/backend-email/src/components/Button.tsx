/**
 * Email Button — the heaviest piece of the adapter.
 *
 * Primary buttons emit BOTH a styled `<a>` AND an MSO-conditional VML fallback
 * so Outlook 2007–2019 (which renders <a> as a tiny inline link) draws a real
 * button. The MSO conditional comments wrap each branch:
 *
 *   <!--[if mso]>  ... VML roundrect ...  <![endif]-->
 *   <!--[if !mso]><!--> ... modern <a> ... <!--<![endif]-->
 *
 * Comments must reach the email client untouched, so we emit them via
 * `dangerouslySetInnerHTML`. Both `href` and `label` are run through
 * `safeUrl`/`escapeHtml` before interpolation.
 *
 * Secondary buttons stay plain (bordered link). VML for every link bloats
 * output and Outlook handles bordered <a> reasonably.
 */

import type { PdButtonNode } from '@portable-doc/primitives';
import { escapeHtml, safeUrl } from '../escape.js';

const BRAND = '#4f46e5';
const BRAND_TEXT = '#ffffff';

export function EmailButton({ node }: { node: PdButtonNode }) {
  const href = safeUrl(node.href);
  const label = escapeHtml(node.label);
  if (node.priority === 'primary') {
    return <PrimaryButton href={href} label={label} />;
  }
  return <SecondaryButton href={href} label={label} />;
}

function PrimaryButton({ href, label }: { href: string; label: string }) {
  const vml = `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="0%" stroke="f" fillcolor="${BRAND}">
  <w:anchorlock/>
  <center style="color:${BRAND_TEXT};font-family:sans-serif;font-size:16px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->`;
  const modern = `<!--[if !mso]><!-- -->
<a href="${href}" style="display:inline-block;background:${BRAND};color:${BRAND_TEXT};padding:14px 24px;text-decoration:none;font-weight:bold;font-family:sans-serif;font-size:16px;border-radius:0">${label}</a>
<!--<![endif]-->`;
  return (
    <>
      <span dangerouslySetInnerHTML={{ __html: vml }} />
      <span dangerouslySetInnerHTML={{ __html: modern }} />
    </>
  );
}

function SecondaryButton({ href, label }: { href: string; label: string }) {
  const html = `<a href="${href}" style="display:inline-block;border:2px solid ${BRAND};color:${BRAND};padding:12px 22px;text-decoration:none;font-weight:bold;font-family:sans-serif;font-size:16px;border-radius:0">${label}</a>`;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
