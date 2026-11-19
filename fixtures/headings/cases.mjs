// SPDX-License-Identifier: Apache-2.0
// The inputs of the shared heading cases: name → Markdown. scripts/write-shared-cases.mjs
// reads each with fromMarkdown and writes <name>.json as { markdown, blocks }.

export const CASES = {
  'heading-inline-marks-and-link': '# Hello **world** and [a link](https://example.com)',
};
