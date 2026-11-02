#!/usr/bin/env node
import { createServer } from '../index.js';
import { BoundedStdioTransport } from '../stdio.js';

const server = createServer();
server.onerror = (error) => process.stderr.write(`portable-doc-mcp: ${error.message}\n`);
await server.connect(new BoundedStdioTransport());
