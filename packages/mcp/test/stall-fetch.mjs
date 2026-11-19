// Loaded with `--import` into the server by the slow-reader test: each fetch first holds the
// server's event loop busy for STALL_MS, as a loaded machine can. The fetch's deadline
// (AbortSignal.timeout, made before fetch is called) is shorter, so it has run out before the
// request leaves: the run a machine at load 44 once gave, every time.
export const STALL_MS = 1_000;
const fetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  const end = Date.now() + STALL_MS;
  while (Date.now() < end);
  return fetch(...args);
};
