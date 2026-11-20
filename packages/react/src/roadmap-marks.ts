// A roadmap's marks: the style every mark on a lane's track writes, and a placed bar's point marks
// (Barkpark's components.ex roadmap_marks_html/3). A note is a mark at the bar's left, a milestone a
// mark at the bar's end; each is drawn when its field is true, "true" or 1 (the note's text is not
// shown). The note comes first, so a milestone at the same place paints over it, and the lane's
// today line follows both. A left or width that is not a finite number gives the mark no place, so
// no mark is drawn.
import { styleAttr, styleOf } from '../../text/number-text.js'

/** A roadmap mark's style: its left, and a bar's width, each a percent of the track. The bar, its note and milestone, and the today line all write through it. */
export const markStyle = (left: number | null, width?: number | null) =>
  styleAttr([styleOf('left', left, { after: '%' }), styleOf('width', width, { after: '%' })])

export function roadmapMarks(note: boolean, milestone: boolean, left: number | null, width: number | null): string {
  if (left === null || width === null || !Number.isFinite(left) || !Number.isFinite(width)) return ''
  // The bar's end, held to the track as Barkpark's clampf holds it.
  const end = Math.min(Math.max(left + width, 0), 100)
  return (note ? `<span class="bp-rm__note"${markStyle(left)}></span>` : '') + (milestone ? `<span class="bp-rm__ms"${markStyle(end)}></span>` : '')
}
