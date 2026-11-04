import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles the decorators and their type metadata, which Nest's dependency injection needs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
