// Module augmentation for `@tiptap/react`'s `NodeViewContent`.
//
// WHY THIS FILE EXISTS:
//
// Upstream `@tiptap/react` declares `NodeViewContent` as:
//
//   function NodeViewContent<T extends keyof React.JSX.IntrinsicElements = 'div'>(
//     props: { as?: NoInfer<T> } & ComponentProps<T>
//   ): JSX.Element;
//
// The `NoInfer<T>` wrapper on the `as` prop is deliberate upstream — it
// prevents TS from inferring `T` from the `as` value, which keeps inference
// driven by an explicit type argument. The side effect is that a non-literal
// `as` value (e.g. our `ContentTag = 'p' | 'h1' | … | 'pre'` union, computed
// per block from `node.attrs.level`) cannot satisfy the generic by inference
// and produces a TS2322 error at the call site.
//
// Canonical use case: `BlockChromeView.tsx` computes `as` per block as a
// `keyof React.JSX.IntrinsicElements` union (`'p' | 'h1' | … | 'pre'`) and
// passes it straight to `<NodeViewContent as={tag} />`. Without this
// augmentation `NoInfer<T>` swallows the inference and the union widening
// produces TS2322. This augmentation adds a compile-time overload that
// drops `NoInfer<>` from the `as` prop so the union typechecks directly —
// no runtime cast, no `as unknown as ComponentType<…>` workaround. Runtime
// behavior is unchanged (TipTap still spreads `as` as the JSX tag); only
// the type surface is widened.
//
// Scope: minimal — only the overload needed to widen `as`. If TipTap's
// upstream signature changes, revisit `apps/editor/node_modules/@tiptap/react/dist/index.d.ts`
// and re-confirm the augmentation still composes.

import type * as React from 'react';

declare module '@tiptap/react' {
  function NodeViewContent<
    T extends keyof React.JSX.IntrinsicElements = 'div',
  >(props: {
    as?: T;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
  }): React.JSX.Element;
}
