import { describe, it, expect } from 'vitest'
import { renderPortableDocument, type Block } from '../src'

// A callout's `slots.body` blocks render after its content, inside `.bp-callout__body`.
// A Markdown callout imports its first paragraph as content and every block after it as
// body, so without them the reader saw only the first paragraph, or nothing at all.
// A callout with no body renders the bytes it always did (goldens/fragments.json pins one).
// Barkpark's walk.ex does not render the body yet: a callout WITH a body differs from it
// until it does.
const t = (value: string) => ({ type: 'text', value })
const p = (value: string) => ({ type: 'paragraph', content: [t(value)] })
const callout = (fields: Record<string, unknown>) => ({ type: 'callout', tone: 'info', ...fields }) as Block

describe("a callout's body", () => {
  it('renders after its content, in the plain form and the collapsible one', () => {
    const slots = { body: [p('Second paragraph.')] }
    expect(renderPortableDocument([callout({ content: [t('Heads up')], slots })])).toBe(
      '<div class="bp-callout bp-callout--info"><span>Heads up</span><div class="bp-callout__body"><p>Second paragraph.</p></div></div>',
    )
    expect(renderPortableDocument([callout({ collapsible: true, title: 'T', content: [t('Heads up')], slots })])).toBe(
      '<details open class="bp-callout bp-callout--info"><summary class="bp-callout__summary">T</summary>' +
        '<div class="bp-callout__body"><span>Heads up</span><p>Second paragraph.</p></div></details>',
    )
  })

  it('renders when the callout has no content', () => {
    expect(renderPortableDocument([callout({ content: [], slots: { body: [p('Only a body.')] } })])).toBe(
      '<div class="bp-callout bp-callout--info"><span></span><div class="bp-callout__body"><p>Only a body.</p></div></div>',
    )
  })

  it('leaves a callout with no body, or an empty one, as it was', () => {
    const before = '<div class="bp-callout bp-callout--info"><span>Just this</span></div>'
    for (const slots of [undefined, {}, { body: [] }]) {
      expect(renderPortableDocument([callout({ content: [t('Just this')], slots })]), JSON.stringify(slots)).toBe(before)
    }
  })
})
