// SPDX-License-Identifier: Apache-2.0
/** One row of the alias table: an old name's current name ("owner.field"), why, and how its value converts. */
export interface ReadAlias {
  readonly to: string;
  readonly reason: string;
  readonly convert?: 'inline-from-string' | 'columns-from-cols' | 'head-from-header' | 'text-from-inline';
}
/** The second names a reader still accepts, keyed "owner.old": an owner is a block type, a block type and the path to its items ("steps.steps[]"), or an inline node type ("inline:text"), in the shape of the pack's spec/read-aliases.json, frozen. */
export function aliasTable(): { readonly _comment: string; readonly aliases: Readonly<Record<string, ReadAlias>> };
/** The JSON types name `name` of `owner` reads (alias-types.js, from the schema), or null when any type is allowed. */
export function typesOf(owner: string, name: string): readonly string[] | null;
/** Whether a name holding `value` counts as absent by blankness alone: undefined, null, a blank string, or an empty array. */
export function absent(value: unknown): boolean;
/** Whether name `name` of `owner` holding `value` counts as absent: blank, or not of a type it reads. */
export function absentAs(owner: string, name: string, value: unknown): boolean;
/** The names `field` of `owner` is read under: its own first, then its old names. */
export function namesOf(owner: string, field: string): readonly string[];
/** The current name an old name `key` of `owner` stands for, or undefined. */
export function currentName(owner: string, key: string): string | undefined;
/** The convert kind of an old name, or undefined for a plain rename. */
export function convertOf(owner: string, key: string): ReadAlias['convert'];
/** Field `field` of `block`: the first name not absent (blank or of a type the schema does not give it), its own then its old names; else its own stored value. */
export function readField(block: unknown, field: string): { name: string; value: unknown };
/** readField's value alone. */
export function fieldOf(block: unknown, field: string): unknown;
/** Field `field` of `item`, an object of `owner` ("steps.steps[]", "inline:text"), by readField's rule. */
export function readItem(item: unknown, owner: string, field: string): { name: string; value: unknown };
/** readItem's value alone. */
export function itemOf(item: unknown, owner: string, field: string): unknown;
