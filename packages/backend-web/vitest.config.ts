import { defineConfig } from 'vitest/config';

/**
 * backend-web hosts two adapters: a static HTML emitter (Node) and a
 * react-native-web component (browser). The RNW tests need a happy-dom env;
 * the static tests don't care. happy-dom is harmless for the string-only
 * static tests, so apply it across the package.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
