// SPDX-License-Identifier: Apache-2.0
// The writer registry. Every function a package exports that turns a document into Markdown, text
// or HTML is a writer here, and the word test (packages/text/writers-keep-words.test.mjs) runs each
// one over every shared case in fixtures/. scripts/writer-registry.test.mjs fails when a package
// exports a function that is neither a writer here nor named in NOT_A_WRITER, so a new writer
// cannot go unseen by the word test. So does a method returning a string on an element a package
// declares in its type declarations (`HTMLElementTagNameMap`), keyed `<package> <tag>.method`: a
// writer names the one it runs as `method`. A writer exported as a property of an exported object
// is not seen: fieldBlocks is the one known, and the field-and-embed HTML writer below covers it.
import { renderPortableDocument } from '@portable-doc/react';
import { embedBlocks } from '@portable-doc/react/embed';
import { fieldBlocks } from '@portable-doc/react/field-blocks';
import { blocksToExportMarkdown, blocksToMarkdown, markdownToBlocks } from '../../packages/editor/src/markdown.js';
import { fromMarkdown, toMarkdown, toPlainText } from '../../packages/text/index.js';

/**
 * Each writer: its name, the package and export it runs (and the element method that runs it, if
 * one does), and write(blocks), which gives
 * `{ output, lost?, readBack? }`. `output` is the string written, of the kind `writes` names.
 * `lost` lists the paths the writer says it did not write. `readBack` is the blocks the output
 * reads back as, where the writer carries blocks it cannot say as data inside its Markdown.
 */
export const WRITERS = [
  { name: 'readable Markdown', package: '@portable-doc/text', export: 'toMarkdown', writes: 'markdown', write: (blocks) => ({ output: toMarkdown(blocks) }) },
  { name: 'plain text', package: '@portable-doc/text', export: 'toPlainText', writes: 'text', write: (blocks) => ({ output: toPlainText(blocks) }) },
  {
    name: 'round-trip Markdown',
    package: '@portable-doc/text',
    export: 'toMarkdown',
    writes: 'markdown',
    // A portabledoc fence holds its blocks as JSON: what it writes is what reads back.
    write: (blocks) => {
      const { markdown, lost } = toMarkdown(blocks, { mode: 'round-trip' });
      return { output: markdown, lost: lost.map((l) => l.path), readBack: fromMarkdown(markdown) };
    },
  },
  { name: 'HTML', package: '@portable-doc/react', export: 'renderPortableDocument', writes: 'html', write: (blocks) => ({ output: renderPortableDocument(blocks) }) },
  {
    // What the CLI's render and preview write: the HTML with the field and embed block writers.
    name: 'HTML with field and embed blocks',
    package: '@portable-doc/react',
    export: 'renderPortableDocument',
    writes: 'html',
    write: (blocks) => ({ output: renderPortableDocument(blocks, { blocks: { ...fieldBlocks, ...embedBlocks() } }) }),
  },
  // The editor's Markdown for a file a person takes away: the canvas element's toMarkdown(),
  // which runs blocksToExportMarkdown.
  {
    name: 'editor export',
    package: '@portable-doc/editor',
    export: 'blocksToExportMarkdown',
    method: '<bp-paper-canvas>.toMarkdown',
    writes: 'markdown',
    write: (blocks) => ({ output: blocksToExportMarkdown(blocks) }),
  },
  {
    // The editor's source mode: Markdown that reads back as the same blocks, with what Markdown
    // cannot say carried as a block's JSON in an HTML comment.
    name: 'editor source',
    package: '@portable-doc/editor',
    export: 'blocksToMarkdown',
    writes: 'markdown',
    write: (blocks) => {
      const markdown = blocksToMarkdown(blocks);
      return { output: markdown, readBack: markdownToBlocks(markdown) };
    },
  },
];

/**
 * Exported functions, and declared element methods returning a string, that are not writers of a
 * document, each with why. Keyed `<package> <export>` or `<package> <tag>.method`.
 */
export const NOT_A_WRITER = {
  '@portable-doc/cli main': 'runs the CLI; its render and preview call the writers above',
  '@portable-doc/cli mainUsage': "writes the CLI's usage text",
  '@portable-doc/code escapeHtml': 'escapes a string for HTML, not a document',
  '@portable-doc/code highlightHtml': "writes one code block's source as highlighted HTML, not a document",
  '@portable-doc/code highlightPre': 'paints highlighting into a page element in place',
  '@portable-doc/code languages': 'lists the highlighted languages',
  '@portable-doc/code resolveLang': "resolves a code block's language name",
  '@portable-doc/code tokenSignature': "compares two highlightings' tokens",
  '@portable-doc/code wireAllTabs': "wires a page's tab strips",
  '@portable-doc/code wireTabs': 'wires one tab strip',
  '@portable-doc/editor changedSentinel': "says which block's source-mode sentinel an edit changed, as a block index",
  '@portable-doc/editor configControlHidden': "says whether an editor control shows",
  '@portable-doc/editor firstLoss': 'names the first place two block lists part, or null',
  '@portable-doc/editor sourceLoss': 'names the first place source mode would lose of a Paper, or null',
  '@portable-doc/editor markdownToBlockSpans': 'reads Markdown into blocks',
  '@portable-doc/editor markdownToBlocks': 'reads Markdown into blocks',
  '@portable-doc/mcp applyOp': 'applies an edit to a document',
  '@portable-doc/mcp applyOps': 'applies edits to a document',
  '@portable-doc/mcp configFromEnv': "reads the server's settings",
  '@portable-doc/mcp createServer': 'starts the MCP server; its render tool calls the writers above',
  '@portable-doc/react PortableDoc': "a React element whose inner HTML is renderPortableDocument's",
  '@portable-doc/react embedBlocks': 'gives the embed block writers that renderPortableDocument takes as an option',
  '@portable-doc/text fromMarkdown': 'reads Markdown into blocks',
  '@portable-doc/text readMarkdown': 'reads Markdown into blocks and notices',
  '@portable-doc/validate compile': 'compiles a schema',
  '@portable-doc/validate validate': 'validates a document',
  '@portable-doc/validate walkDepth': "measures a document's depth",
};

/**
 * Package entries this repository cannot import, each with why, and the source module the
 * registry test reads in its place (null: none holds a function). Keyed `<package> <entry>`.
 */
const EDITOR_BUNDLE = {
  source: 'packages/editor/src/markdown.js',
  why: "a script bundle, built in Barkpark, that registers the editor's elements. Their one document writer is the canvas's toMarkdown() method (the editor export writer's `method`), blocksToExportMarkdown in src/markdown.js. Their on-screen HTML is drawn in a browser, not by an exported function, so the word test cannot run it",
};
export const BUILT_ELSEWHERE = {
  '@portable-doc/code ./bp-paper-code.js': { source: null, why: 'a script bundle of the package entry (src/reader-code.js), with no module exports' },
  '@portable-doc/editor .': EDITOR_BUNDLE,
  '@portable-doc/editor ./bundle': EDITOR_BUNDLE,
  '@portable-doc/editor ./bp-paper-editor.bundle.js': EDITOR_BUNDLE,
  '@portable-doc/editor ./mermaid': { source: null, why: 'a script bundle that draws diagrams in a page' },
  '@portable-doc/editor ./bp-paper-mermaid.js': { source: null, why: 'a script bundle that draws diagrams in a page' },
  '@portable-doc/editor ./bp-paper-code.js': { source: null, why: 'a script bundle that paints code highlighting in a page' },
  '@portable-doc/editor ./contract': { source: 'packages/editor/src/contract.js', why: "the editor's contract constants, built in Barkpark" },
};
