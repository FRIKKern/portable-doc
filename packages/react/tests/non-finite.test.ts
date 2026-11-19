import { describe, it, expect } from 'vitest'
import { renderPortableDocument, type Block } from '../src'

// NaN and Infinity cannot come from JSON, but a caller can pass them. The text renderers
// write nothing for them (str() reads a finite number only); the HTML writes nothing too,
// never "NaN" or "Infinity". A finite number still shows its digits.
const html = (block: Block) => renderPortableDocument([block], {}).replace(/ (?:class|role|style)="[^"]*"/g, '')
const t = (value: string) => ({ type: 'text', value })

describe('a number that is not finite renders nothing', () => {
  it('as a column label, an inline code child, an inline node, a table cell and a paragraph', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const label = String(bad)
      // A column label is read through the alias table, where such a number is not text: the
      // column is headed by its key, as a column with no label is.
      expect(html({ type: 'table', columns: [{ key: 'kk', label: bad }], rows: [{ kk: 'c' }] } as Block), label).toBe(
        '<table><thead><tr><th><span>kk</span></th></tr></thead><tbody><tr><td><span>c</span></td></tr></tbody></table>',
      )
      expect(html({ type: 'table', columns: [{ key: 'kk', text: bad }], rows: [{ kk: 'c' }] } as Block), label).toContain('<th><span>kk</span></th>')
      expect(html({ type: 'paragraph', content: [t('Left'), { type: 'code', children: bad }, t('Right')] } as Block), label).toBe('<p>Left<code></code>Right</p>')
      expect(html({ type: 'paragraph', content: [{ type: 'code', children: [bad] }] } as Block), label).toBe('<p><code></code></p>')
      expect(html({ type: 'paragraph', content: [t('a'), bad, t('b')] } as Block), label).toBe('<p>ab</p>')
      // A paragraph of only whitespace and such a number is blank, as one of only whitespace is: it renders nothing.
      expect(html({ type: 'paragraph', content: [' ', bad, ' '] } as Block), label).toBe('')
      expect(html({ type: 'table', columns: [{ key: 'kk', text: 'K' }], rows: [{ kk: bad }] } as Block), label).toContain('<td></td>')
    }
  })

  it('a finite number keeps its digits in the same places', () => {
    expect(html({ type: 'table', columns: [{ key: 'kk', label: 7 }], rows: [{ kk: 'c' }] } as Block)).toContain('<th><span>7</span></th>')
    expect(html({ type: 'paragraph', content: [{ type: 'code', children: -1.5 }] } as Block)).toBe('<p><code>-1.5</code></p>')
    expect(html({ type: 'paragraph', content: [t('a'), 0, t('b')] } as Block)).toBe('<p>a0b</p>')
    expect(html({ type: 'table', columns: [{ key: 'kk', text: 'K' }], rows: [{ kk: 3 }] } as Block)).toContain('<td><span>3</span></td>')
  })
})
