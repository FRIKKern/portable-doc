# @portable-doc/react

The canonical React renderer for PortableDoc's type-keyed block format. It is a
pure renderer: no hooks, browser globals, Barkpark client, or Barkpark runtime
package is required.

```tsx
import { PortableDoc } from '@portable-doc/react'
import '@portable-doc/react/paper-surface.css'

export function Article() {
  return <PortableDoc value={[{ type: 'heading', level: 1, text: 'Hello' }]} />
}
```

Use `renderPortableDocument(blocks)` when a framework needs the inner HTML
string rather than a React element.

For documents with schema fields or transclusions, register the opt-in renderers.

```tsx
import { embedBlocks } from '@portable-doc/react/embed'
import { fieldBlocks } from '@portable-doc/react/field-blocks'

const renderers = { ...fieldBlocks, ...embedBlocks() }
```

Pass `renderers` as the `blocks` prop or render option. Without a resolved target,
`embedBlocks()` renders an inert placeholder. Pass only HTML you rendered or
trust when supplying a target map to `embedBlocks`.

The initial source extraction is recorded in `SOURCE.json`. The R6.1 Barkpark
follow-up will keep its old `@barkpark/react/portable-doc` path as a
compatibility re-export; that cross-repository change is deliberately separate
from this package.
