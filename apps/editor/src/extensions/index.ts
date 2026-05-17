/**
 * Paperflow's TipTap extension stack.
 *
 * Editor.tsx wires the editor instance + React glue; this module owns
 * the "which extensions make up paperflow" question. Match Novel's
 * `extensions/index.ts` shape — one factory, no side effects.
 *
 * Why a factory (not a static const)
 * ----------------------------------
 * The slash-menu's `onImageRequest` callback needs to read the LATEST
 * host handler at command-time (so a host-component re-render with a
 * new closure doesn't get lost). Callers pass a ref-based getter via
 * `BuildExtensionsOpts.getOnImageRequest` and we read it through that
 * indirection — the extension array itself stays referentially stable
 * across renders, which is what keeps `useEditor`'s compareOptions
 * from rebuilding the ProseMirror view.
 */
import type { Extension, Node } from '@tiptap/core';
import type { Editor as TipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import Blockquote from '@tiptap/extension-blockquote';
import CodeBlock from '@tiptap/extension-code-block';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { withBlockChrome } from './withBlockChrome.js';
import { SlashCommand } from './SlashCommand.js';
import { MoveBlock } from './MoveBlock.js';

export interface BuildExtensionsOpts {
  /** Late-bound getter for the host's image-insert handler.
   *  Returns the current handler (or undefined when omitted). The
   *  indirection lets host-component re-renders refresh the handler
   *  without invalidating the extension array. */
  getOnImageRequest: () => ((editor: TipTapEditor) => void) | undefined;
}

/** Build the canonical paperflow extension stack.
 *
 *  Tab-extends-row inside tables is shipped by
 *  `@tiptap/extension-table@3.23.4+` (Tab tries `goToNextCell()` first
 *  and falls through to `addRowAfter()` when at the last cell); no
 *  override needed.
 */
export function buildExtensions(
  opts: BuildExtensionsOpts,
): Array<Extension | Node> {
  return [
    StarterKit.configure({
      // Drop the seven block nodes — withBlockChrome re-adds them
      // below with paperflow's chrome NodeView.
      paragraph: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      // Link safety: reject anything that isn't http(s) or mailto so a
      // malicious paste can't smuggle `javascript:` or `data:` URLs into
      // the doc. `openOnClick: false` matches the editor convention —
      // clicks place a caret; the FormatBubble's link affordance edits
      // and removes.
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
        validate: (href: string) =>
          /^https?:\/\//i.test(href) || /^mailto:/i.test(href),
      },
    }),
    withBlockChrome(Paragraph),
    withBlockChrome(Heading.configure({ levels: [1, 2, 3, 4, 5, 6] })),
    withBlockChrome(BulletList),
    withBlockChrome(OrderedList),
    withBlockChrome(Blockquote),
    withBlockChrome(CodeBlock),
    withBlockChrome(HorizontalRule),
    // Table needs all four nodes registered together — Table contains
    // TableRow, which contains TableCell/TableHeader. `resizable: false`
    // keeps v0.4 minimum scope; column resize is v0.5.
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    // Image (web/native only — PortableDoc's image block surfaces are
    // narrowed to those two; backends without raster support skip it
    // at render time). `inline: false` keeps images as block-level
    // nodes so they sit on their own line. `allowBase64: false`
    // blocks data-URLs from being pasted, matching the link validate
    // policy.
    Image.configure({
      inline: false,
      allowBase64: false,
      HTMLAttributes: { class: 'paper-block__image' },
    }),
    SlashCommand.configure({
      onImageRequest: (e) => opts.getOnImageRequest()?.(e),
    }),
    MoveBlock,
    // CW5 / T3b — the canonical Tiptap floating drag handle (what
    // Novel uses). Renders ONE `<div class="drag-handle"
    // data-drag-handle>` next to the editor's parent and positions it
    // on mousemove. Drives PM's built-in drag pipeline (NodeSelection
    // → slice serialize → drop). `dragHandleWidth: 20` matches the
    // visual slot the floating chrome reserves.
    GlobalDragHandle.configure({
      dragHandleWidth: 20,
      scrollTreshold: 100,
    }),
    // Companion to GlobalDragHandle — auto-joins adjacent lists after
    // a drag-reorder so dragging a list item out of List A and
    // adjacent to List B merges them. Stateless, no config needed.
    AutoJoiner,
    // Typography — smart quotes, em-dash, ellipsis, ©, etc. The
    // single highest-leverage visual change per line of code:
    // straight quotes become curly, `--` collapses to em-dash, `...`
    // to a horizontal ellipsis. Stateless, no config needed.
    Typography,
    // Per-block placeholder text. Empty headings/lists/callouts get
    // their own hint instead of the generic "Start typing, or press /
    // for blocks."
    Placeholder.configure({
      showOnlyCurrent: true,
      showOnlyWhenEditable: true,
      placeholder: ({ node }) => {
        switch (node.type.name) {
          case 'heading':
            return 'Heading';
          case 'bulletList':
          case 'orderedList':
            return 'List item';
          case 'blockquote':
            return 'Callout';
          case 'codeBlock':
            return 'Code';
          default:
            return 'Start typing, or press / for blocks.';
        }
      },
    }),
  ];
}
