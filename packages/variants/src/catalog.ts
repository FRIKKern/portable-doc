/**
 * VARIANT_CATALOG — closed, named-variant schemas per block type.
 *
 * 21 named variants across 4 block types:
 *   callout: tone × emphasis = 5 × 2 = 10
 *   action:  priority × size = 2 × 2 = 4
 *   section: density          = 3
 *   code:    theme × density  = 2 × 2 = 4
 *
 * Block types without an entry (heading, paragraph, list, divider, image,
 * table) map to `undefined` — `resolveVariant` throws `UnknownBlockTypeError`
 * for those. All hex values come from `defaultTokens` / `tonePalette` —
 * the single source of truth lives in @portable-doc/core.
 */
import type { BlockType } from '@portable-doc/core';
import { defaultTokens, toneNames } from '@portable-doc/core';
import type { PdStyle } from '@portable-doc/primitives';
import type { VariantSchema } from './schema.js';

/* ------------------------------------------------------------------ callout */

const CALLOUT_EMPHASIS = ['subtle', 'bold'] as const;

const calloutSchema: VariantSchema = {
  axes: {
    tone: toneNames,
    emphasis: CALLOUT_EMPHASIS,
  },
  resolve: ({ tone, emphasis }): PdStyle => {
    const palette = defaultTokens.color.tone[tone as keyof typeof defaultTokens.color.tone];
    return {
      borderWidth: emphasis === 'bold' ? 4 : 3,
      borderColor: palette.fg,
      backgroundColor: palette.bg,
      padding: 16,
    };
  },
};

/* ------------------------------------------------------------------- action */

const ACTION_PRIORITY = ['primary', 'secondary'] as const;
const ACTION_SIZE = ['medium', 'large'] as const;

const actionSchema: VariantSchema = {
  axes: {
    priority: ACTION_PRIORITY,
    size: ACTION_SIZE,
  },
  resolve: ({ priority, size }): PdStyle => {
    const brand = defaultTokens.color.brand;
    if (priority === 'primary') {
      return {
        backgroundColor: brand,
        padding: size === 'large' ? 16 : 12,
      };
    }
    // secondary
    return {
      borderWidth: 2,
      borderColor: brand,
      padding: size === 'large' ? 14 : 10,
    };
  },
};

/* ------------------------------------------------------------------ section */

const SECTION_DENSITY = ['compact', 'comfortable', 'spacious'] as const;

const sectionSchema: VariantSchema = {
  axes: {
    density: SECTION_DENSITY,
  },
  resolve: ({ density }): PdStyle => {
    switch (density) {
      case 'compact':
        return { padding: 8, margin: 8 };
      case 'spacious':
        return { padding: 24, margin: 24 };
      case 'comfortable':
      default:
        return { padding: 16, margin: 16 };
    }
  },
};

/* --------------------------------------------------------------------- code */

const CODE_THEME = ['light', 'dark'] as const;
const CODE_DENSITY = ['normal', 'compact'] as const;

/** Dark-theme code background. Per the May 10 variant-catalog research note,
 *  per-block theme is the v0.2 commitment; a global theme context is deferred
 *  to v0.3. The dark hex is local to this catalog by design. */
const CODE_DARK_BG = '#111827';

const codeSchema: VariantSchema = {
  axes: {
    theme: CODE_THEME,
    density: CODE_DENSITY,
  },
  resolve: ({ theme, density }): PdStyle => {
    return {
      backgroundColor: theme === 'dark' ? CODE_DARK_BG : defaultTokens.color.codeBg,
      padding: density === 'compact' ? 8 : 16,
    };
  },
};

/* ---------------------------------------------------------------- catalog */

export const VARIANT_CATALOG: Record<BlockType, VariantSchema | undefined> = {
  callout: calloutSchema,
  action: actionSchema,
  section: sectionSchema,
  code: codeSchema,
  heading: undefined,
  paragraph: undefined,
  list: undefined,
  divider: undefined,
  image: undefined,
  table: undefined,
};
