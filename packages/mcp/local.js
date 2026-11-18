import { validate } from '@portable-doc/validate';
import { toMarkdown, toPlainText } from '@portable-doc/text';

export const FORMATS = ['html', 'markdown', 'text'];

// @portable-doc/react is TSX built into packages/react/dist. It loads on the first local
// html render, so a checkout that has not built it still runs every other tool. The field
// and embed emitters are opt-in there; the reader renders those blocks, so they load too.
let react;
async function loadReact() {
  react ??= Promise.all([
    import('@portable-doc/react'),
    import('@portable-doc/react/field-blocks'),
    import('@portable-doc/react/embed'),
  ]).then(([core, { fieldBlocks }, { embedBlocks }]) => ({
    render: core.renderPortableDocument,
    blocks: { ...fieldBlocks, ...embedBlocks() },
  })).catch((e) => {
    react = undefined;
    throw e;
  });
  return react;
}

const blocksOf = (doc) => (Array.isArray(doc) ? doc : doc.blocks);

export async function renderLocal(doc, format) {
  const checked = validate(doc);
  if (!checked.ok) {
    const n = checked.errors.length;
    return { ok: false, value: { error: `the doc does not validate (${n} ${n === 1 ? 'error' : 'errors'}); explain turns them into words`, errors: checked.errors } };
  }
  if (format === 'markdown') return { ok: true, value: { markdown: toMarkdown(doc) } };
  if (format === 'text') return { ok: true, value: { text: toPlainText(doc) } };
  let renderer;
  try {
    renderer = await loadReact();
  } catch (e) {
    return { ok: false, value: { error: `local html needs the built @portable-doc/react (run npm run react:build), or set BARKPARK_URL: ${e.code ?? e.message}` } };
  }
  return { ok: true, value: { html: renderer.render(blocksOf(doc), { blocks: renderer.blocks }) } };
}
