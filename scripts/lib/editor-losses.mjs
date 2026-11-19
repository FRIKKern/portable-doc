// These are losses in the synced editor, fixed in Barkpark and removed here by the sync.
// packages/editor is Barkpark's paper editor, copied here by the sync (decision 0012). Its two
// writers lose words on the shared cases today. The word test (packages/text/writers-keep-words
// .test.mjs) counts each lost word under its writer and kind, and fails when a count moves either
// way: a new loss of a listed kind turns it red, and so does a fix, until its row comes down or
// out. A loss of no listed kind fails it too. Each row names the Barkpark fix that removes it. A
// row falls when a fix syncs; it may rise only in the PR that adds the shared case finding the loss,
// by exactly that case's count, and never for a code change. This measures the losses; it does not
// excuse them.

const CALLOUT_BODY = "the paper editor writes a callout's body";
const SOURCE_ROUND_TRIP = 'switching to source mode and back keeps every word';
const EXPORT_FIELDS = 'the export keeps card media alt, stat denom and old-named fields';

/** [writer, kind of loss, words lost on the shared cases, the Barkpark fix that removes it] */
export const EDITOR_LOSSES = [
  ['editor export', 'a callout body', 1906, CALLOUT_BODY],
  ['editor export', 'card media', 14, EXPORT_FIELDS],
  ['editor export', 'a stat denominator', 2, EXPORT_FIELDS],
  ['editor export', 'an old-named field', 10, EXPORT_FIELDS],
  ['editor export', 'a chart label', 32, 'the export writes every chart label'],
  ['editor source', 'a callout body', 1830, CALLOUT_BODY],
  ['editor source', 'a list nested in a list item', 1975, SOURCE_ROUND_TRIP],
  ['editor source', 'another block in a list item', 102, SOURCE_ROUND_TRIP],
  ['editor source', "a heading's text", 54, SOURCE_ROUND_TRIP],
  ['editor source', 'a link address', 8, SOURCE_ROUND_TRIP],
  ['editor source', "a block's old text name", 40, SOURCE_ROUND_TRIP],
  ['editor source', 'a block setting', 20, SOURCE_ROUND_TRIP],
  ['editor source', 'an open field', 2, SOURCE_ROUND_TRIP],
  ['editor source', 'an old-named field', 5, SOURCE_ROUND_TRIP],
];

const SETTINGS = ['id', 'role', 'tone', 'source', 'sourceDefault', 'kind', 'lang'];

/**
 * The kind of a word a writer lost, from its case, its field and its path in the case's blocks.
 * Source mode loses whole blocks under a list item, so there the place names the kind; the
 * export writes those blocks, so there the field does.
 */
export function lossKind(writer, caseName, key, path, blocks) {
  if (path.includes('/slots/body/')) return 'a callout body';
  if (caseName.startsWith('fixtures/aliases/')) return 'an old-named field';
  if (writer === 'editor source' && /\/items\/\d+\/children\/\d+\/items\//.test(path)) return 'a list nested in a list item';
  if (writer === 'editor source' && /\/items\/\d+\/children\/\d+\//.test(path)) return 'another block in a list item';
  if (path.includes('/slots/media/')) return 'card media';
  if (key === 'xLabels') return 'a chart label';
  if (key === 'denom') return 'a stat denominator';
  if (key === 'href') return 'a link address';
  if (SETTINGS.includes(key)) return 'a block setting';
  const top = blocks[Number(path.split('/')[2])];
  if (top?.type === 'heading' && path.includes('/content/')) return "a heading's text";
  if (/^\/blocks\/\d+\/text$/.test(path)) return "a block's old text name";
  return 'an open field';
}
