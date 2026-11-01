export const isMap = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export const get = (map, key) => (isMap(map) && Object.hasOwn(map, key) && map[key] !== undefined ? map[key] : null);

export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isMap(a) && isMap(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return false;
}

export const isString = (v) => typeof v === 'string';

export const exactKeys = (map, keys) => {
  const own = Object.keys(map);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(map, k));
};

export const subsetKeys = (map, keys) => Object.keys(map).every((k) => keys.includes(k));

export const optionalNonNil = (map, key) => !Object.hasOwn(map, key) || map[key] !== null;

export const refusal = (code, target, op) => ({ code, target, op });

const rank = (v) => (typeof v === 'number' ? 0 : v === null || typeof v === 'boolean' ? 1 : isMap(v) ? 2 : Array.isArray(v) ? 3 : 4);
const atom = (v) => (v === null ? 'nil' : String(v));

export function termOrder(a, b) {
  const d = rank(a) - rank(b);
  if (d !== 0) return d;
  if (typeof a === 'number') return a - b;
  if (rank(a) === 1) return atom(a) < atom(b) ? -1 : atom(a) > atom(b) ? 1 : 0;
  if (typeof a === 'string') return Buffer.compare(Buffer.from(a), Buffer.from(b));
  return Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b)));
}

export const canonical = (v) =>
  JSON.stringify(v, (_k, x) => (isMap(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
