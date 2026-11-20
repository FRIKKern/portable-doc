import { describe, it, expect } from 'vitest'
import { renderPortableDocument, type Block } from '../src'
import { fieldBlocks } from '../src/field-blocks'

// A colour and a sheet cell's style go into the HTML through the door (styleColor and styleAttr in
// packages/text/number-text.js). Each site's style attribute, for the inputs that pick its rules.
const styles = (block: Block) => [...renderPortableDocument([block], { blocks: fieldBlocks }).matchAll(/ style="([^"]*)"/g)].map((m) => m[1])

describe('a style written through the door', () => {
  it('a colour field keeps a 3- or 6-digit hex as typed, and writes transparent for any other value', () => {
    const swatch = (value: string) => styles({ type: 'field-color', label: 'Accent', value } as Block)
    expect(swatch('#AbC')).toEqual(['background:#AbC'])
    expect(swatch('#1e5347')).toEqual(['background:#1e5347'])
    expect(swatch('red')).toEqual(['background:transparent'])
    expect(swatch('#abcd')).toEqual(['background:transparent'])
  })

  it('a sheet cell writes its width, bold, italic, a 6-digit background and alignment, then an error value in red bold', () => {
    const sheet = {
      type: 'sheet',
      snapshot: {
        col_widths: [12],
        head: ['Item', 'Cost', 'Note'],
        rows: [['Hosting', '#DIV/0!', 'a'], ['Domains', '18', 'b']],
        styles: { '0,0': { b: true, bg: '#ABCDEF', al: 'center' }, '0,1': { i: true }, '0,2': { bg: '#abc', al: 'middle' }, '1,1': { bg: '#12345g', al: 'right' } },
      },
    } as Block
    // The head's width, then row 1 (the 3-digit background and the unknown alignment write nothing in
    // its third cell), then row 2.
    expect(styles(sheet)).toEqual([
      'width:12px;',
      'width:12px;font-weight:bold;background:#ABCDEF;text-align:center;',
      'font-style:italic;color:#dc2626;font-weight:bold',
      'width:12px;',
      'text-align:right;',
    ])
  })
})
