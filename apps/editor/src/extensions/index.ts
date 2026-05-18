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
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { mergeAttributes } from '@tiptap/core';
// TrailingNode is shipped INSIDE @tiptap/starter-kit (re-exported
// from @tiptap/extensions). Don't add a second one — duplicate
// extension names cause PM plugin chaos including selection
// corruption. The StarterKit-shipped one is the canonical impl.
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import { CharacterCount } from '@tiptap/extension-character-count';
// ListKeymap is auto-injected by StarterKit (unless you pass
// listKeymap: false). Adding it here a second time produced a
// duplicate plugin and broke vertical arrow-key caret movement —
// same class of bug as the earlier TrailingNode duplicate.
import { TextAlign } from '@tiptap/extension-text-align';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { withBlockChrome } from './withBlockChrome.js';
import { SlashCommand } from './SlashCommand.js';
import { MoveBlock } from './MoveBlock.js';
import { LinkOpen } from './LinkOpen.js';

export interface BuildExtensionsOpts {
  /** Late-bound getter for the host's image-insert handler.
   *  Returns the current handler (or undefined when omitted). The
   *  indirection lets host-component re-renders refresh the handler
   *  without invalidating the extension array. */
  getOnImageRequest: () => ((editor: TipTapEditor) => void) | undefined;
}

/** ASCII-slugify a heading's text for the `id` attribute. Trims,
 *  lowercases, drops non-alphanum, collapses whitespace+dashes,
 *  caps at 64 chars. Pure function so unit tests can lock it down. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/** Single lowlight instance — registers the ~37 languages in
 *  `lowlight/lib/common` (JS/TS/Python/Go/Rust/Java/C/C++/Bash/SQL/
 *  HTML/CSS/Markdown/JSON/YAML/…). Plenty for technical writing. */
const lowlight = createLowlight(common);

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
    // Auto-generate anchor `id` attrs from heading text so deep
    // links work (e.g. /docs#setup-complete scrolls to the matching
    // <h2 id="setup-complete">). GitHub / Notion / most docs do
    // this. `node.textContent` is the live text of the heading at
    // render time; slugifyHeading lowercases + drops non-alphanum +
    // collapses whitespace. Empty headings get no id (the empty
    // string slug would collide between blocks).
    withBlockChrome(
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }).extend({
        renderHTML({ node, HTMLAttributes }) {
          const levels = (this.options as { levels: number[] }).levels;
          const level = levels.includes(node.attrs.level)
            ? (node.attrs.level as number)
            : levels[0]!;
          const id = slugifyHeading(node.textContent);
          return [
            `h${level}`,
            mergeAttributes(
              (this.options as { HTMLAttributes: Record<string, string> })
                .HTMLAttributes,
              HTMLAttributes,
              id ? { id } : {},
            ),
            0,
          ];
        },
        addKeyboardShortcuts() {
          // Stock TipTap binds Mod-Alt-1..6. Google Docs, Pages, and
          // Word use Mod-Shift-1..6 (Cmd+Shift on macOS / Ctrl+Shift
          // on Windows). Keep BOTH so neither cohort of writers
          // re-learns; merge with the parent map so the existing
          // Mod-Alt bindings stay live.
          const parent =
            (this.parent?.() as Record<string, () => boolean>) ?? {};
          const docsStyle: Record<string, () => boolean> = {};
          const levels = (this.options as { levels: number[] }).levels;
          for (const level of levels) {
            docsStyle[`Mod-Shift-${level}`] = () =>
              this.editor.commands.toggleHeading({ level: level as 1 });
          }
          return { ...parent, ...docsStyle };
        },
      }),
    ),
    withBlockChrome(BulletList),
    withBlockChrome(OrderedList),
    withBlockChrome(Blockquote),
    // CodeBlockLowlight swaps the plain CodeBlock for one that
    // tokenises the source via `lowlight` (highlight.js without the
    // file-size cost). The plugin emits inline `.hljs-keyword`,
    // `.hljs-string`, `.hljs-comment`, etc. spans inside the
    // `<code>` element; paper.css owns the colour palette.
    withBlockChrome(CodeBlockLowlight.configure({ lowlight })),
    withBlockChrome(HorizontalRule),
    // Table needs all four nodes registered together — Table contains
    // TableRow, which contains TableCell/TableHeader. `resizable: true`
    // turns on prosemirror-tables' canonical column-resize handles —
    // a thin grab strip on each column's right edge that the writer
    // drags to set width. No paperflow chrome involved.
    Table.configure({ resizable: true }),
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
    // Auto-joins adjacent lists after a drag-reorder so dragging a
    // list item out of List A and adjacent to List B merges them.
    // Stateless, no config needed. (Drag itself comes from the
    // ⋮⋮ button inside FloatingBlockChrome — the external
    // tiptap-extension-global-drag-handle was dropped in favor of
    // one unified floating toolbar.)
    AutoJoiner,
    // Typography — smart quotes, em-dash, ellipsis, ©, etc. The
    // single highest-leverage visual change per line of code:
    // straight quotes become curly, `--` collapses to em-dash, `...`
    // to a horizontal ellipsis. Stateless, no config needed.
    Typography,
    // Canonical incremental character + word counter. Replaces the
    // hand-rolled `countWords(doc)` walk that FooterStatus used to
    // do — TipTap tracks the count on the editor instance and we
    // read it via `editor.storage.characterCount.words()`. Default
    // `textCounter` whitespace-splits the doc text, which matches
    // the previous behavior.
    CharacterCount,
    // (ListKeymap is shipped INSIDE StarterKit's auto-injection;
    //  adding it here a second time was a duplicate plugin and
    //  broke arrow-key caret movement. Removed.)
    // TextAlign — paragraph + heading alignment with the Word / Docs
    // / Pages keyboard shortcuts: Mod-Shift-L (left), Mod-Shift-E
    // (center, the Word convention), Mod-Shift-R (right),
    // Mod-Shift-J (justify). Default alignment isn't written to the
    // attribute, so docs that never use alignment round-trip without
    // any extra attrs in the JSON.
    TextAlign.configure({
      types: ['paragraph', 'heading'],
      defaultAlignment: 'left',
    }),
    // Cmd+K opens the link UI in the floating chrome. The extension
    // is just a keymap → editor.storage flag the bubble watches; no
    // command logic, no schema work.
    LinkOpen,
    // (TrailingNode — the always-empty trailing paragraph at the doc
    // end — is shipped by StarterKit. Adding it here a second time
    // was a duplicate plugin and corrupted text selection. Removed.)
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
