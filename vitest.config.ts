import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // pd-to-rn-shim's PdRender imports `react-native`; in Node-only test runs
      // we alias to react-native-web — identical View/Text/Pressable/Image
      // surface for our walker. Real consumers get RN at runtime via Metro.
      { find: /^react-native$/, replacement: 'react-native-web' },
    ],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
