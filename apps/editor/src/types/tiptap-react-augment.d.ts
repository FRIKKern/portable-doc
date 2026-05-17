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
// Previously `BlockChromeView.tsx` worked around this with:
//
//   const TagContent = NodeViewContent as unknown as ComponentType<{
//     as?: keyof React.JSX.IntrinsicElements;
//     className?: string;
//     style?: React.CSSProperties;
//   }>;
//
// — a runtime `as unknown as` cast purely to satisfy the compiler. This
// augmentation replaces that cast with a compile-time overload that widens
// the `as` prop so a `keyof React.JSX.IntrinsicElements` union typechecks
// directly. Runtime behavior is unchanged (TipTap still spreads `as` as the
// JSX tag); only the type surface is widened.
//
// Scope: minimal — only the overload needed to remove the cast. If TipTap's
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
