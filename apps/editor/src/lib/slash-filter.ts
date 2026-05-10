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
}

export const COMMANDS: readonly SlashCommand[] = [
  { type: 'heading', label: 'Heading', hint: 'headline & subhead' },
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
  // Substring match first.
  const subs = COMMANDS.filter(
    (c) => c.type.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
  );
  if (subs.length > 0) return subs;
  // Levenshtein fallback (distance ≤ 2 against type or label).
  return COMMANDS.filter(
    (c) =>
      levenshtein(q, c.type.toLowerCase()) <= 2 ||
      levenshtein(q, c.label.toLowerCase()) <= 2,
  );
}
