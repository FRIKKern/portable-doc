// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Barkpark contributors
//
// The block dispatcher — one entry per registered type, assembled from the
// per-family emitter maps. `renderBlock` is the JS twin of compose_block/2 +
// walk at style=:article: it routes a type-keyed block to its emitter, degrading
// an unknown/malformed block to the same visible `bp-unknown-block` placeholder
// the Elixir renderer emits (never throwing). Container blocks (section, columns,
// terminal, card, figure) recurse back through here.

import type { RenderCtx } from './chrome'
import { type Block, escapeAttr, escapeHtml, str, isMap } from '../inline'
import { coreEmitters } from './core'
import { datavizEmitters } from './dataviz'
import { formsEmitters } from './forms'
import { chatEmitters } from './chat'
import { tableEmitters } from './table'
import { sheetEmitters } from './sheet'
import { taskboardEmitters } from './taskboard'
import { mathEmitters } from './math'

type Emit = (block: Block, ctx: RenderCtx) => string

function ownRenderer<T>(registry: Record<string, T> | undefined, type: string): T | undefined {
  return registry && Object.hasOwn(registry, type) ? registry[type] : undefined
}

const HOST_ATTRIBUTE_NAME = /^(?:data|aria)-[a-z][a-z0-9_.:-]*$/

function rootHasAttribute(html: string, name: string): boolean {
  const end = html.indexOf('>')
  if (end === -1) return true
  const opening = html.slice(0, end + 1).toLowerCase()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\s${escaped}(?:\\s*=|\\s|/?>)`).test(opening)
}

function withBlockAttributes(html: string, block: Block, ctx: RenderCtx): string {
  if (html === '' || !ctx.blockAttributes) return html
  let attributes: ReturnType<NonNullable<RenderCtx['blockAttributes']>>
  try {
    attributes = ctx.blockAttributes(block)
  } catch {
    return html
  }
  if (!attributes || typeof attributes !== 'object') return html
  const suffix = Object.entries(attributes)
    .filter(
      ([name, value]) =>
        HOST_ATTRIBUTE_NAME.test(name) &&
        value !== false &&
        value != null &&
        !rootHasAttribute(html, name),
    )
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`))
    .join('')
  if (suffix === '') return html
  return html.replace(
    /^<([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/,
    (_match, tag: string) => `<${tag}${suffix}`,
  )
}

function renderCore(block: Block, ctx: RenderCtx, emit: Emit): string {
  const override = ownRenderer(ctx.blockOverrides, str(block.type))
  if (!override) return emit(block, ctx)
  let defaultHtml: string | undefined
  const renderDefault = () => (defaultHtml ??= emit(block, ctx))
  try {
    const html: unknown = override(block, ctx, renderDefault)
    return typeof html === 'string' ? html : renderDefault()
  } catch {
    return renderDefault()
  }
}

const DISPATCH: Record<string, Emit> = {
  ...coreEmitters,
  ...datavizEmitters,
  ...formsEmitters,
  ...chatEmitters,
  ...tableEmitters,
  ...sheetEmitters,
  ...taskboardEmitters,
  ...mathEmitters,
}

/** The full set of registered block types this renderer handles — every key in
 * the emitter maps above, including canonical types AND authoring-drift aliases
 * (bulletList / bullet_list / bulleted-list / bulleted_list / numbered_list /
 * quote / h1 / h2 / h3 / ordered-list). Do NOT trust a hand-counted literal
 * here — `Object.keys(DISPATCH)` IS the count (the PortableDoc suite pins the
 * exact number and asserts CASES ≡ this set). Used by the self-proof harness. */
export const REGISTERED_TYPES: string[] = Object.keys(DISPATCH)

/** Render one type-keyed block to an HTML string (article surface). */
export function renderBlock(block: Block, ctx: RenderCtx): string {
  if (!isMap(block)) return `<div class="bp-unknown-block">invalid block</div>`
  const type = str(block.type)
  // An opt-in emitter (ctx.blocks, e.g. @portable-doc/react/field-blocks) adds a
  // type the core does not ship; it never replaces a core one.
  const core = ownRenderer(DISPATCH, type)
  const emit = core || (ownRenderer(ctx.blocks, type) as Emit | undefined)
  if (emit) {
    const html = core ? renderCore(block, ctx, core) : emit(block, ctx)
    return withBlockAttributes(html, block, ctx)
  }
  // Unknown/unregistered type → degrade, never throw (compose.ex unknown_block_node/1).
  return withBlockAttributes(
    `<div class="bp-unknown-block">Unsupported block: ${escapeHtml(type)}</div>`,
    block,
    ctx,
  )
}

/** Render a block array to a joined HTML string. */
export function renderBlocks(blocks: unknown, ctx: RenderCtx): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map((b) => renderBlock(b as Block, ctx)).join('')
}
