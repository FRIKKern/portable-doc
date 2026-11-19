// The shared rules, word for word, for both case files. import-work.js in @portable-doc/text is
// the reference; each sentence states what its planText does.
export const RULES = {
  lines: 'Normalize first, as markdown-it 15 does (core rule normalize): every "\\r\\n" and every lone "\\r" becomes "\\n", and every NUL becomes U+FFFD. Then split at "\\n". So "\\n", "\\r\\n" and a lone "\\r" each end a line; depths, costs, cut lines and notice line numbers count these lines.',
  markers: 'A line\'s prefix is its longest leading run of spaces, tabs and container markers. A container marker is ">", or a list marker ("-", "+", "*", or 1 to 9 digits and "." or ")") followed by a space, a tab or the line end. m = the markers in the prefix; w = the spaces and tabs in the prefix, in columns, also those before the first marker and after the last; a tab runs to the next stop of 4, columns counted from the line start with each marker character one column.',
  depth: 'A non-blank line\'s own depth is m + floor(w / 2). A blank line (empty, or only spaces and tabs) takes the depth of the line before it. A line right after a blank line, and the first line, takes its own depth; a line right after a non-blank line takes the larger of its own depth and that line\'s depth. A long line counts as depth 0 for the line after it.',
  cost: 'Each line costs (D + 1) x (2 + its UTF-8 bytes, after normalizing). The work is the sum. The budget is 16,000,000; a case\'s cut is the first line (from 0) where the running sum passes it, or null.',
};
