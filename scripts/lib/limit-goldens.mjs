// SPDX-License-Identifier: Apache-2.0
// The limit goldens (goldens/limits, synced from Barkpark's pack) and the ones React does not yet
// write byte for byte. scripts/limit-goldens-react.test.mjs holds React to the rest;
// scripts/style-sites.test.mjs counts only the rest as guards.
import fs from 'node:fs';

const DIR = new URL('../../goldens/limits/', import.meta.url);

/** Each limit golden as [name, golden], by file name. */
export const limitGoldens = () =>
  fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.golden.json'))
    .sort()
    .map((f) => [f.replace(/\.golden\.json$/, ''), JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8'))]);

/** Limit goldens React does not yet write, each with why. This list only shrinks. */
export const NOT_YET = {};
export const NOT_YET_MOST = 0;
