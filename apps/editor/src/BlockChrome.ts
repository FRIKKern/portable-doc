/**
 * Block-chrome pure helpers — used by the React NodeView
 * (`BlockChromeView.tsx`) to label blocks and map TipTap node names onto
 * PortableDoc block types for variant-chip wiring.
 *
 * The DOM construction and drag handling that used to live here have
 * moved: chrome DOM is built in `BlockChromeView.tsx`, and drag is now
 * canonical TipTap node-drag (schema `draggable: true` + `data-drag-handle`
 * on the `⋮⋮` button + StarterKit's dropcursor for the visual indicator).
 *
 * What remains:
 *
 *   - `humanLabelFor`    pure: block-type → "Paragraph" / "Heading" / …
 *   - `pdBlockTypeFor`   pure: tiptap node name → PortableDoc block type
 *                        (returns null for blocks without variants)
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
    // `action` and `section` aren't standalone TipTap nodes in v0.4 — the
    // catalog has schemas for them but the editor doesn't surface them
    // yet. Returning null here is correct.
    default:
      return null;
  }
}
