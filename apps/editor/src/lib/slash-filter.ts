/**
 * Slash-command catalog + filter — backs the SlashPopover.
 *
 * Per A3 / build-phase grill q3: substring match first (case-insensitive),
 * Levenshtein distance ≤ 2 fallback for typo tolerance. No fuse.js.
 */
import type { BlockType } from '@portable-doc/core';
import { levenshtein } from './levenshtein.js';

export interface SlashCommand {
  type: BlockType;
  label: string;
  hint: string;
  /** Heading level (1..6) — only meaningful when `type === 'heading'`. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export const COMMANDS: readonly SlashCommand[] = [
  // Headings: one slash entry per level so the writer can type
  // `/h1`..`/h6` to land directly at the right size.
  { type: 'heading', label: 'Heading 1', hint: 'h1 — section title', level: 1 },
  { type: 'heading', label: 'Heading 2', hint: 'h2 — subsection', level: 2 },
  { type: 'heading', label: 'Heading 3', hint: 'h3', level: 3 },
  { type: 'heading', label: 'Heading 4', hint: 'h4', level: 4 },
  { type: 'heading', label: 'Heading 5', hint: 'h5', level: 5 },
  { type: 'heading', label: 'Heading 6', hint: 'h6', level: 6 },
  { type: 'paragraph', label: 'Paragraph', hint: 'rich text' },
  { type: 'list', label: 'List', hint: 'bullet items' },
  { type: 'callout', label: 'Callout', hint: 'warn or info card' },
  { type: 'action', label: 'Action', hint: 'CTA button' },
  { type: 'section', label: 'Section', hint: 'group of blocks' },
  { type: 'divider', label: 'Divider', hint: 'horizontal rule' },
  { type: 'code', label: 'Code', hint: 'syntax-highlighted block' },
  { type: 'image', label: 'Image', hint: 'web/native only' },
  { type: 'table', label: 'Table', hint: 'web/native only' },
];

export function filterCommands(query: string): readonly SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return COMMANDS;
  // Substring match against type, label, AND hint — the hint carries
  // useful aliases (e.g. heading entries hint "h1", "h2", … so a `/h1`
  // query lands on Heading 1 even though the label is "Heading 1" with
  // a space that wouldn't match the literal "h1" substring).
  const subs = COMMANDS.filter(
    (c) =>
      c.type.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  );
  if (subs.length > 0) return subs;
  // Levenshtein fallback (distance ≤ 2 against type or label).
  return COMMANDS.filter(
    (c) =>
      levenshtein(q, c.type.toLowerCase()) <= 2 ||
      levenshtein(q, c.label.toLowerCase()) <= 2,
  );
}
