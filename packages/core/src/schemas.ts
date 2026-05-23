/**
 * Zod schemas mirroring `ast.ts`.
 *
 * The validator runs `portableDocSchema.safeParse(doc)` first to catch shape
 * errors (missing fields, wrong types, unknown blocks). Walker-based content
 * + URL rules run afterward in `validate.ts`.
 */

import { z } from 'zod';

const surfaceSchema = z.enum(['web', 'native', 'email', 'tui', 'text']);
const toneSchema = z.enum(['success', 'warning', 'danger', 'info', 'neutral']);

export const inlineNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), value: z.string() }).strict(),
    z.object({ type: z.literal('strong'), children: z.array(inlineNodeSchema) }).strict(),
    z.object({ type: z.literal('em'), children: z.array(inlineNodeSchema) }).strict(),
    z.object({ type: z.literal('code'), value: z.string() }).strict(),
    z
      .object({
        type: z.literal('link'),
        href: z.string(),
        children: z.array(inlineNodeSchema),
      })
      .strict(),
  ]),
);

const blockBase = {
  id: z.string(),
  surfaces: z.array(surfaceSchema).optional(),
  variant: z.record(z.string()).optional(),
};

const headingSchema = z
  .object({
    ...blockBase,
    type: z.literal('heading'),
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    text: z.string(),
  })
  .passthrough();

const paragraphSchema = z
  .object({
    ...blockBase,
    type: z.literal('paragraph'),
    content: z.array(inlineNodeSchema),
  })
  .passthrough();

const listSchema = z
  .object({
    ...blockBase,
    type: z.literal('list'),
    ordered: z.boolean().optional(),
    items: z.array(z.array(inlineNodeSchema)),
  })
  .passthrough();

const calloutSchema = z
  .object({
    ...blockBase,
    type: z.literal('callout'),
    tone: toneSchema,
    title: z.string().optional(),
    content: z.array(inlineNodeSchema),
  })
  .passthrough();

const actionSchema = z
  .object({
    ...blockBase,
    type: z.literal('action'),
    label: z.string(),
    href: z.string(),
    priority: z.enum(['primary', 'secondary']),
  })
  .passthrough();

const dividerSchema = z
  .object({
    ...blockBase,
    type: z.literal('divider'),
  })
  .passthrough();

const codeSchema = z
  .object({
    ...blockBase,
    type: z.literal('code'),
    lang: z.string().optional(),
    value: z.string(),
  })
  .passthrough();

// image/table use a relaxed `surfaces` field at the schema level so the
// content-constraint walker (not zod) emits the locked-tuple violation;
// the strict tuple lives on the AST type. `passthrough` lets injected
// style props survive into the prop-allowlist walker.
const imageSchema = z
  .object({
    ...blockBase,
    surfaces: z.array(surfaceSchema).optional(),
    type: z.literal('image'),
    src: z.string(),
    alt: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

const tableSchema = z
  .object({
    ...blockBase,
    surfaces: z.array(surfaceSchema).optional(),
    type: z.literal('table'),
    rows: z.array(z.array(z.array(inlineNodeSchema))),
  })
  .passthrough();

// `section.blocks` recurses into `blockSchema`. `blockSchema` is the only lazy
// schema here — `sectionSchema` is a plain ZodObject so the discriminatedUnion
// can read its `.shape.type`. The cycle is broken by `z.array(blockSchema)`
// resolving lazily at parse time.
const sectionSchema = z
  .object({
    ...blockBase,
    type: z.literal('section'),
    title: z.string().optional(),
    blocks: z.array(z.lazy(() => blockSchema)),
  })
  .passthrough();

export const blockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    headingSchema,
    paragraphSchema,
    listSchema,
    calloutSchema,
    actionSchema,
    sectionSchema,
    dividerSchema,
    codeSchema,
    imageSchema,
    tableSchema,
  ]),
);

// ---------------------------------------------------------------------------
// Draft-mode block schema
// ---------------------------------------------------------------------------

/**
 * Draft variant of `blockSchema`: every member is `.partial()` so missing
 * required content fields (heading.text, action.label/href/priority,
 * callout.tone, code.value, image.src/alt, paragraph.content, …) no longer
 * fail the parse — but the discriminant `type` literal is re-required on each
 * member so the discriminatedUnion can still resolve which block it is. Used
 * by `validateDoc(doc, {mode:'draft'})` for the **last** top-level block only;
 * its parse issues are downgraded to `severity:'warning'`. Earlier blocks
 * still parse against the strict `blockSchema`.
 *
 * The four per-block walkers (prop-allowlist, content-constraint, url-safety,
 * variant-allowlist) run regardless of mode, so allowlist / url-safety /
 * content / variant violations stay HARD even on the draft block.
 */
// `.partial()` loosens every field; re-asserting `type` keeps the literal
// required so `z.discriminatedUnion('type', …)` still has a discriminant.
const draftHeadingSchema = headingSchema.partial().extend({ type: z.literal('heading') });
const draftParagraphSchema = paragraphSchema.partial().extend({ type: z.literal('paragraph') });
const draftListSchema = listSchema.partial().extend({ type: z.literal('list') });
const draftCalloutSchema = calloutSchema.partial().extend({ type: z.literal('callout') });
const draftActionSchema = actionSchema.partial().extend({ type: z.literal('action') });
const draftSectionSchema = sectionSchema.partial().extend({ type: z.literal('section') });
const draftDividerSchema = dividerSchema.partial().extend({ type: z.literal('divider') });
const draftCodeSchema = codeSchema.partial().extend({ type: z.literal('code') });
const draftImageSchema = imageSchema.partial().extend({ type: z.literal('image') });
const draftTableSchema = tableSchema.partial().extend({ type: z.literal('table') });

export const draftBlockSchema: z.ZodType<unknown> = z.discriminatedUnion('type', [
  draftHeadingSchema,
  draftParagraphSchema,
  draftListSchema,
  draftCalloutSchema,
  draftActionSchema,
  draftSectionSchema,
  draftDividerSchema,
  draftCodeSchema,
  draftImageSchema,
  draftTableSchema,
]);

export const portableDocSchema = z
  .object({
    version: z.literal(1),
    title: z.string().optional(),
    preview: z.string().optional(),
    blocks: z.array(blockSchema),
  })
  .strict();
