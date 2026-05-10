/**
 * Hand-rolled Levenshtein edit-distance — used by the slash-command popover
 * filter as a typo-tolerance fallback when substring match yields zero hits.
 *
 * Per A3 / build-phase grill q3: a 10-candidate menu doesn't justify pulling
 * fuse.js. ~25 LOC of classic DP gives us "calout" → "callout" for free.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) (matrix[0] as number[])[j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      const row = matrix[i] as number[];
      const prev = matrix[i - 1] as number[];
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
  }
  return (matrix[b.length] as number[])[a.length] as number;
}
