// SPDX-License-Identifier: Apache-2.0
// The `portable-doc` command. Each subcommand is one file in commands/ (see registry.js).

import fs from 'node:fs';
import { BUILT_IN, loadCommands } from './registry.js';
import { UsageError } from './shared.js';
import { shown } from './words.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('package.json', import.meta.url), 'utf8')).version;

/** The top-level usage, with one line per command. */
export function mainUsage(commands) {
  const heads = [...commands.values()].map((c) => `${c.name} ${c.synopsis}`);
  const width = Math.max(...heads.map((h) => h.length)) + 3;
  const lines = [...commands.values()].map((c, i) => `  ${heads[i].padEnd(width)}${c.summary}`);
  return `Usage: portable-doc <command> [options]

Commands:
${lines.join('\n')}

A file of "-", or no file, reads stdin. A doc is a blocks array or { "blocks": [...] }.
Options: --help, --version. Run "portable-doc <command> --help" for its options.`;
}

/**
 * Run the command line. `io` is { stdout(text), stderr(text), readStdin(): Promise<string>, stdinIsTTY, stdoutIsTTY }.
 * Resolves to the exit code.
 */
export async function main(argv, io) {
  const commands = await loadCommands();
  const [name, ...args] = argv;
  if (name === undefined || BUILT_IN.usage.includes(name)) {
    io[name === undefined ? 'stderr' : 'stdout'](`${mainUsage(commands)}\n`);
    return name === undefined ? 2 : 0;
  }
  if (BUILT_IN.version.includes(name)) return io.stdout(`${VERSION}\n`), 0;
  const command = commands.get(name);
  if (!command) {
    io.stderr(`portable-doc: unknown command "${shown(name)}"\n\n${mainUsage(commands)}\n`);
    return 2;
  }
  if (args.includes('--help') || args.includes('-h')) return io.stdout(`${command.usage}\n`), 0;
  try {
    return await command.run(args, io);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`portable-doc ${name}: ${error.message}\n\n${command.usage}\n`);
    return 2;
  }
}
