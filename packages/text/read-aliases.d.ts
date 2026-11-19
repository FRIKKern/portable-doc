// SPDX-License-Identifier: Apache-2.0
/** One row of the alias table: an old name's current name ("type.field"), why, and how its value converts. */
export interface ReadAlias {
  readonly to: string;
  readonly reason: string;
  readonly convert?: 'inline-from-string' | 'columns-from-cols' | 'head-from-header';
}
/** The second names a reader still accepts, keyed "type.old", in the shape of the pack's spec/read-aliases.json, frozen. */
export function aliasTable(): { readonly _comment: string; readonly aliases: Readonly<Record<string, ReadAlias>> };
/** The JSON types the schema gives name `name` on a block of `type`, or null when any type is allowed. */
export function typesOf(type: string, name: string): readonly string[] | null;
/** Whether a name holding `value` counts as absent by blankness alone: undefined, null, a blank string, or an empty array. */
export function absent(value: unknown): boolean;
/** Whether name `name` of a block of `type` holding `value` counts as absent: blank, or not of a type the schema gives it. */
export function absentAs(type: string, name: string, value: unknown): boolean;
/** The names `field` of a block of `type` is read under: its own first, then its old names. */
export function namesOf(type: string, field: string): readonly string[];
/** The current name an old name `key` stands for on a block of `type`, or undefined. */
export function currentName(type: string, key: string): string | undefined;
/** The convert kind of an old name, or undefined for a plain rename. */
export function convertOf(type: string, key: string): ReadAlias['convert'];
/** Field `field` of `block`: the first name not absent (blank or of a type the schema does not give it), its own then its old names; else its own stored value. */
export function readField(block: unknown, field: string): { name: string; value: unknown };
/** readField's value alone. */
export function fieldOf(block: unknown, field: string): unknown;
