// What the MCP tests give the SDK client and the server under test, so neither puts a
// wall-clock limit on real work. HANG_MS is the repo's hang deadline (scripts/lib/hang.mjs).
import { HANG_MS } from '../../../scripts/lib/hang.mjs';

/** Request options for the SDK client: its own default, 60 s, is a wall-clock limit too. */
export const REQUEST = { timeout: HANG_MS };
/** Server env: the longest BARKPARK_TIMEOUT_MS the server takes, so a slow fake reader is not cut. */
export const READER_WAIT = { BARKPARK_TIMEOUT_MS: '60000' };
