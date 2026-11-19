// SPDX-License-Identifier: Apache-2.0
/** One row of the alias table: an old name's current name ("owner.field"), why, and how its value converts. */
export interface ReadAlias {
  readonly to: string;
  readonly reason: string;
  readonly convert?: 'inline-from-string' | 'columns-from-cols' | 'head-from-header' | 'text-from-inline';
  /** The row's whitespace-is-content column: 'content' (yes) or 'blank' (no). */
  readonly whitespace: 'content' | 'blank';
}
/** The second names a reader still accepts, keyed "owner.old": an owner is a block type, a block type and the path to its items ("steps.steps[]"), or an inline node type ("inline:text"), in the shape of the pack's spec/read-aliases.json, frozen. */
export function aliasTable(): { readonly _comment: string; readonly aliases: Readonly<Record<string, ReadAlias>> };
/** The JSON types name `name` of `owner` reads (alias-types.js, from the schema), or null when any type is allowed. */
export function typesOf(owner: string, name: string): readonly string[] | null;
/** What a value holds: 2, a non-whitespace character; 1, only whitespace; 0, no character. A string holds the characters it has; a non-empty array or a number holds a non-whitespace character. */
export function holds(value: unknown): 0 | 1 | 2;
/** Whether whitespace is content in field `field` of `owner` (the table's whitespace column). */
export function whitespaceIsContent(owner: string, field: string): boolean;
/** The names `field` of `owner` is read under: its own first, then its old names. */
export function namesOf(owner: string, field: string): readonly string[];
/** The current name an old name `key` of `owner` stands for, or undefined. */
export function currentName(owner: string, key: string): string | undefined;
/** The convert kind of an old name, or undefined for a plain rename. */
export function convertOf(owner: string, key: string): ReadAlias['convert'];
/** Field `field` of `block`, by the rule in the table's _comment: { name, value }, `name` the name it was read under. */
export function readField(block: unknown, field: string): { name: string; value: unknown };
/** readField's value alone. */
export function fieldOf(block: unknown, field: string): unknown;
/** Field `field` of `item`, an object of `owner` ("steps.steps[]", "inline:text"), by readField's rule. */
export function readItem(item: unknown, owner: string, field: string): { name: string; value: unknown };
/** readItem's value alone. */
export function itemOf(item: unknown, owner: string, field: string): unknown;
