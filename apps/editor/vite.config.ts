import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the editor app.
 *
 * - Aliases `react-native` → `react-native-web` so backend-web/rnw's
 *   Pd-tree → RN primitives walker resolves cleanly in the browser.
 * - happy-dom test env, alias-shared with build, so the lazy Web preview
 *   tab compiles in tests without RNW exploding.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^react-native$/, replacement: 'react-native-web' }],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
