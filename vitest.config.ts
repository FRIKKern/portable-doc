import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // backend-native source imports `react-native`; in Node-only test runs we
      // alias to react-native-web — identical View/Text/Pressable/Image surface.
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
