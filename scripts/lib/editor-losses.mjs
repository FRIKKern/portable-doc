// These are losses in the synced editor, fixed in Barkpark and removed here by the sync.
// packages/editor is Barkpark's paper editor, copied here by the sync (decision 0012). Its two
// writers lose words on the shared cases today. The word test (packages/text/writers-keep-words
// .test.mjs) counts each lost word under its writer and kind, and fails when a count moves either
// way: a new loss of a listed kind turns it red, and so does a fix, until its row comes down or
// out. A loss of no listed kind fails it too. Each row names the Barkpark fix that removes it. A
// row falls when a fix syncs. A row rises only in the PR that adds a case, OR when words move between
// rows of one writer with that writer's total unchanged and the PR naming each word and its case;
// never for a code change alone. This measures the losses; it does not excuse them.

const CALLOUT_BODY = "the paper editor writes a callout's body";
const SOURCE_ROUND_TRIP = 'switching to source mode and back keeps every word';
const EXPORT_FIELDS = 'the export keeps card media alt, stat denom and old-named fields';

/** [writer, kind of loss, words lost on the shared cases, the Barkpark fix that removes it] */
export const EDITOR_LOSSES = [
  ['editor export', 'card media', 14, EXPORT_FIELDS],
  ['editor export', 'a stat denominator', 2, EXPORT_FIELDS],
  ['editor export', 'an old-named field', 10, EXPORT_FIELDS],
  ['editor export', 'a chart label', 36, 'the export writes every chart label'],
  ['editor source', 'a callout body', 76, CALLOUT_BODY],
  ['editor source', 'a list nested in a list item', 2073, SOURCE_ROUND_TRIP],
  ['editor source', 'another block in a list item', 102, SOURCE_ROUND_TRIP],
  ['editor source', 'a link address', 5, SOURCE_ROUND_TRIP],
  ['editor source', 'a block setting', 16, SOURCE_ROUND_TRIP],
  ['editor source', 'an open field', 1, SOURCE_ROUND_TRIP],
  ['editor source', 'an old-named field', 4, SOURCE_ROUND_TRIP],
];

const SETTINGS = ['id', 'role', 'tone', 'source', 'sourceDefault', 'kind', 'lang'];

/** The kind a word's own field names, wherever the word sits, or null. */
function fieldKind(key) {
  if (key === 'xLabels') return 'a chart label';
  if (key === 'denom') return 'a stat denominator';
  if (key === 'href') return 'a link address';
  if (SETTINGS.includes(key)) return 'a block setting';
  return null;
}

/**
 * The kind of a word a writer lost, from its case, its field and its path in the case's blocks. A
 * word is named by what loses it. A place (a callout's body, a block under a list item, a card's
 * media) names the word when the writer loses something there that no field names: then the place
 * itself is what is lost. When every word the writer loses in the place is one its field names, the
 * writer wrote the place, and the field names the word, as anywhere else. `lostIn(place)` is the
 * [word, field, path] of each word this writer lost under that path, in this case.
 */
export function lossKind(writer, caseName, key, path, blocks, lostIn) {
  // Whether the innermost place `pattern` finds around the word is one the writer lost.
  const lostPlace = (pattern) => {
    const found = [...path.matchAll(pattern)].pop();
    return found !== undefined && lostIn(path.slice(0, found.index + found[0].length)).some(([, k]) => fieldKind(k) === null);
  };
  if (lostPlace(/\/slots\/body\//g)) return 'a callout body';
  if (caseName.startsWith('fixtures/aliases/')) return 'an old-named field';
  if (lostPlace(/\/items\/\d+\/children\/\d+\/items\//g)) return 'a list nested in a list item';
  if (lostPlace(/\/items\/\d+\/children\/\d+\//g)) return 'another block in a list item';
  if (lostPlace(/\/slots\/media\//g)) return 'card media';
  const named = fieldKind(key);
  if (named) return named;
  const top = blocks[Number(path.split('/')[2])];
  if (top?.type === 'heading' && path.includes('/content/')) return "a heading's text";
  if (/^\/blocks\/\d+\/text$/.test(path)) return "a block's old text name";
  return 'an open field';
}
