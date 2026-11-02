import { get, isMap } from './terms.js';

const NUMBER_KEYS = ['value', 'min', 'max', 'step'];

export function coerceFieldPatch(target, patch) {
  switch (target.type) {
    case 'field-boolean':
      if (patch.value === 'true') return { ...patch, value: true };
      if (patch.value === 'false') return { ...patch, value: false };
      return patch;
    case 'field-number': {
      const numbers = NUMBER_KEYS.filter((k) => Object.hasOwn(patch, k));
      if (numbers.length === 0) return patch;
      const parsed = validateNumbers(target, patch, numbers);
      return parsed && { ...patch, ...parsed };
    }
    case 'field-select':
      if (!Object.hasOwn(patch, 'options')) return patch;
      return selectOptions(patch.options) ? patch : null;
    default:
      return patch;
  }
}

const INTEGER = /^[+-]?\d+$/;
const FLOAT = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function parseNumber(value) {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value === 'number') return { ok: true, value };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!INTEGER.test(trimmed) && !FLOAT.test(trimmed)) return { ok: false };
  const n = Number(trimmed);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

function validateNumbers(target, patch, keys) {
  const effective = {};
  for (const key of NUMBER_KEYS) {
    const r = parseNumber(Object.hasOwn(patch, key) ? patch[key] : get(target, key));
    if (!r.ok) return null;
    effective[key] = r.value;
  }
  const { value, min, max, step } = effective;
  if (step !== null && !(step > 0)) return null;
  if (min !== null && max !== null && !(min <= max)) return null;
  if (value !== null && min !== null && !(value >= min)) return null;
  if (value !== null && max !== null && !(value <= max)) return null;
  return Object.fromEntries(keys.map((k) => [k, effective[k]]));
}

function selectOptions(options) {
  if (!Array.isArray(options)) return false;
  const valid = options.every((o) =>
    isMap(o) && typeof o.value === 'string' && o.value !== '' &&
    Object.keys(o).every((k) => k === 'value' || k === 'label') &&
    typeof (Object.hasOwn(o, 'label') ? o.label : '') === 'string');
  return valid && new Set(options.map((o) => o.value)).size === options.length;
}
