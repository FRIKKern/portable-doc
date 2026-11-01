import { CODES, validate } from '@portable-doc/validate';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { explain } from './explain.js';
import { MAX_DEPTH, MAX_NODES, measure } from './limits.js';
import { applyOps } from './ops/apply.js';
import { render } from './render.js';

export const MAX_OPS = 100;
const MAX_ERRORS = 1_000;
const MAX_PATH = 10_000;

const DOC = { description: 'A PortableDoc: an object with a blocks array, or a blocks array', type: ['object', 'array'] };

export const TOOLS = [
  {
    name: 'validate',
    description: 'Check a PortableDoc against the synced spec. Returns { ok: true } or { ok: false, errors: [{ code, path, message }] }.',
    inputSchema: { type: 'object', properties: { doc: DOC }, required: ['doc'], additionalProperties: false },
  },
  {
    name: 'explain',
    description: 'Turn validate errors into plain words: where in the doc, and why the code refuses it. Pass the doc too to name the blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: { code: { type: 'string', enum: [...CODES] }, path: { type: 'string' }, message: { type: 'string' } },
            required: ['code', 'path'],
          },
        },
        doc: DOC,
      },
      required: ['errors'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_ops',
    description: 'Apply a batch of edit ops to a PortableDoc, all or nothing, with Barkpark Patch semantics: append-block, insert-after, patch-block, replace-block, remove-block, move-block, patch-card-body, patch-table-cells, patch-table-structure.',
    inputSchema: {
      type: 'object',
      properties: { doc: DOC, ops: { type: 'array', items: { type: 'object' } } },
      required: ['doc', 'ops'],
      additionalProperties: false,
    },
  },
  {
    name: 'render',
    description: "Render a PortableDoc to HTML through Barkpark's reader (BARKPARK_URL).",
    inputSchema: { type: 'object', properties: { doc: DOC }, required: ['doc'], additionalProperties: false },
  },
];

const bad = (message) => new McpError(ErrorCode.InvalidParams, message);
const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkArgs(tool, args) {
  const { properties, required } = tool.inputSchema;
  for (const key of required) if (!Object.hasOwn(args, key)) throw bad(`${tool.name} needs ${key}`);
  for (const key of Object.keys(args)) if (!Object.hasOwn(properties, key)) throw bad(`${tool.name} takes no argument ${JSON.stringify(key.slice(0, 100))}`);
  const size = measure(args);
  if (size.over === 'nodes') throw bad(`arguments hold more than ${MAX_NODES} JSON values`);
  return size;
}

function checkDoc(doc, size, { walked }) {
  if (!isMap(doc) && !Array.isArray(doc)) throw bad('doc must be an object with a blocks array, or a blocks array');
  if (!walked) return;
  if (!Array.isArray(doc) && !Array.isArray(doc.blocks)) throw bad('doc must be an object with a blocks array, or a blocks array');
  if (size.over === 'depth') throw bad(`arguments nest deeper than ${MAX_DEPTH} JSON levels`);
}

const result = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
  ...(isError ? { isError: true } : {}),
});

function checkErrors(errors) {
  if (!Array.isArray(errors)) throw bad('errors must be an array');
  if (errors.length > MAX_ERRORS) throw bad(`errors holds more than ${MAX_ERRORS} entries`);
  errors.forEach((e, i) => {
    if (!isMap(e)) throw bad(`errors[${i}] must be an object`);
    if (!CODES.includes(e.code)) throw bad(`errors[${i}].code must be one of ${CODES.join(', ')}`);
    if (typeof e.path !== 'string' || e.path.length > MAX_PATH || (e.path !== '' && !e.path.startsWith('/'))) throw bad(`errors[${i}].path must be a JSON pointer`);
    if (Object.hasOwn(e, 'message') && typeof e.message !== 'string') throw bad(`errors[${i}].message must be a string`);
  });
}

export function handlers(config) {
  return {
    validate(args, size) {
      checkDoc(args.doc, size, { walked: false });
      return result(validate(args.doc));
    },
    explain(args, size) {
      checkErrors(args.errors);
      if (Object.hasOwn(args, 'doc')) checkDoc(args.doc, size, { walked: false });
      return result({ explanations: explain(args.errors, args.doc) });
    },
    apply_ops(args, size) {
      checkDoc(args.doc, size, { walked: true });
      if (!Array.isArray(args.ops)) throw bad('ops must be an array');
      if (args.ops.length > MAX_OPS) throw bad(`ops holds more than ${MAX_OPS} ops`);
      const applied = applyOps(args.doc, args.ops);
      return applied.ok ? result({ ok: true, doc: applied.value }) : result({ ok: false, index: applied.index, error: applied.error }, true);
    },
    async render(args, size) {
      checkDoc(args.doc, size, { walked: true });
      const rendered = await render(args.doc, config);
      return rendered.ok ? result({ html: rendered.html }) : result({ error: rendered.error }, true);
    },
  };
}

export async function callTool(config, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new McpError(ErrorCode.InvalidParams, `no tool ${JSON.stringify(String(name).slice(0, 100))}; tools: ${TOOLS.map((t) => t.name).join(', ')}`);
  const size = checkArgs(tool, args ?? {});
  return handlers(config)[name](args, size);
}
