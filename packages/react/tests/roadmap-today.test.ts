import { describe, it, expect } from 'vitest'
import { renderPortableDocument, type Block } from '../src'

// A roadmap's today is a YYYY-MM-DD date (spec/blocks.schema.json types it as a string). Its line is
// drawn at its place in the block's start–end span, clamped to the track; with no valid span, or a
// today that is not a date, there is no line. Barkpark's components.ex does the same arithmetic.
const roadmap = (fields: Record<string, unknown>) =>
  ({ type: 'roadmap', snapshot: [{ title: 'Build', left: 0, width: 50, status: 'done' }], ...fields }) as Block
const todayLines = (fields: Record<string, unknown>) =>
  renderPortableDocument([roadmap(fields)], {}).match(/<span class="bp-rm__today"[^>]*><\/span>/g) ?? []
// Ten days, so each day is ten percent.
const SPAN = { start: '2026-01-01', end: '2026-01-11' }

describe("a roadmap's today line", () => {
  it('a valid roadmap with today, start and end draws its today line at its place in the span', () => {
    expect(todayLines({ ...SPAN, today: '2026-01-04' })).toEqual(['<span class="bp-rm__today" style="left:30%"></span>'])
    expect(todayLines({ ...SPAN, today: ' 2026-01-06 ' })).toEqual(['<span class="bp-rm__today" style="left:50%"></span>'])
  })

  it('a today before the span is drawn at 0, one after it at 100', () => {
    expect(todayLines({ ...SPAN, today: '2025-12-01' })).toEqual(['<span class="bp-rm__today" style="left:0%"></span>'])
    expect(todayLines({ ...SPAN, today: '2026-03-01' })).toEqual(['<span class="bp-rm__today" style="left:100%"></span>'])
  })

  it('no line when start or end is missing or not a date, or end is not after start', () => {
    const today = '2026-01-04'
    for (const span of [
      { end: SPAN.end },
      { start: SPAN.start },
      { start: 'soon', end: SPAN.end },
      { start: SPAN.start, end: '2026-02-30' },
      { start: '2026-1-1', end: SPAN.end },
      { start: SPAN.start, end: SPAN.start },
      { start: SPAN.end, end: SPAN.start },
    ])
      expect(todayLines({ ...span, today }), JSON.stringify(span)).toEqual([])
  })

  it('no line when today is not a date: a word, an impossible day, or a number', () => {
    for (const today of ['soon', '2026-02-30', 40]) expect(todayLines({ ...SPAN, today }), JSON.stringify(today)).toEqual([])
  })
})
