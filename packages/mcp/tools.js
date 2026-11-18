import { CODES, validate } from '@portable-doc/validate';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { explain } from './explain.js';
import { MAX_DEPTH, MAX_NODES, measure } from './limits.js';
import { applyOps } from './ops/apply.js';
import { TABLE_OPS } from './ops/intents.js';
import { render } from './render.js';
import { blockDetail, hasType, listBlocks, loadCatalog } from './catalog.js';
import { FORMATS, renderLocal } from './local.js';

export const MAX_OPS = 100;
const MAX_ERRORS = 1_000;
const MAX_PATH = 10_000;

const DOC = { description: 'A PortableDoc: an object with a blocks array, or a blocks array', type: ['object', 'array'] };
const VALIDATE_DOC = { description: 'Any JSON value. Invalid PortableDoc shapes are returned as validator diagnostics.' };

export const TOOLS = [
  {
    name: 'validate',
    description: 'Check a PortableDoc against the synced spec. Returns { ok: true } or { ok: false, errors: [{ code, path, message }] }.',
    inputSchema: { type: 'object', properties: { doc: VALIDATE_DOC }, required: ['doc'], additionalProperties: false },
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
    description: "Render a PortableDoc. format html (the default) gives { html }: from Barkpark's reader when BARKPARK_URL is set, else locally with @portable-doc/react. markdown gives { markdown } and text gives { text }, always locally with @portable-doc/text. A local render validates first: a broken doc is a tool error with the validator's errors.",
    inputSchema: {
      type: 'object',
      properties: { doc: DOC, format: { type: 'string', enum: FORMATS, default: 'html', description: 'html, markdown or text' } },
      required: ['doc'],
      additionalProperties: false,
    },
  },
  {
    name: 'blocks',
    description: "The block types a PortableDoc can hold, read from the synced spec. No argument: every type with its tier and its own fields, plus the aliases. { type }: that type's fields (type, required, enum and limits where the spec has them) and the golden example block.",
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', description: 'A block type or alias, such as callout or h2' } },
      required: [],
      additionalProperties: false,
    },
  },
];

const catalog = loadCatalog();

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

function checkDecoded(args) {
  const over = measure(args, { strings: true }).over;
  if (over === 'nodes') throw bad(`a table edit reads the JSON inside strings, and with it the arguments hold more than ${MAX_NODES} JSON values`);
  if (over === 'depth') throw bad(`a table edit reads the JSON inside strings, and with it the arguments nest deeper than ${MAX_DEPTH} JSON levels`);
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
    validate(args) {
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
      if (args.ops.some((op) => TABLE_OPS.includes(op?.op))) checkDecoded(args);
      const applied = applyOps(args.doc, args.ops);
      return applied.ok ? result({ ok: true, doc: applied.value }) : result({ ok: false, index: applied.index, error: applied.error }, true);
    },
    async render(args, size) {
      checkDoc(args.doc, size, { walked: true });
      const format = Object.hasOwn(args, 'format') ? args.format : 'html';
      if (!FORMATS.includes(format)) throw bad(`format must be one of ${FORMATS.join(', ')}`);
      if (format === 'html' && config.base) {
        const rendered = await render(args.doc, config);
        return rendered.ok ? result({ html: rendered.html }) : result({ error: rendered.error }, true);
      }
      const local = await renderLocal(args.doc, format);
      return result(local.value, !local.ok);
    },
    blocks(args) {
      if (Object.hasOwn(args, 'type') && typeof args.type !== 'string') throw bad('type must be a string');
      if (catalog.error) return result({ error: catalog.error }, true);
      if (!Object.hasOwn(args, 'type')) return result(listBlocks(catalog));
      if (!hasType(catalog, args.type)) throw bad(`no block type ${JSON.stringify(args.type.slice(0, 100))}; call blocks with no argument for the list`);
      return result(blockDetail(catalog, args.type));
    },
  };
}

export async function callTool(config, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new McpError(ErrorCode.InvalidParams, `no tool ${JSON.stringify(String(name).slice(0, 100))}; tools: ${TOOLS.map((t) => t.name).join(', ')}`);
  const size = checkArgs(tool, args ?? {});
  return handlers(config)[name](args, size);
}
