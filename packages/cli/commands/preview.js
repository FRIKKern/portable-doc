// SPDX-License-Identifier: Apache-2.0
// `portable-doc preview`: serve a doc and reload it as the file changes. The
// server is in ../preview.js, loaded only when this command runs.

import { UsageError, load, parseArgs, renderHtml } from '../shared.js';

export const order = 5;
export const synopsis = '<file>';
export const summary = 'serve a doc on 127.0.0.1 and reload it as the file changes';
export const usage = `Usage: portable-doc preview <file> [--port N] [--open]

Serves the doc, rendered as render --format html does, on 127.0.0.1 and reloads the page when
the file changes. A broken doc shows explain's words above the last version that rendered.
  --port <n>   the port (default 4317, or any free one when that is taken; 0 picks one)
  --open       open the page in the system browser
Runs until Ctrl-C. Exit: 0 stopped, 2 usage error, unreadable file, port in use, or @portable-doc/react not built.`;

const flags = { '--port': 'port=', '--open': 'open' };

export async function run(args, io) {
  const { files, opts } = parseArgs(flags, args);
  const { preview } = await import('../preview.js');
  return preview(files, opts, io, { load, renderHtml, UsageError });
}

export const readme = `## Preview

\`\`\`console
$ npx portable-doc preview notes.json --open
Previewing notes.json at http://127.0.0.1:4317/ (Ctrl-C stops)
\`\`\`

- The page is the doc as \`render --format html\` makes it, styled with
  \`@portable-doc/react/paper-surface.css\`. That stylesheet is read from the
  built package, so run \`npm run react:build\` once first, as for html. Light
  and dark follow the system.
- Save the file and the page reloads by itself, also when the editor saves by
  renaming a new file over the old one.
- A doc with bad JSON or validation errors shows its problems, in the words
  \`explain\` uses, above the last version that rendered.
- The server listens on 127.0.0.1 only, on port 4317, or on any free port
  when that one is taken. \`--port 0\` always picks a free one. It answers GET
  and HEAD for \`/\`, \`/paper-surface.css\` and \`/events\` (the reload stream, GET
  only), with \`127.0.0.1\` or \`localhost\` as the host. Anything else is a 404.
  No other site may frame the page.
- If the file can no longer be watched, the page says so above the last
  render, and the server keeps running.
- \`--open\` opens the page with \`open\` (macOS) or \`xdg-open\`. Ctrl-C closes the
  watcher, ends each open tab's event stream cleanly (a tab that never reads is
  cut after \`CLOSE_GRACE_MS\`, one second), and exits 0.
- A second Ctrl-C while it stops ends the server at once: open streams are cut,
  not ended, and the process dies of the signal (exit 130 in a shell).`;
