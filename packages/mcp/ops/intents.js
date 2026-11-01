import { validCardInline } from './inline.js';
import { applyAction, mergeCells, project, stable } from './table.js';
import { exactKeys, isMap, isString, refusal, same } from './terms.js';
import { blocksWithId, treeAuthoredIds } from './tree.js';

const TABLE_OPS = ['patch-table-cells', 'patch-table-structure'];
const ok = (value) => ({ ok: true, value });
const fail = (code, target, op) => ({ ok: false, error: refusal(code, target, op) });
const invalid = (op) => ({ ok: false, error: { code: 'invalid_op', op } });

export function lowerEditorOp(blocks, op) {
  if (!isMap(op)) return ok(op);
  if (TABLE_OPS.includes(op.op)) {
    const refused = tablePreflight(blocks, op);
    if (refused) return refused;
  }
  if (op.op === 'patch-card-body') return lowerCardBody(blocks, op);
  if (TABLE_OPS.includes(op.op)) return lowerTable(blocks, op);
  return ok(op);
}

function tablePreflight(blocks, op) {
  const ids = treeAuthoredIds(blocks);
  const seen = new Set();
  const dup = ids.find((id) => seen.has(id) || !seen.add(id));
  if (dup !== undefined) return { ok: false, error: { code: 'duplicate_id', target: dup } };
  if (!tablesStable(blocks)) return { ok: false, error: { code: 'table_normalization_would_change_authored_data' } };
  const id = op.id;
  const eligible = isString(id) && id !== '' && id.trim() === id && blocksWithId(blocks, id).length === 1 &&
    tablesIn(blocks).some((t) => t.id === id && same(blocksWithId(blocks, id)[0], t) && project(t));
  return eligible ? null : invalid(op);
}

function tablesIn(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => tablesIn(v, out));
  else if (isMap(value)) {
    if (value.type === 'table') out.push(value);
    Object.values(value).forEach((v) => tablesIn(v, out));
  }
  return out;
}

const tablesStable = (blocks) => tablesIn(blocks).every(stable);

function lowerCardBody(blocks, op) {
  const { id, content } = op;
  if (!isString(id) || id === '' || !Array.isArray(content)) return invalid(op);
  if (!Object.keys(op).every((k) => ['op', 'id', 'content'].includes(k)) || !validCardInline(content)) return invalid(op);
  const found = blocksWithId(blocks, id);
  if (found.length === 0) return fail('block_not_found', id, 'patch-card-body');
  if (found.length > 1) return fail('duplicate_id', id, 'patch-card-body');
  if (found[0].type !== 'card') return fail('type_mismatch', id, 'patch-card-body');
  const strict = strictCard(found[0]);
  if (!strict) return invalid(op);
  const body = strict.body === null ? { type: 'paragraph', content } : { ...strict.body, content };
  return ok({ op: 'patch-block', id, patch: { slots: { ...strict.slots, body: [body] } } });
}

const optionalText = (map, key) => !Object.hasOwn(map, key) || map[key] === null || isString(map[key]);

const SLOT_RULES = {
  title: (e) => e.type === 'heading' && optionalText(e, 'text'),
  body: (e) => e.type === 'paragraph' && (!Object.hasOwn(e, 'content') || e.content === null || sourceInline(e.content)),
  media: (e) => (!Object.hasOwn(e, 'type') || e.type === null || e.type === 'image') && optionalText(e, 'src') && optionalText(e, 'alt'),
  action: (e) => e.type === 'action' && optionalText(e, 'label') && optionalText(e, 'href') && optionalText(e, 'priority'),
};

const sourceInline = (nodes) =>
  (Array.isArray(nodes) && nodes.length === 1 && isMap(nodes[0]) && nodes[0].type === 'text' && nodes[0].value === '' && exactKeys(nodes[0], ['type', 'value'])) ||
  validCardInline(nodes);

function strictCard(card) {
  if (!optionalText(card, 'tone')) return null;
  const slots = !Object.hasOwn(card, 'slots') || card.slots === null ? {} : card.slots;
  if (!isMap(slots)) return null;
  const picked = {};
  for (const [name, rule] of Object.entries(SLOT_RULES)) {
    const value = Object.hasOwn(slots, name) ? slots[name] : null;
    if (value === null || (Array.isArray(value) && value.length === 0)) picked[name] = null;
    else if (Array.isArray(value) && value.length === 1 && isMap(value[0]) && rule(value[0])) picked[name] = value[0];
    else return null;
  }
  return { slots, body: picked.body };
}

function lowerTable(blocks, op) {
  const payload = op.op === 'patch-table-cells' ? 'cells' : 'action';
  if (!isString(op.id) || !Object.hasOwn(op, 'shape') || !exactKeys(op, ['op', 'id', 'shape', payload])) return invalid(op);
  const found = blocksWithId(blocks, op.id);
  if (found.length === 0) return fail('block_not_found', op.id, op.op);
  if (found.length > 1) return fail('duplicate_id', op.id, op.op);
  if (found[0].type !== 'table') return fail('type_mismatch', op.id, op.op);
  const updated = payload === 'cells' ? mergeCells(found[0], op.shape, op.cells) : applyAction(found[0], op.shape, op.action);
  if (!updated) return invalid(op);
  const patch = { rows: updated.rows, ...(Object.hasOwn(updated, 'head') ? { head: updated.head } : {}) };
  return ok({ op: 'patch-block', id: op.id, patch });
}
