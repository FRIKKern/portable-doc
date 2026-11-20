// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Barkpark contributors
//
// `sheet` embed emitter — a FRESH table renderer written from walk.ex sheet/3
// (charter D14). It does NOT reuse the web fork's interactive SheetSnapshot grid
// (row-number gutters, checkbox glyphs — a categorically different DOM); it
// renders the dense all-string snapshot into the plain `bp-table` / `bp-sheet__th`
// / `bp-sheet__td` shape the Elixir article walker emits: per-column widths,
// colspan/rowspan merges, per-cell b/i/bg/al styles, engine-error red/bold, the
// default-alignment class, URL-cell anchors, and the truncation note.

import { type Block, escapeHtml, safeUrl, isMap } from '../inline'
import type { RenderCtx } from './chrome'
import { coverSpans, spanAttr, type Span } from './spans'
import { numberText, styleAttr, styleColor, styleOf } from '../../../text/number-text.js'

type Emit = (block: Block, ctx: RenderCtx) => string

const MERGE_AREA_CAP = 10_000

// Engine error vocabulary (Sheets.Engine.error_values) — a cell whose entire
// value is one of these renders red + bold.
//
// This is a MIRROR of `Barkpark.Plugins.Sheets.Engine.error_values/0`
// (@canonical capability:engine-error-vocabulary). WHAT ACTUALLY HOLDS IT:
// `tests/sheet-error-vocabulary.test.ts` in THIS package, which deep-equals the
// set below against `web/__tests__/fixtures/engine-errors.json`. That fixture
// is in turn pinned to `Engine.error_values/0` by
// api/test/barkpark/sheets_parity_test.exs. So the chain has two links and only
// ONE of them can block a merge:
//
//   Engine.error_values/0  ──[sheets_parity_test.exs, runs under `Elixir gate`,
//                            REQUIRED + unfiltered]──► engine-errors.json
//   engine-errors.json     ──[this package's vitest guard, runs under `js-tests`,
//                            which publishes NO required context]──► ERROR_VALUES
//
// DO NOT read the second link as "neither side can drift alone" — an earlier
// version of this comment said exactly that, and it was wrong. THE DRIFT
// HAPPENED: PR #15374 added `#NAME?` engine-side, correctly regenerated the
// fixture, and updated walk.ex, cells.ex, web/lib/sheets.ts and all three golden
// mirrors — but not this file. The guard installed days earlier by #15404 fired
// exactly as designed (run 33650238539 on main, headSha 551c26971b: 2 failed of
// 617, `expected [7] to deeply equal [8]`, missing '#NAME?') and the merge went
// through anyway, because a red in `js-tests` is not a red in the required set.
// For ~a day every `#NAME?` cell rendered as plain black text through
// @barkpark/react while the server, Studio, the Go TUI and mobile all painted it
// as an error. Adding a code engine-side is therefore NOT sufficient: until the
// second link is enforced by a context that can block, this list must be updated
// by hand in the same PR, and a green `js-tests` is the only thing that says you
// did. Exported for the test only — not a public entry point of the package.
export const ERROR_VALUES = new Set([
  '#CYCLE!',
  '#REF!',
  '#VALUE!',
  '#DIV/0!',
  '#N/A',
  '#NUM!',
  '#SPILL!',
  '#NAME?',
])

// A cell whose ENTIRE value is an http(s) URL renders as an anchor.
const SHEET_URL_RE = /^https?:\/\/[^\s<>"']+$/i
// Right-align: General-number / grouped / currency / percent / fixed shapes.
const NUMERIC_RE = /^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?%?$/
// Right-align: ISO date / datetime display strings.
const TEMPORAL_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? numberText(v) : ''
}

// A column's width in px: a whole number above 0, else none.
function colWidth(colWidths: unknown, idx: number): number | null {
  const w = Array.isArray(colWidths) ? colWidths[idx] : undefined
  return typeof w === 'number' && Number.isInteger(w) && w > 0 ? w : null
}

function sheetMerges(merges: unknown): Span[] {
  if (!Array.isArray(merges)) return []
  return merges.filter(
    (m): m is Span =>
      Array.isArray(m) &&
      m.length === 4 &&
      m.every(Number.isInteger) &&
      m[0] >= 0 &&
      m[1] >= 0 &&
      m[2] >= 1 &&
      m[3] >= 1 &&
      m[2] * m[3] <= MERGE_AREA_CAP,
  )
}

function cellStyle(styles: unknown, r: number, c: number): Record<string, unknown> | null {
  const s = isMap(styles) ? styles[`${numberText(r)},${numberText(c)}`] : undefined
  return isMap(s) ? s : null
}

// A cell's inline style (sheet_inline_style/1): its column's width, then its own bold, italic,
// background (a strict #rrggbb, Sheets.CondFormat.valid_bg?) and alignment, then an error value's
// red bold. Each property ends with `;`, but the error's last one does not.
function sheetStyle(width: number | null, s: Record<string, unknown> | null, err: boolean): string {
  return styleAttr(
    [
      styleOf('width', width, { after: 'px' }),
      s?.b === true ? 'font-weight:bold' : '',
      s?.i === true ? 'font-style:italic' : '',
      styleColor('background', s?.bg, { shape: 'hex6' }),
      s?.al === 'left' || s?.al === 'center' || s?.al === 'right' ? `text-align:${s.al}` : '',
      err ? 'color:#dc2626' : '',
      err ? 'font-weight:bold' : '',
    ],
    { end: err ? '' : ';' },
  )
}

function explicitAl(styles: unknown, r: number, c: number): boolean {
  const s = cellStyle(styles, r, c)
  return s !== null && (s.al === 'left' || s.al === 'center' || s.al === 'right')
}

function defaultAlignClass(cell: string): string | null {
  if (cell === 'TRUE' || cell === 'FALSE') return 'sheet-al-center'
  if (NUMERIC_RE.test(cell) || TEMPORAL_RE.test(cell)) return 'sheet-al-right'
  return null
}

function cellHtml(cell: string): string {
  if (SHEET_URL_RE.test(cell)) {
    return `<a href="${safeUrl(cell)}" class="bp-sheet-link" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(cell)}</a>`
  }
  return escapeHtml(cell)
}

const sheet: Emit = (b, ctx) => {
  const snap = isMap(b.snapshot) ? b.snapshot : {}
  const head = Array.isArray(snap.head) ? snap.head.map(toStr) : []
  const body = Array.isArray(snap.rows)
    ? snap.rows.map((row) => (Array.isArray(row) ? row.map(toStr) : []))
    : []
  const colWidths = snap.col_widths
  const styles = snap.styles
  const { anchors, covered } = coverSpans(
    sheetMerges(snap.merges),
    body.map((row) => row.length),
    false,
  )

  const thead =
    head.length === 0
      ? ''
      : `<thead><tr>${head
          .map((cell, idx) => `<th class="bp-sheet__th"${sheetStyle(colWidth(colWidths, idx), null, false)}>${escapeHtml(cell)}</th>`)
          .join('')}</tr></thead>`

  const tbody = body
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (covered.has(`${numberText(r)},${numberText(c)}`)) return ''
          const span = spanAttr(anchors, r, c)
          const alignClass = explicitAl(styles, r, c) ? null : defaultAlignClass(cell)
          const tdClass = ['bp-sheet__td', alignClass].filter(Boolean).join(' ')
          return `<td${span} class="${tdClass}"${sheetStyle(colWidth(colWidths, c), cellStyle(styles, r, c), ERROR_VALUES.has(cell))}>${cellHtml(cell)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  const table = `<table role="presentation" class="bp-table">${thead}<tbody>${tbody}</tbody></table>`

  const note =
    snap.truncated === true
      ? `<p class="bp-sheet-note">${escapeHtml(ctx.t('Sheet truncated — showing the first %{n} rows', { n: body.length }))}</p>`
      : ''

  return table + note
}

export const sheetEmitters: Record<string, Emit> = { sheet }
