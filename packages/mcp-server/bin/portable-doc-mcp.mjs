#!/usr/bin/env node
/**
 * Bin launcher — runs src/index.ts under tsx.
 *
 * Used for `npx portable-doc-mcp` style invocations once the package is
 * installed. `pnpm --filter @portable-doc/mcp-server start` uses the
 * `start` script and bypasses this shim entirely.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '..', 'src', 'index.ts');
const child = spawn('tsx', [entry], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
