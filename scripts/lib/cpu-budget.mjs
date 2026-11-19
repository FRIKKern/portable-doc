import assert from 'node:assert/strict';

/**
 * Run `work` and fail when it used `limitMs` or more of CPU time (user + system).
 * CPU time, not wall time: the gate runs test files side by side, and on a
 * loaded machine wall time measures the queue. Returns what `work` returns.
 */
export function underBudget(limitMs, work) {
  const started = process.cpuUsage();
  const result = work();
  const { user, system } = process.cpuUsage(started);
  const used = Math.round((user + system) / 1000);
  assert.ok(used < limitMs, `${used} ms of CPU, budget ${limitMs} ms`);
  return result;
}
