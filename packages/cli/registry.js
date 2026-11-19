// SPDX-License-Identifier: Apache-2.0
// The commands are the files in commands/: one file per command, named after it.
// Usage, dispatch and the README's command sections are all built from that folder,
// so a command exists by its file alone. A command file is a plain `name.js`, the name
// in lowercase letters, digits and dashes; anything else there (an editor's lock or
// backup file, a swap file, .DS_Store) is not a command and is skipped.

import fs from 'node:fs';

// What each command file exports, and its type.
const SHAPE = {
  order: 'number', // its place in the usage and the README
  synopsis: 'string', // its arguments in the usage list, e.g. "[file...]"
  summary: 'string', // one line for the usage list and the README table
  usage: 'string', // its --help text
  readme: 'string', // its README section, from "## <Title>"
  run: 'function', // run(args, io): the exit code; may throw UsageError
};

export const COMMAND_FILE = /^[a-z][a-z0-9-]*\.js$/;

// The words index.js answers itself, before any command lookup. A command file may not take
// one: its command could never run. The pattern above already keeps out every dashed one.
export const BUILT_IN = Object.freeze({ usage: Object.freeze(['help', '--help', '-h']), version: Object.freeze(['--version', '-v']) });
const builtIn = (name) => Object.entries(BUILT_IN).find(([, words]) => words.includes(name))?.[0];

const loaded = new Map();

/** The commands in `dir`, as a Map from name to module, in order. Throws, naming the file, for a command file that does not load or has the wrong shape. */
export function loadCommands(dir = new URL('./commands/', import.meta.url)) {
  const key = String(dir);
  if (!loaded.has(key)) loaded.set(key, load(dir));
  return loaded.get(key);
}

async function load(dir) {
  const list = [];
  for (const file of fs.readdirSync(dir).filter((f) => COMMAND_FILE.test(f)).sort()) {
    const name = file.slice(0, -'.js'.length);
    if (builtIn(name)) throw new Error(`commands/${file}: ${name} is the built-in ${builtIn(name)}, not a command name`);
    let command;
    try {
      command = await import(new URL(file, dir));
    } catch (error) {
      throw new Error(`commands/${file} does not load: ${error?.message ?? String(error)}`, { cause: error });
    }
    for (const [field, type] of Object.entries(SHAPE)) if (typeof command[field] !== type) throw new Error(`commands/${file} exports no ${field} (${type})`);
    if (!Number.isFinite(command.order)) throw new Error(`commands/${file} exports order ${command.order}, not a finite number`);
    if (!command.readme.startsWith('## ')) throw new Error(`commands/${file}: readme starts with "## <Title>"`);
    list.push({ ...command, name });
  }
  list.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  return new Map(list.map((command) => [command.name, command]));
}
