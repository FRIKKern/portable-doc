/**
 * Sandbox / disposable — headless TipTap editor mount helper.
 *
 * No DOM mount; we use TipTap's headless mode to run round-trip JSON
 * conversions in the happy-dom test environment.
 *
 * Different block contexts need different ProseMirror doc wrappers. Paragraph
 * and callout-body use a plain paragraph wrapper. List-item wraps the inline
 * content inside a paragraph inside a listItem inside a bulletList. The
 * "action label" context is treated as a paragraph too — actions in the AST
 * carry a string label, and the round-trip is over the same inline shape.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { JSONContent } from '@tiptap/core';

export type BlockContext = 'paragraph' | 'callout' | 'list-item' | 'action-label';

function wrapDoc(context: BlockContext, inline: JSONContent[]): JSONContent {
  const paragraph: JSONContent = { type: 'paragraph', content: inline };
  switch (context) {
    case 'paragraph':
    case 'callout':
    case 'action-label':
      return { type: 'doc', content: [paragraph] };
    case 'list-item':
      return {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [paragraph] }],
          },
        ],
      };
  }
}

export function mountEditor(context: BlockContext, inline: JSONContent[]): Editor {
  return new Editor({
    extensions: [StarterKit],
    content: wrapDoc(context, inline),
  });
}

/**
 * Pull the inline content out of the editor's current JSON, regardless of
 * which block context it was wrapped in. Walks down to the first node with
 * a `text`-leaf-bearing content array.
 */
export function getEditorInline(editor: Editor, context: BlockContext): JSONContent[] {
  // TipTap's typed getJSON() narrows children to NodeType | TextType — for the
  // sandbox we want the loose JSONContent walk, which is what the JSON
  // actually is at runtime.
  const json = editor.getJSON() as JSONContent;
  switch (context) {
    case 'paragraph':
    case 'callout':
    case 'action-label':
      return json.content?.[0]?.content ?? [];
    case 'list-item': {
      const list = json.content?.[0];
      const item = list?.content?.[0];
      const para = item?.content?.[0];
      return para?.content ?? [];
    }
  }
}
