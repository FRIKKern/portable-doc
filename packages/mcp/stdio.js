import process from 'node:process';
import { ErrorCode, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const EDGE = 256;
const ID = String.raw`(-?\d+|"(?:[^"\\]|\\.)*")`;
const HEAD_ID = new RegExp(String.raw`^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?"id"\s*:\s*${ID}`);
const TAIL_ID = new RegExp(String.raw`"id"\s*:\s*${ID}\s*\}\s*$`);

function idOf(match) {
  try {
    return match ? JSON.parse(match[1]) : null;
  } catch {
    return null;
  }
}
const requestId = (value) => (typeof value?.id === 'string' || Number.isInteger(value?.id) ? value.id : null);

export class BoundedStdioTransport {
  #stdin;
  #stdout;
  #limit;
  #chunks = [];
  #size = 0;
  #skipped = null;

  constructor({ stdin = process.stdin, stdout = process.stdout, limit = MAX_MESSAGE_BYTES } = {}) {
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#limit = limit;
  }

  async start() {
    this.#stdin.on('data', this.#ondata);
    this.#stdin.on('error', this.#onerror);
    this.#stdin.on('end', this.#onend);
  }

  async close() {
    this.#stdin.off('data', this.#ondata);
    this.#stdin.off('error', this.#onerror);
    this.#stdin.off('end', this.#onend);
    this.#chunks = [];
    this.onclose?.();
  }

  async send(message) {
    this.#stdout.write(JSON.stringify(message) + '\n');
  }

  #onerror = (error) => this.onerror?.(error);
  #onend = () => this.close();

  #ondata = (chunk) => {
    let start = 0;
    while (start <= chunk.length) {
      const newline = chunk.indexOf(10, start);
      this.#take(chunk.subarray(start, newline === -1 ? chunk.length : newline));
      if (newline === -1) return;
      this.#finish();
      start = newline + 1;
    }
  };

  #take(part) {
    if (this.#skipped) {
      this.#skipped.tail = Buffer.concat([this.#skipped.tail, part]).subarray(-EDGE);
      this.#skipped.size += part.length;
      return;
    }
    if (this.#size + part.length <= this.#limit) {
      this.#chunks.push(part);
      this.#size += part.length;
      return;
    }
    const whole = Buffer.concat([...this.#chunks, part]);
    this.#skipped = { head: whole.subarray(0, EDGE), tail: whole.subarray(-EDGE), size: whole.length };
    this.#chunks = [];
    this.#size = 0;
  }

  #finish() {
    if (this.#skipped) {
      const { head, tail, size } = this.#skipped;
      this.#skipped = null;
      const id = idOf(head.toString('utf8').match(HEAD_ID)) ?? idOf(tail.toString('utf8').match(TAIL_ID));
      return this.#refuse(id, ErrorCode.InvalidRequest, `message is ${size} bytes; the limit is ${this.#limit}`);
    }
    const line = Buffer.concat(this.#chunks).toString('utf8');
    this.#chunks = [];
    this.#size = 0;
    if (line.trim() === '') return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return this.#refuse(null, ErrorCode.ParseError, 'message is not JSON');
    }
    const parsed = JSONRPCMessageSchema.safeParse(value);
    if (!parsed.success) return this.#refuse(requestId(value), ErrorCode.InvalidRequest, 'message is not JSON-RPC 2.0');
    this.onmessage?.(parsed.data);
  }

  #refuse(id, code, message) {
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }
}
