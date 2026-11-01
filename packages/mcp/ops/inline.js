import { canonical, exactKeys, isMap, isString, optionalNonNil, subsetKeys } from './terms.js';

const VALUEREF_KEYS = ['type', 'target', 'field', 'as', 'fallback', 'label', 'children'];
const WIKILINK_KEYS = ['type', 'target', 'children', 'alias', 'docId'];
const requiredKeys = (map, keys) => keys.every((k) => Object.hasOwn(map, k));
const nonEmpty = (v) => isString(v) && v !== '';

const CARD_RANK = ['link', 'wikilink', 'strong', 'em', 'underline', 'strikethrough', 'code', 'blockref', 'tag', 'valueref'];
const CARD_MARKS = ['strong', 'em', 'underline', 'strikethrough'];
const cardRank = (type) => CARD_RANK.indexOf(type);

export const validCardInline = (nodes) => Array.isArray(nodes) && nodes.every((n) => cardNode(n, 0));

function cardNode(n, rank) {
  if (!isMap(n)) return false;
  const single = Array.isArray(n.children) && n.children.length === 1;
  if (n.type === 'text' && nonEmpty(n.value)) return exactKeys(n, ['type', 'value']);
  if (n.type === 'code' && nonEmpty(n.value)) return cardRank('code') >= rank && exactKeys(n, ['type', 'value']);
  if (CARD_MARKS.includes(n.type) && single) {
    return cardRank(n.type) >= rank && exactKeys(n, ['type', 'children']) && cardNode(n.children[0], cardRank(n.type));
  }
  if (n.type === 'link' && isString(n.href) && single) {
    return cardRank('link') >= rank && exactKeys(n, ['type', 'href', 'children']) && cardNode(n.children[0], cardRank('link'));
  }
  if (n.type === 'wikilink' && isString(n.target) && single) {
    return cardRank('wikilink') >= rank && subsetKeys(n, WIKILINK_KEYS) && requiredKeys(n, ['type', 'target', 'children']) &&
      optionalNonNil(n, 'alias') && optionalNonNil(n, 'docId') && cardNode(n.children[0], cardRank('wikilink'));
  }
  return leafRef(n, (type) => cardRank(type) >= rank);
}

function leafRef(n, ranked) {
  if (n.type === 'blockref' && isString(n.target) && isString(n.anchor)) return ranked('blockref') && exactKeys(n, ['type', 'target', 'anchor']);
  if (n.type === 'tag' && isString(n.name)) return ranked('tag') && exactKeys(n, ['type', 'name']);
  if (n.type === 'valueref' && isString(n.target) && isString(n.field)) {
    return ranked('valueref') && subsetKeys(n, VALUEREF_KEYS) && requiredKeys(n, ['type', 'target', 'field']) &&
      ['as', 'fallback', 'label', 'children'].every((k) => optionalNonNil(n, k));
  }
  return false;
}

const TABLE_RANK = ['link', 'wikilink', 'strong', 'em', 'underline', 'strikethrough', 'highlight', 'sub', 'sup', 'code', 'blockref', 'tag', 'valueref'];
const TABLE_MARKS = ['strong', 'em', 'underline', 'strikethrough', 'highlight', 'sub', 'sup'];
const tableRank = (type) => TABLE_RANK.indexOf(type);

export function validTableInline(nodes) {
  if (!Array.isArray(nodes)) return false;
  let previous = null;
  for (const n of nodes) {
    const signature = tableSignature(n, -1);
    if (signature === null || signature === previous) return false;
    previous = signature;
  }
  return true;
}

function tableSignature(n, rank) {
  if (!isMap(n)) return null;
  const single = Array.isArray(n.children) && n.children.length === 1;
  const nested = (type, head) => {
    const inner = tableSignature(n.children[0], tableRank(type));
    return inner === null ? null : canonical([head, ...JSON.parse(inner)]);
  };
  if (n.type === 'text' && nonEmpty(n.value)) return exactKeys(n, ['type', 'value']) ? '[]' : null;
  if (n.type === 'code' && nonEmpty(n.value)) return tableRank('code') > rank && exactKeys(n, ['type', 'value']) ? '[["code"]]' : null;
  if (TABLE_MARKS.includes(n.type) && single) {
    return tableRank(n.type) > rank && exactKeys(n, ['type', 'children']) ? nested(n.type, [n.type]) : null;
  }
  if (n.type === 'link' && isString(n.href) && single) {
    return tableRank('link') > rank && exactKeys(n, ['type', 'href', 'children']) ? nested('link', ['link', n.href]) : null;
  }
  if (n.type === 'wikilink' && isString(n.target) && single) {
    const okKeys = tableRank('wikilink') > rank && subsetKeys(n, WIKILINK_KEYS) && requiredKeys(n, ['type', 'target', 'children']) &&
      optionalNonNil(n, 'alias') && optionalNonNil(n, 'docId');
    return okKeys ? nested('wikilink', ['wikilink', n.target, [absent(n, 'alias'), absent(n, 'docId')]]) : null;
  }
  if (!leafRef(n, (type) => tableRank(type) > rank)) return null;
  if (n.type === 'blockref') return canonical([['blockref', n.target, n.anchor]]);
  if (n.type === 'tag') return canonical([['tag', n.name]]);
  return canonical([['valueref', n.target, n.field, ['as', 'fallback', 'label', 'children'].map((k) => absent(n, k))]]);
}

const absent = (n, key) => (Object.hasOwn(n, key) ? { v: n[key] } : ':absent');
