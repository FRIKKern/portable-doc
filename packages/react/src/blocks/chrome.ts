import type { Block } from '../inline'

/**
 * The renderer's own words — chrome, never author content — in the caller's
 * language (task-8e96278fc4ee7097).
 *
 * Mirrors `Barkpark.PortableDoc.Render.Chrome`: the `strings` map is keyed by
 * the English text the renderer emits. A render builds ONE `RenderCtx` from it
 * and passes that ctx explicitly down every emitter — there is no module-level
 * state, so two renders running side by side on a server (RSC/SSR) can never
 * see each other's words. With no map, `ctx.t()` answers the English key, so a
 * render without `strings` is byte-identical to before. `%{name}` slots are
 * filled after lookup, as in Elixir.
 */
export type ChromeStrings = Record<string, string>

/** An opt-in replacement for one registered core block. `renderDefault`
 * returns the canonical renderer's HTML for the same block. The callback
 * returns trusted host HTML and therefore owns escaping its author data. */
export type CoreBlockRenderer = (
  block: Block,
  ctx: RenderCtx,
  renderDefault: () => string,
) => string

/** Extra data-* or aria-* attributes for a rendered block's root element.
 * Names are validated and values are escaped by the renderer. */
export type BlockAttributes = (
  block: Block,
) => Record<string, string | number | boolean | null | undefined> | undefined

/** Per-render context threaded through every emitter. */
export interface RenderCtx {
  /** The chrome word `english` in this render's language (English when absent). */
  t: (english: string, vars?: Record<string, string | number>) => string
  /** Opt-in block emitters for types the core registry does not ship (e.g.
   * `@portable-doc/react/field-blocks`), consulted after the core dispatch. */
  blocks?: Record<string, (block: never, ctx: RenderCtx) => string> | undefined
  /** Opt-in replacements for registered core types. Unlike `blocks`, this map
   * is consulted only when the core registry already owns the type. */
  blockOverrides?: Record<string, CoreBlockRenderer> | undefined
  /** Attributes appended to the first/root element emitted for each block. */
  blockAttributes?: BlockAttributes | undefined
}

/** Build the render context for `strings` (English when omitted or malformed). */
export function makeCtx(strings?: ChromeStrings | null): RenderCtx {
  const map = strings && typeof strings === 'object' ? strings : null
  return {
    t(english, vars) {
      const hit = map && typeof map[english] === 'string' ? map[english] : english
      if (!vars) return hit
      return Object.keys(vars).reduce((acc, k) => acc.split(`%{${k}}`).join(String(vars[k])), hit)
    },
  }
}

/** The English context: what a render without `strings` uses. */
export const EN: RenderCtx = makeCtx()
