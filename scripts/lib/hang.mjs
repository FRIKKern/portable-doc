// The repo's one hang deadline: the most wall-clock time any test waits for anything. It only
// stops a wait that would never end, so it sits far past real work on a loaded machine (a gate
// at load 57 took 23 s for the MCP server's largest doc). How fast work is, tests hold with
// CPU budgets (cpu-budget.mjs beside this), which a busy machine does not move.
export const HANG_MS = 120_000;
