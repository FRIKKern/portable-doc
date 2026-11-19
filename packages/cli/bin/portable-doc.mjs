#!/usr/bin/env node
import { main } from '../index.js';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};
// A reader that stops early (`| head`, a pager quit) closes stdout. The rest of
// the output is dropped, quietly, and the command still exits with its own code:
// a doc that fails validate exits 1 under `| head` too. Any other error on stdout
// is a failure.
let stdoutClosed = false;
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') {
    stdoutClosed = true;
    return;
  }
  process.stderr.write(`portable-doc: cannot write to stdout: ${error.message}\n`);
  process.exit(2);
});
const write = (stream) => (text) => void (stream === process.stdout && stdoutClosed ? null : stream.write(text));

try {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: write(process.stdout),
    stderr: write(process.stderr),
    readStdin,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  });
} catch (error) {
  process.stderr.write(`portable-doc: ${error?.message ?? error}\n`);
  process.exitCode = 2;
}
