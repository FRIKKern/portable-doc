import { type Block, asList, isMap } from './inline'

const LIST_TYPES = [
  'list',
  'bulletList',
  'bullet_list',
  'bulleted-list',
  'bulleted_list',
  'ordered-list',
  'numbered_list',
]

// The blocks under a list item, in order: nested lists, and any other block (a
// heading, a callout, a code block). A list with no `items` array, or a child
// that is not a typed block, stays opaque. Barkpark's walk.ex renders only the
// nested lists yet, so an item with another block differs from it until it does.
export function listChildren(item: unknown): Block[] {
  if (!isMap(item)) return []
  return asList(item.children).filter(
    (child): child is Block =>
      isMap(child) &&
      typeof child.type === 'string' &&
      (Array.isArray(child.items) || !LIST_TYPES.includes(child.type)),
  )
}
