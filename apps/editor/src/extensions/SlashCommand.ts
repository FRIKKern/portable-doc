/**
 * A3 — Slash-command TipTap extension.
 *
 * Wraps `@tiptap/suggestion` in `Extension.create({ addProseMirrorPlugins })`.
 * Suggestion owns "/" trigger detection + popup lifecycle (onStart, onUpdate,
 * onKeyDown, onExit) + query-substring extraction. Paperflow owns the DOM
 * (the `SlashPopover` React component) and the command catalog (10 block
 * types in `lib/slash-filter.ts`).
 *
 * Grill Q4 — disabled inside code blocks: `Suggestion`'s `allow` predicate
 * returns `false` when the cursor's resolved-position chain includes a
 * `codeBlock` node, making the plugin ignore the trigger entirely.
 */
import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
  type SuggestionKeyDownProps,
} from '@tiptap/suggestion';
import type { Editor } from '@tiptap/core';
import {
  COMMANDS,
  SlashPopover,
  type SlashPopoverHandle,
  type SlashCommand as SlashCmd,
} from '../SlashPopover.js';
import { filterCommands } from '../lib/slash-filter.js';

type Range = { from: number; to: number };

export function applyInsert(
  editor: Editor,
  range: Range,
  cmd: SlashCmd,
): void {
  const chain = editor.chain().focus().deleteRange(range);

  switch (cmd.type) {
    case 'heading':
      chain.setNode('heading', { level: 1 }).run();
      return;
    case 'paragraph':
      chain.setNode('paragraph').run();
      return;
    case 'list':
      chain.toggleBulletList().run();
      return;
    case 'callout':
      chain.toggleBlockquote().run();
      return;
    case 'action':
      chain
        .insertContent({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Action',
              marks: [{ type: 'link', attrs: { href: '#' } }],
            },
          ],
        })
        .run();
      return;
    case 'section':
      chain.setNode('heading', { level: 2 }).run();
      return;
    case 'divider':
      chain.setHorizontalRule().run();
      return;
    case 'code':
      chain.toggleCodeBlock().run();
      return;
    case 'image':
      chain.insertContent('<p><em>Image (not yet wired)</em></p>').run();
      return;
    case 'table':
      // 3×3 with a header row is the standard "new table" default for
      // Notion/TipTap/most editors. Cells start empty; Tab/Shift+Tab
      // cycles through them. Column resize is deferred to v0.5.
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    default:
      return;
  }
}

interface AllowState {
  selection: {
    $from: {
      node: (depth: number) => { type: { name: string } };
      depth: number;
    };
  };
}

export function isInsideCodeBlock(state: AllowState): boolean {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node?.type?.name === 'codeBlock') return true;
  }
  return false;
}

type RenderClientRect = () => DOMRect | null;

function buildSuggestionRender(): () => {
  onStart: (props: SuggestionProps<SlashCmd>) => void;
  onUpdate: (props: SuggestionProps<SlashCmd>) => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onExit: () => void;
} {
  return () => {
    let renderer: ReactRenderer<SlashPopoverHandle> | null = null;

    const anchorFor = (
      clientRect: RenderClientRect | null | undefined,
    ): { x: number; y: number } => {
      const rect = clientRect?.();
      if (!rect) return { x: 16, y: 60 };
      return {
        x: rect.left + window.scrollX,
        y: rect.bottom + window.scrollY + 6,
      };
    };

    return {
      onStart: (props) => {
        renderer = new ReactRenderer(SlashPopover, {
          props: {
            items: props.items,
            anchor: anchorFor(props.clientRect),
            onSelect: (cmd: SlashCmd) => {
              props.command(cmd);
            },
            onClose: () => {
              const el = renderer?.element;
              if (el instanceof HTMLElement) el.remove();
            },
          },
          editor: props.editor,
        });
        if (renderer.element instanceof HTMLElement) {
          document.body.appendChild(renderer.element);
        }
      },
      onUpdate: (props) => {
        if (!renderer) return;
        renderer.updateProps({
          items: props.items,
          anchor: anchorFor(props.clientRect),
        });
      },
      onKeyDown: ({ event }) => {
        if (!renderer?.ref) return false;
        return renderer.ref.onKeyDown(event);
      },
      onExit: () => {
        if (!renderer) return;
        const el = renderer.element;
        if (el instanceof HTMLElement) el.remove();
        renderer.destroy();
        renderer = null;
      },
    };
  };
}

export interface SlashCommandOptions {
  suggestion: Partial<SuggestionOptions<SlashCmd>>;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        allow: ({ state }: { state: AllowState }) => !isInsideCodeBlock(state),
        items: ({ query }: { query: string }): SlashCmd[] =>
          [...filterCommands(query)] satisfies SlashCmd[],
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCmd;
        }) => {
          applyInsert(editor, range, props);
        },
        render: buildSuggestionRender(),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCmd>({
        editor: this.editor,
        ...this.options.suggestion,
      } as SuggestionOptions<SlashCmd>),
    ];
  },
});

export { COMMANDS };
export type { SlashCmd as SlashCommandData };
