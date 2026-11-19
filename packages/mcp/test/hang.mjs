// The MCP tests' one wall-clock limit on a request or a wait: a hang deadline. It only stops
// a call that would never answer, so it sits far past any real call on a loaded machine (a
// gate at load 57 took 23 s for the largest doc). How fast the work is, the tests hold with
// CPU budgets (scripts/lib/cpu-budget.mjs), which a busy machine does not move.
export const HANG_MS = 120_000;
/** Request options for the SDK client: its own default, 60 s, is a wall-clock limit too. */
export const REQUEST = { timeout: HANG_MS };
/** Server env: the longest BARKPARK_TIMEOUT_MS the server takes, so a slow fake reader is not cut. */
export const READER_WAIT = { BARKPARK_TIMEOUT_MS: '60000' };
