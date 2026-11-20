import { describe, it, expect } from 'vitest'
import { renderPortableDocument, type Block } from '../src'

// A roadmap row with its own start and end dates is placed on the block's start–end span, as
// Barkpark's components.ex roadmap_left_width/2 places it: left is the row start's place, clamped to
// the track; width is the row end's place less that clamped left, at least 1 and at most what is left
// of the track. A row without two dates, or in a roadmap without a valid span, keeps its left and
// width numbers; a row with neither is unplaced.
const SPAN = { start: '2026-01-01', end: '2026-01-11' } // ten days, so each day is ten percent
const html = (fields: Record<string, unknown>, snapshot: Record<string, unknown>[]) =>
  renderPortableDocument([{ type: 'roadmap', ...fields, snapshot } as Block], {})
// Each lane as its bar's style, or "unplaced".
const lanes = (fields: Record<string, unknown>, snapshot: Record<string, unknown>[]) =>
  [...html(fields, snapshot).matchAll(/<div class="bp-rm__track">(?:<span class="bp-rm__bar[^"]*" style="([^"]*)"><\/span>|<span class="bp-rm__unplaced">[^<]*<\/span>)/g)].map(
    (m) => m[1] ?? 'unplaced',
  )
const row = (fields: Record<string, unknown>) => ({ title: 'Row', status: 'done', ...fields })

describe('a roadmap row with start and end dates', () => {
  it('a dated row inside the span is placed at its dates', () => {
    expect(lanes(SPAN, [row({ start: '2026-01-03', end: '2026-01-07' })])).toEqual(['left:20%;width:40%'])
    // Its dates come before its numbers.
    expect(lanes(SPAN, [row({ start: '2026-01-03', end: '2026-01-07', left: 70, width: 10 })])).toEqual(['left:20%;width:40%'])
  })

  it('a row starting before the span starts at 0 and still ends at its true place', () => {
    expect(lanes(SPAN, [row({ start: '2025-12-30', end: '2026-01-04' })])).toEqual(['left:0%;width:30%'])
  })

  it('a row ending before it starts is 1 wide', () => {
    expect(lanes(SPAN, [row({ start: '2026-01-06', end: '2026-01-03' })])).toEqual(['left:50%;width:1%'])
  })

  it('a row wholly after the span is at 100 and 0 wide', () => {
    expect(lanes(SPAN, [row({ start: '2026-01-21', end: '2026-01-31' })])).toEqual(['left:100%;width:0%'])
  })

  it('a row wholly before the span is at 0 and 1 wide', () => {
    expect(lanes(SPAN, [row({ start: '2025-12-01', end: '2025-12-11' })])).toEqual(['left:0%;width:1%'])
  })

  it('a row whose dates are not both dates keeps its left and width numbers', () => {
    expect(lanes(SPAN, [row({ start: 'soon', end: '2026-01-07', left: 10, width: 30 })])).toEqual(['left:10%;width:30%'])
  })

  it('a row whose dates are not both dates, with no numbers, is unplaced', () => {
    const out = html(SPAN, [row({ left: 0, width: 50 }), row({ start: '2026-02-30', end: '2026-01-07' })])
    expect(lanes(SPAN, [row({ left: 0, width: 50 }), row({ start: '2026-02-30', end: '2026-01-07' })])).toEqual(['left:0%;width:50%', 'unplaced'])
    expect(out).toContain('<span class="bp-rm__unplaced">not scheduled</span>')
  })

  it('with no valid block span, a dated row keeps its numbers, and one without numbers is unplaced', () => {
    const rows = [row({ start: '2026-01-03', end: '2026-01-07', left: 10, width: 30 }), row({ start: '2026-01-03', end: '2026-01-07' })]
    for (const fields of [{}, { start: SPAN.start }, { start: SPAN.end, end: SPAN.start }, { start: SPAN.start, end: SPAN.start }])
      expect(lanes(fields, rows), JSON.stringify(fields)).toEqual(['left:10%;width:30%', 'unplaced'])
  })

  it('a roadmap whose rows are all dated is drawn, not "No schedule to place these items on."', () => {
    const out = html(SPAN, [row({ start: '2026-01-03', end: '2026-01-07' }), row({ start: '2026-01-05', end: '2026-01-11' })])
    expect(out).not.toContain('No schedule to place these items on.')
    expect(lanes(SPAN, [row({ start: '2026-01-03', end: '2026-01-07' }), row({ start: '2026-01-05', end: '2026-01-11' })])).toEqual(['left:20%;width:40%', 'left:40%;width:60%'])
  })
})
