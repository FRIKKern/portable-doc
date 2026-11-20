// A placed roadmap bar's point marks: Barkpark's components.ex roadmap_marks_html/3. A note is a mark
// at the bar's left, a milestone a mark at the bar's end; each is drawn when its field is true,
// "true" or 1 (the note's text is not shown). The note comes first, so a milestone at the same place
// paints over it, and the lane's today line follows both. A left or width that is not a finite
// number gives the mark no place, so no mark is drawn.
import { styleAttr, styleOf } from '../../text/number-text.js'

export function roadmapMarks(note: boolean, milestone: boolean, left: number | null, width: number | null): string {
  if (left === null || width === null || !Number.isFinite(left) || !Number.isFinite(width)) return ''
  // The bar's end, held to the track as Barkpark's clampf holds it.
  const end = Math.min(Math.max(left + width, 0), 100)
  return (
    (note ? `<span class="bp-rm__note"${styleAttr([styleOf('left', left, { after: '%' })])}></span>` : '') +
    (milestone ? `<span class="bp-rm__ms"${styleAttr([styleOf('left', end, { after: '%' })])}></span>` : '')
  )
}
