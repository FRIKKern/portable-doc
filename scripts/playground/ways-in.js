// Every way text enters the playground editor, as one list. main.jsx takes new text only
// through `enter`, so each way is held to the cap: playground.test.mjs has one row per
// entry, each refusing an input over the cap with its own message and keeping the
// editor's doc. A way in added here without a row fails that test.
import { tidyJson } from './parse.js';
import { docFromMarkdown } from './outputs.js';
import { decodeShare, MAX_DOC_BYTES, overCap } from './share.js';

const MB = MAX_DOC_BYTES / 1_000_000;
const pretty = (value) => JSON.stringify(value, null, 2);

/**
 * Each way in takes its input and gives { text, status } for the editor, { error } when
 * it refuses the input, or {} when there is nothing to take (a page with no share link).
 */
export const WAYS_IN = Object.freeze({
  /** JSON typed or pasted into the editor, or the editor's own JSON formatted. */
  typed: (text) => (overCap(text) ? { error: `The doc is too big for the editor (over ${MB} MB)` } : { text }),
  /** Markdown pasted in the Markdown box: its doc's JSON. */
  markdown: (markdown) => {
    const made = docFromMarkdown(markdown);
    if (made.error) return { error: made.error };
    return { text: made.text, status: `Made a doc of ${made.blocks} ${made.blocks === 1 ? 'block' : 'blocks'} from the Markdown.` };
  },
  /** A share link in the page's hash, on load and on hashchange. */
  link: async (hash) => {
    let shared;
    try {
      shared = await decodeShare(hash);
    } catch (error) {
      return { error: error.message };
    }
    return shared === null ? {} : { text: tidyJson(shared, MAX_DOC_BYTES), status: 'Opened the doc from the link.' };
  },
  /** A built-in example picked from the menu. */
  example: (example) => {
    const text = pretty(example.doc);
    return overCap(text) ? { error: `${example.label} is too big for the editor (over ${MB} MB)` } : { text, status: `Loaded ${example.label}.` };
  },
});

const settle = (taken, current) =>
  taken.error
    ? { text: current, entered: false, error: taken.error, status: `${taken.error}. The editor still holds your doc.` }
    : { text: taken.text ?? current, entered: taken.text !== undefined, status: taken.status };

/**
 * What the editor holds once `input` comes in by `way`: { text, entered, status, error }.
 * A refused input leaves `current`, the editor's text, as it was. Synchronous for a
 * synchronous way, so typing never waits.
 */
export function enter(way, input, current) {
  const taken = WAYS_IN[way](input);
  return taken instanceof Promise ? taken.then((t) => settle(t, current)) : settle(taken, current);
}
