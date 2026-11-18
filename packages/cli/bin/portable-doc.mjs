#!/usr/bin/env node
import { main } from '../index.js';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};
const write = (stream) => (text) => void stream.write(text);

// A reader that stops early (`| head`, a pager quit, git's diff driver) closes
// stdout: the command has nothing more to say, so it ends quietly with 0. Any
// other error on stdout is still a failure.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  process.stderr.write(`portable-doc: cannot write to stdout: ${error.message}\n`);
  process.exit(2);
});

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
