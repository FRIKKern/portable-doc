/**
 * v0.4 Paper — animation timing constants.
 *
 * Imported by every build task that animates chrome reveal, modal open,
 * slash menu, BubbleMenu, drop indicator, or variant chip expand.
 *
 * Honors prefers-reduced-motion: every duration collapses to 0 when set.
 * The motion.duration() helper performs the runtime check; CSS rules use
 * @media (prefers-reduced-motion: reduce) { ... } instead.
 *
 * Values match the prototype at
 * /Users/frikkjarl/docs/paperflow/notes/2026-05-10-paper-vision-prototype.html
 */

export const motion = {
  // Chrome reveal/hide on block hover or focus
  chromeFadeIn: 150,
  chromeFadeOut: 300,

  // Slash menu and inline format BubbleMenu
  slashMenuOpen: 120,
  bubbleMenuOpen: 80,

  // Drag-and-drop drop indicator
  dropIndicator: 100,

  // Variant chip expand-to-palette
  variantChipExpand: 150,

  // Outline rail slide-in (Cmd+\)
  outlineSlide: 200,

  // Preview overlay (Cmd+P)
  previewOverlayOpen: 180,
  previewOverlayClose: 140,

  // Footer status sheet (mobile)
  footerSheetSlide: 220,

  // Easing — single curve across the editor for visual coherence
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)' as const, // ease-out-quint
} as const;

export type MotionKey = keyof typeof motion;

/**
 * Returns the duration in ms, honoring prefers-reduced-motion at runtime.
 * For CSS rules, use a @media block instead — this helper is for JS-driven
 * animations (e.g. setTimeout dismissal of toast / sheet states).
 */
export function duration(key: Exclude<MotionKey, 'easing'>): number {
  if (typeof window === 'undefined') return motion[key] as number;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 0 : (motion[key] as number);
}
