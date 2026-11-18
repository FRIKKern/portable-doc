#!/usr/bin/env node
import { main } from '../index.js';

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};
const write = (stream) => (text) => void stream.write(text);

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
