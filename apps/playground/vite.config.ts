import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the public playground.
 *
 * - base: '/portable-doc/' because GitHub Pages serves project sites at
 *   <user>.github.io/<repo>/, so all asset paths must be prefixed with
 *   /portable-doc/.
 * - No MCP integration. The playground imports backends directly via the
 *   kernel — zero network, zero local-server dependency. The editor
 *   dogfoods MCP HTTP locally; this playground is the visitor showcase.
 *   Same backends, two transports.
 */
export default defineConfig({
  base: '/portable-doc/',
  plugins: [react()],
  build: {
    rollupOptions: {
      // terminal-image is a Node-only dep (uses jimp's Node bundle) consumed
      // only by backend-ink's async renderInkAsync path. The playground only
      // calls sync renderInk, so the dynamic import never fires here. Marking
      // external keeps jimp's browser bundle (which is missing the Jimp /
      // intToRGBA exports terminal-image expects) out of the build graph.
      external: ['terminal-image'],
    },
  },
});
