import { defineConfig } from 'vitest/config';
import { HANG_MS } from '../../scripts/lib/hang.mjs';

// Vitest's default per-test timeout, 5 s of wall clock, would fail a test on a loaded machine
// for work that is fine. The repo's hang deadline is the only wall-clock limit instead.
export default defineConfig({ test: { testTimeout: HANG_MS, hookTimeout: HANG_MS } });
