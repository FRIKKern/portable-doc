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
  build: {
    rollupOptions: {
      // terminal-image is a Node-only dep (uses jimp's Node bundle) consumed
      // exclusively by backend-ink's renderInkAsync. The editor only calls
      // sync renderInk, so the dynamic import in backend-ink never fires here.
      // Marking external keeps jimp's browser bundle (which is missing the
      // Jimp/intToRGBA exports terminal-image expects) out of the graph.
      external: ['terminal-image'],
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
