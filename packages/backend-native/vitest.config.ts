import { defineConfig } from 'vitest/config';

/**
 * Test-time alias: `react-native` → `react-native-web`.
 *
 * The component imports from `react-native` at the source level (real RN at
 * runtime under Expo / Metro). For Node-only smoke tests we alias to RNW since
 * RN core has native-module imports that fail to load outside Metro. The
 * primitive surface (View / Text / Pressable / Image / Linking) is identical
 * across the two for our walker, so the structural smoke test still proves the
 * Pd → RN element-tree shape.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
});
