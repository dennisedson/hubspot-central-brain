import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/app/**/*.ts'],
      exclude: ['src/app/__tests__/**', 'src/app/extensions/**'],
    },
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'src/app/lib'),
    },
  },
});
