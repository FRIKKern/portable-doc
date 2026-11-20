import { describe, it, expect } from 'vitest'
import { renderPortableDocument, type Block } from '../src'

// A placed roadmap row's note and milestone are marks on its bar, as Barkpark's components.ex
// roadmap_marks_html/3 draws them: a note at the bar's left, a milestone at the bar's end, each when
// its field is true, "true" or 1. In the track they follow the bar, note before milestone, and the
// today line comes last. A lane with no place, or a bar whose left or width is not finite, has none.
const SPAN = { start: '2026-01-01', end: '2026-01-11' } // ten days, so each day is ten percent
const html = (fields: Record<string, unknown>, snapshot: Record<string, unknown>[]) =>
  renderPortableDocument([{ type: 'roadmap', ...fields, snapshot } as Block], {})
// Each lane's marks, in the order they are drawn.
const marks = (fields: Record<string, unknown>, snapshot: Record<string, unknown>[]) =>
  [...html(fields, snapshot).matchAll(/<div class="bp-rm__track">(.*?)<\/div>/g)].map((t) =>
    [...t[1].matchAll(/<span class="bp-rm__(note|ms)"([^>]*)><\/span>/g)].map((m) => `${m[1]}${m[2]}`),
  )
const row = (fields: Record<string, unknown>) => ({ title: 'Row', status: 'done', ...fields })
const BAR = { left: 10, width: 30 }

describe("a placed roadmap row's notes and milestones", () => {
  it('a note is a mark at the bar\'s left', () => {
    expect(marks({}, [row({ ...BAR, note: true })])).toEqual([['note style="left:10%"']])
  })

  it("a milestone is a mark at the bar's end", () => {
    expect(marks({}, [row({ ...BAR, milestone: true })])).toEqual([['ms style="left:40%"']])
  })

  it('a dated row has both marks at its dates', () => {
    expect(marks(SPAN, [row({ start: '2026-01-03', end: '2026-01-07', note: true, milestone: true })])).toEqual([
      ['note style="left:20%"', 'ms style="left:60%"'],
    ])
  })

  it('a row wholly after the span has both marks at 100', () => {
    expect(marks(SPAN, [row({ start: '2026-01-21', end: '2026-01-31', note: true, milestone: true })])).toEqual([
      ['note style="left:100%"', 'ms style="left:100%"'],
    ])
  })

  it('a row wholly before the span has its note at 0 and its milestone at 1', () => {
    expect(marks(SPAN, [row({ start: '2025-12-01', end: '2025-12-11', note: true, milestone: true })])).toEqual([
      ['note style="left:0%"', 'ms style="left:1%"'],
    ])
  })

  it('true, "true" and 1 draw a mark; any other value does not', () => {
    for (const on of [true, 'true', 1])
      expect(marks({}, [row({ ...BAR, note: on, milestone: on })]), String(on)).toEqual([['note style="left:10%"', 'ms style="left:40%"']])
    for (const off of [false, 'yes', '1', 0, 2, 'Ship it', null, {}])
      expect(marks({}, [row({ ...BAR, note: off, milestone: off })]), String(off)).toEqual([[]])
  })

  it('a lane with no place has no marks, nor does a roadmap with no schedule', () => {
    expect(marks({}, [row(BAR), row({ note: true, milestone: true })])).toEqual([[], []])
    const none = html({}, [row({ note: true, milestone: true })])
    expect(none).toContain('No schedule to place these items on.')
    expect(none).not.toMatch(/bp-rm__(note|ms)/)
  })

  it('a row with neither renders as before, byte for byte', () => {
    expect(html({ ...SPAN, today: '2026-01-06' }, [row(BAR), row({ start: '2026-01-03', end: '2026-01-07', status: 'todo' })])).toBe(
      '<div class="bp-roadmap"><div class="bp-rm__lanes">' +
        '<div class="bp-rm__lane"><span class="bp-rm__lbl">Row</span><div class="bp-rm__track">' +
        '<span class="bp-rm__bar bp-rm__bar--done" style="left:10%;width:30%"></span><span class="bp-rm__today" style="left:50%"></span></div></div>' +
        '<div class="bp-rm__lane"><span class="bp-rm__lbl">Row</span><div class="bp-rm__track">' +
        '<span class="bp-rm__bar bp-rm__bar--todo" style="left:20%;width:40%"></span><span class="bp-rm__today" style="left:50%"></span></div></div>' +
        '</div></div>',
    )
  })

  it('the track draws the bar, then the note, then the milestone, then today', () => {
    const track = /<div class="bp-rm__track">(.*?)<\/div>/.exec(html({ ...SPAN, today: '2026-01-06' }, [row({ ...BAR, note: true, milestone: true })]))
    expect(track?.[1]).toBe(
      '<span class="bp-rm__bar bp-rm__bar--done" style="left:10%;width:30%"></span>' +
        '<span class="bp-rm__note" style="left:10%"></span><span class="bp-rm__ms" style="left:40%"></span>' +
        '<span class="bp-rm__today" style="left:50%"></span>',
    )
  })

  it('a bar whose left or width is not finite has no marks', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(marks({}, [row({ left: bad, width: 30, note: true, milestone: true })]), `left ${bad}`).toEqual([[]])
      expect(marks({}, [row({ left: 10, width: bad, note: true, milestone: true })]), `width ${bad}`).toEqual([[]])
    }
  })
})
