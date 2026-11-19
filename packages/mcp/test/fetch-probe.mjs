// Loaded with `--import` into the server by the slow-reader test. Each fetch first writes the
// line "fetch" to stderr, so the test counts the server's fetches without reading a clock.
// With FETCH_STALL_MS set, each fetch then blocks the server's thread that long (Atomics.wait on
// a buffer no one wakes), as a loaded machine can. The fetch's deadline (AbortSignal.timeout, made before fetch is called) is
// shorter, so it has run out before the request leaves: the run a machine at load 44 once gave,
// every time.
const stallMs = Number(process.env.FETCH_STALL_MS) || 0;
const fetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  process.stderr.write('fetch\n');
  if (stallMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stallMs);
  return fetch(...args);
};
