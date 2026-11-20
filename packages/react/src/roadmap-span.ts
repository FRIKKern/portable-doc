// A roadmap's date span, and where a date falls in it: Barkpark's components.ex roadmap_span/1,
// roadmap_date/1 and roadmap_date_pct/2. The today line reads it now; dated lanes can read the
// same span later.

const DAY_MS = 86_400_000

/** A YYYY-MM-DD date, surrounding spaces allowed, as whole days since 1970-01-01; else null. */
export function roadmapDate(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999.
  const back = new Date(0)
  back.setUTCFullYear(y, mo - 1, d)
  // 2026-02-30 is not a date: the setter would roll it over to March.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return back.getTime() / DAY_MS
}

export type RoadmapSpan = { start: number; end: number }

/** A block's start and end as a span, when both are dates and end is after start; else null. */
export function roadmapSpan(startValue: unknown, endValue: unknown): RoadmapSpan | null {
  const start = roadmapDate(startValue)
  const end = roadmapDate(endValue)
  return start !== null && end !== null && end > start ? { start, end } : null
}

/** A date's place in the span as a percent, not clamped: (date - start) / (end - start) * 100. */
export function roadmapDatePct(day: number, span: RoadmapSpan): number {
  const days = span.end - span.start
  return days > 0 ? ((day - span.start) / days) * 100 : 0
}
