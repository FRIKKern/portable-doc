/**
 * Ambient module declarations for pdfmake's browser entrypoints.
 *
 * The shipped package doesn't include `.d.ts` files for the build outputs we
 * import (only JSDoc on the source). We don't bind to the package's
 * published types because they're not actually published; instead we
 * declare a loose `any`-shaped surface and let `toPdf.ts` cast through
 * its own `unknown` shape when calling `createPdf`. This is intentional
 * scope — typing pdfmake's full content-tree DSL would balloon to ~500
 * LOC of d.ts for no runtime benefit (pdfmake validates at runtime).
 */
declare module 'pdfmake/build/pdfmake.js' {
  const pdfMake: unknown;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts.js' {
  const vfs: unknown;
  export default vfs;
}
