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

The initial source extraction is recorded in `SOURCE.json`. The R6.1 Barkpark
follow-up will keep its old `@barkpark/react/portable-doc` path as a
compatibility re-export; that cross-repository change is deliberately separate
from this package.
