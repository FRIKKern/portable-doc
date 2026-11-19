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
  withinBudget(limitMs, user + system);
  return result;
}

/** Fail when `usedMicros` of CPU time (measured anywhere: this process, or a child that reports its own) is `limitMs` or more. */
export function withinBudget(limitMs, usedMicros, what = '') {
  const used = Math.round(usedMicros / 1000);
  assert.ok(used < limitMs, `${what ? `${what}: ` : ''}${used} ms of CPU, budget ${limitMs} ms`);
}
