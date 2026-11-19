// Math.min and Math.max over a list, without spreading it into the call: a spread of more
// than about 115,000 values overflows the stack. Each step is Math.min/Math.max itself, so
// the result is the spread's: Infinity or -Infinity when empty, NaN when any value is NaN.
export function minOf(values: Iterable<number>): number {
  let m = Infinity
  for (const v of values) m = Math.min(m, v)
  return m
}

export function maxOf(values: Iterable<number>): number {
  let m = -Infinity
  for (const v of values) m = Math.max(m, v)
  return m
}
