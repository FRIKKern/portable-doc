// The import work count from the Markdown text alone. First the text is normalized as
// markdown-it 15's core rule 'normalize' does: /\r\n?/g to "\n", then NUL to U+FFFD; lines are
// then split at "\n". So "\n", "\r\n" and a lone "\r" each end a line. Per line:
//   the prefix = its leading container markers (> - + * 1. 1)) and the spaces and tabs among them;
//   m = the markers in the prefix; w = its spaces and tabs in columns, a tab to the next stop of 4;
//   D = its depth: m + floor(w / 2). A blank line takes the depth before it; a line
//       right after a non-blank line takes at least that line's depth (a lazy line).
//   cost = (D + 1) × (2 + its length in UTF-8 bytes).
// The import's work is the sum of the costs.

const SP = (ch) => ch === 32 || ch === 9; // space, tab

/** The prefix of `line`: its markers m and whitespace columns w. */
export function markers(line) {
  let i = 0;
  let m = 0;
  let w = 0;
  let col = 0;
  const end = (j) => j >= line.length || SP(line.charCodeAt(j));
  for (;;) {
    while (i < line.length && SP(line.charCodeAt(i))) {
      const width = line.charCodeAt(i++) === 9 ? 4 - (col % 4) : 1;
      w += width;
      col += width;
    }
    const ch = line.charCodeAt(i);
    if (ch === 62) { m++; i++; col++; continue; } // >
    if ((ch === 45 || ch === 43 || ch === 42) && end(i + 1)) { m++; i++; col++; continue; } // - + *
    let j = i;
    while (j < line.length && j - i < 9 && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
    if (j > i && (line.charCodeAt(j) === 46 || line.charCodeAt(j) === 41) && end(j + 1)) { m++; col += j + 1 - i; i = j + 1; continue; } // 1. 1)
    return { m, w };
  }
}

/** Each line's cost, in order. */
export const normalize = (markdown) => markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD');

/** Each line's cost, in order. */
export function lineCosts(markdown) {
  const lines = normalize(markdown).split('\n');
  const costs = new Array(lines.length);
  let before = 0;
  let afterBlank = true;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let blank = true;
    for (let i = 0; i < line.length; i++) if (!SP(line.charCodeAt(i))) { blank = false; break; }
    let D = before;
    if (!blank) {
      const { m, w } = markers(line);
      D = m + Math.floor(w / 2);
      if (!afterBlank) D = Math.max(D, before);
    }
    before = D;
    afterBlank = blank;
    costs[n] = (D + 1) * (2 + Buffer.byteLength(line));
  }
  return costs;
}

/** Each line's depth D, in order (for the shared cases). */
export function lineDepths(markdown) {
  const lines = normalize(markdown).split('\n');
  return lineCosts(markdown).map((c, n) => c / (2 + Buffer.byteLength(lines[n])) - 1);
}

export const textWork = (markdown) => lineCosts(markdown).reduce((a, b) => a + b, 0);
