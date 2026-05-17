/**
 * Block-chrome helpers — small lib used by `BlockChromeView.tsx` (the React
 * NodeView for every paperflow block) and `FloatingBlockChrome.tsx` (the
 * single floating chrome cluster).
 *
 * Two responsibilities:
 *
 *   1. `humanLabelFor`     pure: block-type → "Paragraph" / "Heading" / …
 *   2. `pdBlockTypeFor`    pure: tiptap node name → PortableDoc block type
 *                          (null for blocks without a variant catalog
 *                          entry).
 *
 * Drag wiring used to live here too. T3b retired the bespoke binder in
 * favour of `tiptap-extension-global-drag-handle` (what Novel uses) — the
 * extension renders the `⋮⋮` handle, owns dragstart slice serialization,
 * and lets PM's built-in drop machinery handle the reorder. Keyboard-
 * driven reorder still goes through `MoveBlock` (Cmd+Shift+ArrowUp/Down).
 */

// ---------------------------------------------------------------------------
// Block-type → human label (for `aria-label` strings + the toolbar label)
// ---------------------------------------------------------------------------

const HUMAN_LABEL: Record<string, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'List',
  orderedList: 'List',
  blockquote: 'Callout',
  codeBlock: 'Code',
  horizontalRule: 'Divider',
};

export function humanLabelFor(blockType: string): string {
  return HUMAN_LABEL[blockType] ?? 'Block';
}

// ---------------------------------------------------------------------------
// PortableDoc block-type mapping (for the variant-chip wire-up)
// ---------------------------------------------------------------------------

/** Map a TipTap node name to its PortableDoc block type (the name the
 *  variant catalog keys on). Returns `null` for nodes without variants
 *  (paragraph, heading, list, divider, image, table). */
export function pdBlockTypeFor(tiptapName: string): string | null {
  switch (tiptapName) {
    case 'blockquote':
      return 'callout';
    case 'codeBlock':
      return 'code';
    default:
      return null;
  }
}
